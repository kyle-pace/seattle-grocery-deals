// App-wide state: the feed, the grocery list and "Vegetarian only", saved on the phone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { Deal, Feed, loadFeed, Store } from "./data";

export type ListItem = { id: string; text: string; done: boolean; dealId?: string };

type Ctx = {
  feed: Feed | null; refreshing: boolean; refresh: () => void;
  stores: Record<string, Store>; storeName: (id: string) => string;
  veg: boolean; setVeg: (v: boolean) => void;
  list: ListItem[]; addToList: (text: string, deal?: Deal) => void; toggleItem: (id: string) => void; removeItem: (id: string) => void;
  inList: (deal: Deal) => boolean;
};
const AppState = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppState)!;

const LIST_KEY = "sgd.list";
const VEG_KEY = "sgd.vegOnly";
const STARTER: ListItem[] = ["Persimmons", "Green onions", "Tofu", "Rice", "Eggs"].map((text, i) => ({ id: `s${i}`, text, done: false }));

export function AppProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [veg, setVegState] = useState(false);
  const [list, setList] = useState<ListItem[]>([]);

  const refresh = () => { setRefreshing(true); loadFeed().then(setFeed).finally(() => setRefreshing(false)); };
  useEffect(() => {
    refresh();
    AsyncStorage.multiGet([LIST_KEY, VEG_KEY]).then(([[, l], [, v]]) => {
      setList(l ? JSON.parse(l) : STARTER);
      setVegState(v === "true");
    }).catch(() => setList(STARTER));
  }, []);
  const saveList = (next: ListItem[]) => { setList(next); AsyncStorage.setItem(LIST_KEY, JSON.stringify(next)).catch(() => {}); };

  const value = useMemo<Ctx>(() => {
    const stores = Object.fromEntries((feed?.stores ?? []).map((s) => [s.id, s]));
    return {
      feed, refreshing, refresh, stores, storeName: (id) => stores[id]?.name ?? id,
      veg, setVeg: (v) => { setVegState(v); AsyncStorage.setItem(VEG_KEY, String(v)).catch(() => {}); },
      list,
      addToList: (text, deal) => saveList([{ id: String(Date.now()), text, done: false, dealId: deal?.id }, ...list]),
      toggleItem: (id) => saveList(list.map((i) => (i.id === id ? { ...i, done: !i.done } : i))),
      removeItem: (id) => saveList(list.filter((i) => i.id !== id)),
      inList: (deal) => list.some((i) => i.dealId === deal.id && !i.done),
    };
  }, [feed, refreshing, veg, list]);

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}
