// App-wide state: the feed, the grocery list, alerts and price watches, saved on the phone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { notifyNow, setEndingReminders, setFridayReminder, unitValue, Watch, watchHit } from "./alerts";
import { Deal, Feed, loadFeed, matchDeal, Store } from "./data";

export type ListItem = { id: string; text: string; done: boolean; dealId?: string };
export type AlertPrefs = { friday: boolean; ending: boolean };

type Ctx = {
  feed: Feed | null; refreshing: boolean; refresh: () => void;
  stores: Record<string, Store>; storeName: (id: string) => string;
  veg: boolean; setVeg: (v: boolean) => void;
  list: ListItem[]; addToList: (text: string, deal?: Deal) => void; toggleItem: (id: string) => void; removeItem: (id: string) => void;
  inList: (deal: Deal) => boolean;
  prefs: AlertPrefs; setPrefs: (p: AlertPrefs) => void;
  watches: Watch[]; watch: (d: Deal) => void; unwatch: (id: string) => void; watching: (d: Deal) => Watch | undefined;
};
const AppState = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppState)!;

const K = { list: "sgd.list", veg: "sgd.vegOnly", prefs: "sgd.alerts", watches: "sgd.watches" };
const STARTER: ListItem[] = ["Persimmons", "Green onions", "Tofu", "Rice", "Eggs"].map((text, i) => ({ id: `s${i}`, text, done: false }));
const save = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => {});

export function AppProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [veg, setVegState] = useState(false);
  const [list, setList] = useState<ListItem[]>([]);
  const [prefs, setPrefsState] = useState<AlertPrefs>({ friday: false, ending: false });
  const [watches, setWatches] = useState<Watch[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = () => { setRefreshing(true); loadFeed().then(setFeed).finally(() => setRefreshing(false)); };
  useEffect(() => {
    refresh();
    AsyncStorage.multiGet([K.list, K.veg, K.prefs, K.watches]).then(([[, l], [, v], [, p], [, w]]) => {
      setList(l ? JSON.parse(l) : STARTER);
      setVegState(v === "true");
      if (p) setPrefsState(JSON.parse(p));
      if (w) setWatches(JSON.parse(w));
    }).catch(() => setList(STARTER)).finally(() => setReady(true));
  }, []);

  const storeName = (id: string) => feed?.stores.find((s) => s.id === id)?.name ?? id;

  // Keep "ends tomorrow" reminders in step with the list.
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
        notifyNow(`Price drop: ${w.name}`, `${hit.text} at ${storeName(hit.store)}, under your ${w.label} watch.`).catch(() => {});
        return { ...w, notifiedWeek: feed.week };
      }
      return w;
    });
    if (changed) { setWatches(next); save(K.watches, next); }
  }, [feed, ready]);

  const saveList = (next: ListItem[]) => { setList(next); save(K.list, next); };

  const value = useMemo<Ctx>(() => {
    const stores = Object.fromEntries((feed?.stores ?? []).map((s) => [s.id, s]));
    const sameItem = (w: Watch, d: Deal) => (w.key ? w.key === d.key : w.name === d.name);
    return {
      feed, refreshing, refresh, stores, storeName,
      veg, setVeg: (v) => { setVegState(v); save(K.veg, v); },
      list,
      addToList: (text, deal) => saveList([{ id: String(Date.now()), text, done: false, dealId: deal?.id }, ...list]),
      toggleItem: (id) => saveList(list.map((i) => (i.id === id ? { ...i, done: !i.done } : i))),
      removeItem: (id) => saveList(list.filter((i) => i.id !== id)),
      inList: (deal) => list.some((i) => i.dealId === deal.id && !i.done),
      prefs,
      setPrefs: (p) => { setPrefsState(p); save(K.prefs, p); if (p.friday !== prefs.friday) setFridayReminder(p.friday).catch(() => {}); },
      watches,
      watch: (d) => {
        const u = unitValue(d);
        if (!u) return;
        const label = `${u.value < 1 ? Math.round(u.value * 100) + "¢" : "$" + u.value.toFixed(2)}${u.per === "item" ? "" : u.per === "each" ? " each" : "/" + u.per}`;
        const w: Watch = { id: String(Date.now()), name: d.name, key: d.key, store: d.store, target: u.value, per: u.per, label, notifiedWeek: feed?.week };
        const next = [w, ...watches.filter((x) => !sameItem(x, d))];
        setWatches(next); save(K.watches, next);
      },
      unwatch: (id) => { const next = watches.filter((w) => w.id !== id); setWatches(next); save(K.watches, next); },
      watching: (d) => watches.find((w) => sameItem(w, d)),
    };
  }, [feed, refreshing, veg, list, prefs, watches]);

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}
