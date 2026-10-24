// App-wide state: the feed, the grocery list (in the app or in Reminders), alerts and
// price watches, saved on the phone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState as RNAppState } from "react-native";
import { notifyNow, setEndingReminders, setFridayReminder, unitValue, Watch, watchHit } from "./alerts";
import { Deal, Feed, loadFeed, matchDeal, Store } from "./data";
import { setUserProps, track } from "./analytics";
import { addReminder, chooseList, readList, removeReminder, RemindersList, remindersSupported, setDone } from "./reminders";

export type ListItem = { id: string; text: string; done: boolean; dealId?: string };
export type AlertPrefs = { friday: boolean; ending: boolean };
// null: not asked yet. "app": kept in the app. Otherwise a Reminders list.
export type ListSource = null | "app" | RemindersList;

type Ctx = {
  feed: Feed | null; refreshing: boolean; refresh: () => void;
  stores: Record<string, Store>; storeName: (id: string) => string;
  veg: boolean; setVeg: (v: boolean) => void;
  list: ListItem[]; addToList: (text: string, deal?: Deal) => void; toggleItem: (id: string) => void; removeItem: (id: string) => void;
  inList: (deal: Deal) => boolean; removeDeal: (deal: Deal) => void;
  source: ListSource; connectReminders: () => Promise<void>; keepInApp: () => void; reloadList: () => void;
  prefs: AlertPrefs; setPrefs: (p: AlertPrefs) => void;
  watches: Watch[]; watch: (d: Deal) => void; unwatch: (id: string) => void; watching: (d: Deal) => Watch | undefined;
};
const AppState = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppState)!;

const K = { list: "sgd.list", veg: "sgd.vegOnly", prefs: "sgd.alerts", watches: "sgd.watches", source: "sgd.listSource" };
const STARTER: ListItem[] = ["Persimmons", "Green onions", "Tofu", "Rice", "Eggs"].map((text, i) => ({ id: `s${i}`, text, done: false }));
const save = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => {});
const isRem = (s: ListSource): s is RemindersList => !!s && typeof s === "object";

export function AppProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [veg, setVegState] = useState(false);
  const [appList, setAppList] = useState<ListItem[]>([]);
  const [remList, setRemList] = useState<ListItem[]>([]);
  const [source, setSourceState] = useState<ListSource>(null);
  const [prefs, setPrefsState] = useState<AlertPrefs>({ friday: false, ending: false });
  const [watches, setWatches] = useState<Watch[]>([]);
  const [ready, setReady] = useState(false);
  const sourceRef = useRef<ListSource>(null);
  sourceRef.current = source;

  const refresh = () => { setRefreshing(true); loadFeed().then(setFeed).finally(() => setRefreshing(false)); };
  const reloadList = () => {
    const s = sourceRef.current;
    if (isRem(s)) readList(s.id).then(setRemList).catch(() => {});
  };
  useEffect(() => {
    refresh();
    AsyncStorage.multiGet([K.list, K.veg, K.prefs, K.watches, K.source]).then(([[, l], [, v], [, p], [, w], [, src]]) => {
      setAppList(l ? JSON.parse(l) : STARTER);
      setVegState(v === "true");
      if (p) setPrefsState(JSON.parse(p));
      if (w) setWatches(JSON.parse(w));
      if (src) { const s = JSON.parse(src); setSourceState(s); sourceRef.current = s; reloadList(); }
    }).catch(() => setAppList(STARTER)).finally(() => setReady(true));
    // Pick up changes made in Reminders (Siri, a partner on a shared list) when the app comes back.
    const sub = RNAppState.addEventListener("change", (st) => { if (st === "active") reloadList(); });
    return () => sub.remove();
  }, []);

  const setSource = (s: ListSource) => { setSourceState(s); sourceRef.current = s; save(K.source, s); setUserProps({ list_source: isRem(s) ? "reminders" : s ?? "none" }); };
  const storeName = (id: string) => feed?.stores.find((s) => s.id === id)?.name ?? id;
  const list = isRem(source) ? remList : appList;

  // Keep "ends tomorrow" notifications in step with the list.
  useEffect(() => {
    if (!feed || !ready) return;
    const matches = list.filter((i) => !i.done).map((i) => {
      const deal = (i.dealId && feed.items.find((d) => d.id === i.dealId)) || matchDeal(i.text, feed.items, veg);
      return deal ? { text: i.text, deal, storeName: storeName(deal.store) } : null;
    }).filter(Boolean) as { text: string; deal: Deal; storeName: string }[];
    setEndingReminders(prefs.ending, matches).catch(() => {});
  }, [feed, list, prefs.ending, ready]);

  // A watch that hits this week sends one notification.
  useEffect(() => {
    if (!feed || !ready) return;
    let changed = false;
    const next = watches.map((w) => {
      const hit = watchHit(w, feed.items);
      if (hit && w.notifiedWeek !== feed.week) {
        changed = true;
        track("Hit Price Watch", { item_key: w.key, store: hit.store, week: feed.week });
        notifyNow(`Price drop: ${w.name}`, `${hit.text} at ${storeName(hit.store)}, under your ${w.label} watch.`).catch(() => {});
        return { ...w, notifiedWeek: feed.week };
      }
      return w;
    });
    if (changed) { setWatches(next); save(K.watches, next); }
  }, [feed, ready]);

  const saveAppList = (next: ListItem[]) => { setAppList(next); save(K.list, next); };

  const connectReminders = async (prompt: "first_add" | "list_tab" = "list_tab") => {
    try {
      const chosen = await chooseList();
      if (!chosen) return;
      setSource(chosen);
      track("Connected List", { source: "reminders", prompt });
      setRemList(await readList(chosen.id));
    } catch (e) {
      Alert.alert("Couldn't open Reminders", `Check Settings > Grocery Deals > Reminders, then try again.\n\n(${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const addTo = async (s: ListSource, text: string, deal?: Deal) => {
    track(deal ? "Added Deal to List" : "Added Item to List", { list_source: isRem(s) ? "reminders" : "app", ...(deal ? { deal_id: deal.id, store: deal.store, category: deal.category, tier: deal.tier } : {}) });
    if (isRem(s)) {
      await addReminder(s.id, text, deal, deal ? storeName(deal.store) : undefined).catch((e) => Alert.alert("Couldn't add to Reminders", e instanceof Error ? e.message : String(e)));
      reloadList();
    } else {
      saveAppList([{ id: String(Date.now()), text, done: false, dealId: deal?.id }, ...appList]);
    }
  };

  const value = useMemo<Ctx>(() => {
    const stores = Object.fromEntries((feed?.stores ?? []).map((s) => [s.id, s]));
    const sameItem = (w: Watch, d: Deal) => (w.key ? w.key === d.key : w.name === d.name);
    return {
      feed, refreshing, refresh, stores, storeName,
      veg, setVeg: (v) => { setVegState(v); save(K.veg, v); track("Toggled Vegetarian Only", { on: v }); setUserProps({ veg_only: v }); },
      list,
      // The first add asks where the list should live.
      addToList: (text, deal) => {
        if (source === null && remindersSupported) {
          Alert.alert("Use your Reminders list?", "Items go into a Reminders list you pick, like a shared Groceries list, with the price and when the sale ends.", [
            { text: "Keep in this app", onPress: () => { setSource("app"); track("Connected List", { source: "app", prompt: "first_add" }); addTo("app", text, deal); } },
            { text: "Use Reminders", style: "default", onPress: async () => { await connectReminders("first_add"); addTo(sourceRef.current, text, deal); } },
          ]);
          return;
        }
        addTo(source, text, deal);
      },
      toggleItem: (id) => {
        if (isRem(source)) {
          const item = remList.find((i) => i.id === id);
          setRemList(remList.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
          setDone(id, !item?.done).catch(() => {});
        } else saveAppList(appList.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
      },
      removeItem: (id) => {
        if (isRem(source)) { setRemList(remList.filter((i) => i.id !== id)); removeReminder(id).catch(() => {}); }
        else saveAppList(appList.filter((i) => i.id !== id));
      },
      inList: (deal) => list.some((i) => i.dealId === deal.id && !i.done),
      // Undo "add": remove the list item that came from this deal.
      removeDeal: (deal) => {
        const ids = list.filter((i) => i.dealId === deal.id && !i.done).map((i) => i.id);
        track("Removed Deal from List", { deal_id: deal.id, store: deal.store, list_source: isRem(source) ? "reminders" : "app" });
        if (isRem(source)) { setRemList(remList.filter((i) => !ids.includes(i.id))); ids.forEach((id) => removeReminder(id).catch(() => {})); }
        else saveAppList(appList.filter((i) => !ids.includes(i.id)));
      },
      source, connectReminders: () => connectReminders("list_tab"), keepInApp: () => { setSource("app"); track("Connected List", { source: "app", prompt: "list_tab" }); }, reloadList,
      prefs,
      setPrefs: (p) => { setPrefsState(p); save(K.prefs, p); for (const k of ["friday", "ending"] as const) if (p[k] !== prefs[k]) track("Changed Alert Setting", { setting: k, on: p[k] }); if (p.friday !== prefs.friday) setFridayReminder(p.friday).catch(() => {}); },
      watches,
      watch: (d) => {
        const u = unitValue(d);
        if (!u) return;
        const label = `${u.value < 1 ? Math.round(u.value * 100) + "¢" : "$" + u.value.toFixed(2)}${u.per === "item" ? "" : u.per === "each" ? " each" : "/" + u.per}`;
        const w: Watch = { id: String(Date.now()), name: d.name, key: d.key, store: d.store, target: u.value, per: u.per, label, notifiedWeek: feed?.week };
        const next = [w, ...watches.filter((x) => !sameItem(x, d))];
        setWatches(next); save(K.watches, next);
        track("Created Price Watch", { item_key: d.key, store: d.store, per: u.per, target: u.value }); setUserProps({ watches_count: next.length });
      },
      unwatch: (id) => { const next = watches.filter((w) => w.id !== id); setWatches(next); save(K.watches, next); track("Removed Price Watch"); setUserProps({ watches_count: next.length }); },
      watching: (d) => watches.find((w) => sameItem(w, d)),
    };
  }, [feed, refreshing, veg, appList, remList, source, prefs, watches]);

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}
