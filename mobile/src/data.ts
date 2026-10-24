// This week's deals, from the site's app feed, with a bundled copy as a fallback
// so the app works offline and before the feed is deployed.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const FEED_URL = "https://seattlegrocery.deals/api/week.json";

export type Deal = {
  id: string; rank: number; name: string; store: string; category: string; key: string | null;
  price: number; text: string; lead: string; amount: string; unit: string; spoken: string; detail: string[];
  regular: string | null; off: number | null; unit_price: string | null; tier: "standout" | "good" | "sale";
  why: string; veg: boolean; ends: string | null; notes: string | null;
};
export type Store = {
  id: string; name: string; about: string; website: string | null; flyer_url: string | null; delivery: string | null;
  status: string | null; from: string | null; through: string | null;
  locations: { label: string; address: string; lat: number; lon: number }[];
};
export type Feed = { week: string; end: string | null; generated: string; categories: { id: string; label: string }[]; stores: Store[]; items: Deal[] };

const CACHE_KEY = "sgd.feed";
const bundled: Feed = require("../assets/week.json");

// Newest of: the network feed, the last cached feed, the bundled copy.
export async function loadFeed(): Promise<Feed> {
  let cached: Feed | null = null;
  try { const raw = await AsyncStorage.getItem(CACHE_KEY); if (raw) cached = JSON.parse(raw); } catch {}
  try {
    const res = await fetch(FEED_URL, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const feed: Feed = await res.json();
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(feed)).catch(() => {});
      return feed;
    }
  } catch {}
  const options = [cached, bundled].filter(Boolean) as Feed[];
  return options.sort((a, b) => b.week.localeCompare(a.week))[0];
}

export function fmtDate(iso: string | null, weekday = true) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { ...(weekday ? { weekday: "short" } : {}), month: "short", day: "numeric" });
}

// The best deal for a grocery list entry such as "persimmons" or "green onions".
export function matchDeal(entry: string, items: Deal[], veg: boolean): Deal | null {
  const words = entry.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1)
    .map((w) => (w.length > 3 && w.endsWith("es") && !w.endsWith("oes") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  if (!words.length) return null;
  // Whole words only, so "eggs" doesn't match "eggplant" and "rice" doesn't match "price".
  const res = words.map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(e?s)?\\b`, "i"));
  let best: Deal | null = null;
  for (const d of items) {
    if (veg && !d.veg) continue;
    if (res.every((r) => r.test(d.name)) && (!best || d.rank < best.rank)) best = d;
  }
  return best;
}

// Every deal that matches a list entry, for trip planning.
export function matchAll(entry: string, items: Deal[], veg: boolean): Deal[] {
  const out: Deal[] = [];
  for (const d of items) { const m = matchDeal(entry, [d], veg); if (m) out.push(m); }
  return out;
}

// Fewest stores that cover the list items on sale: pick the store covering the most, repeat.
export function planTrip(entries: string[], items: Deal[], veg: boolean): { store: string; entries: string[] }[] {
  const byEntry = new Map(entries.map((e) => [e, new Set(matchAll(e, items, veg).map((d) => d.store))]));
  const left = new Set(entries.filter((e) => byEntry.get(e)!.size));
  const plan: { store: string; entries: string[] }[] = [];
  while (left.size) {
    const counts = new Map<string, string[]>();
    for (const e of left) for (const s of byEntry.get(e)!) counts.set(s, [...(counts.get(s) ?? []), e]);
    const [store, covered] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    plan.push({ store, entries: covered });
    covered.forEach((e) => left.delete(e));
  }
  return plan;
}
