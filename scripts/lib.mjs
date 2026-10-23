// Shared helpers for validate, build and draft. Plain Node, no dependencies.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const WEEKS_DIR = join(ROOT, "data", "weeks");

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadConfig() {
  const stores = readJson(join(ROOT, "config", "stores.json")).stores;
  const criteria = readJson(join(ROOT, "config", "criteria.json"));
  const items = readJson(join(ROOT, "config", "items.json")).items;
  const benchmarksFile = readJson(join(ROOT, "config", "benchmarks.json"));
  const site = readJson(join(ROOT, "config", "site.json"));
  const storeById = Object.fromEntries(stores.map((s) => [s.id, s]));
  return { stores, storeById, criteria, items, benchmarks: benchmarksFile.benchmarks, benchmarksFile, site };
}

export function weekFiles() {
  if (!existsSync(WEEKS_DIR)) return [];
  return readdirSync(WEEKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export function loadWeeks() {
  return weekFiles().map((f) => ({ file: f, data: readJson(join(WEEKS_DIR, f)) }));
}

// ---------- dates ----------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso, n) {
  const dt = parseDate(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function isFriday(iso) {
  return parseDate(iso).getUTCDay() === 5;
}

export function fmtDate(iso, { weekday = true, year = false } = {}) {
  if (!iso) return "unknown";
  const dt = parseDate(iso);
  const parts = [];
  if (weekday) parts.push(DAY_NAMES[dt.getUTCDay()] + ",");
  parts.push(`${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCDate()}`);
  if (year) parts[parts.length - 1] += `, ${dt.getUTCFullYear()}`;
  return parts.join(" ");
}

export function fmtPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// ---------- units ----------

const WEIGHT_TO_LB = { lb: 1, oz: 1 / 16, kg: 2.20462, g: 0.00220462 };
const VOLUME_TO_L = { l: 1, ml: 0.001, "fl-oz": 0.0295735, gal: 3.78541 };

export const round2 = (n) => Math.round(n * 100) / 100;

// Price per standard unit, before rounding: { value, per } or null.
export function computeUnitPrice(deal) {
  const each = deal.price / deal.quantity;
  if (deal.unit === "lb") return { value: each, per: "lb" };
  if (deal.unit === "each") return { value: each, per: "each" };
  if (deal.unit === "pack" && deal.pack) {
    const { size, unit } = deal.pack;
    if (unit in WEIGHT_TO_LB) return { value: each / (size * WEIGHT_TO_LB[unit]), per: "lb" };
    if (unit in VOLUME_TO_L) return { value: each / (size * VOLUME_TO_L[unit]), per: "l" };
    if (unit === "ct") return { value: each / size, per: "each" };
    if (unit === "dozen") return { value: each / size, per: "dozen" };
  }
  return null;
}

// Convert a per-unit price to another standard unit, or null if not comparable.
export function convertPer(value, from, to) {
  if (from === to) return value;
  if (from === "each" && to === "dozen") return value * 12;
  if (from === "dozen" && to === "each") return value / 12;
  if (from === "l" && to === "gal") return value * VOLUME_TO_L.gal;
  if (from === "gal" && to === "l") return value / VOLUME_TO_L.gal;
  return null;
}

export function percentOff(price, regular) {
  return Math.round((1 - price / regular) * 100);
}

// ---------- item analysis ----------

export function isStaple(item, cfg) {
  return Boolean(item.item_key && cfg.items[item.item_key]?.staple);
}

export function isPriority(item, cfg) {
  return cfg.criteria.priority_categories.includes(item.category);
}

// The item's US average benchmark, or null when it has none or is not comparable.
export function usAverage(item, cfg) {
  const key = item.item_key && cfg.items[item.item_key];
  if (!key?.benchmark || !item.unit_price) return null;
  if (cfg.criteria.us_average_staples_only && !key.staple) return null;
  const b = cfg.benchmarks[key.benchmark];
  const v = convertPer(item.unit_price.value, item.unit_price.per, b.per);
  return v == null ? null : { ...b, key: key.benchmark, ratio: v / b.price };
}

// Every item from weeks before `week`, as { week, item }.
export function priorListings(weeks, week) {
  return weeks.filter((w) => w.week < week).flatMap((w) => w.items.map((i) => ({ week: w.week, item: i })));
}

// The lowest earlier listing of the same item_key, in this item's unit:
// { price, per, week, store, count } or null.
export function lowestPrior(item, prior) {
  if (!item.item_key || !item.unit_price) return null;
  let best = null;
  let count = 0;
  for (const { week, item: o } of prior) {
    if (o.item_key !== item.item_key || !o.unit_price) continue;
    const v = convertPer(o.unit_price.value, o.unit_price.per, item.unit_price.per);
    if (v == null) continue;
    count++;
    if (!best || v < best.price || (v === best.price && week > best.week)) best = { price: round2(v), per: item.unit_price.per, week, store: o.store };
  }
  return best && { ...best, count };
}

// Lowest unit price per store for each item_key this week: Map key -> [{ store, value, per }].
export function peerPrices(items) {
  const m = new Map();
  for (const i of items) {
    if (!i.item_key || !i.unit_price) continue;
    const list = m.get(i.item_key) ?? [];
    const v = list.length ? convertPer(i.unit_price.value, i.unit_price.per, list[0].per) : i.unit_price.value;
    if (v == null) continue;
    const mine = list.find((x) => x.store === i.store);
    if (mine) mine.value = Math.min(mine.value, v);
    else list.push({ store: i.store, value: v, per: list.length ? list[0].per : i.unit_price.per });
    m.set(i.item_key, list);
  }
  return m;
}

// Tier, score and tags for one item.
// ctx: { cfg, prior: priorListings(...), peers: peerPrices(week.items) }
export function analyze(item, { cfg, prior, peers }) {
  const c = cfg.criteria;
  const priority = isPriority(item, cfg) || isStaple(item, cfg);
  const pct = item.percent_off;
  const us = usAverage(item, cfg);
  const low = lowestPrior(item, prior);
  const lowOk = low && low.count >= c.badges.lowest_listed_min_prior_listings;
  const v = item.unit_price?.value;
  const below = lowOk && v < low.price;
  const matches = lowOk && v === low.price;

  let cheapest = null;
  const list = item.item_key && item.unit_price ? peers.get(item.item_key) : null;
  if (list && list.length >= 2) {
    const mine = convertPer(v, item.unit_price.per, list[0].per);
    if (mine != null && list.every((x) => x.store === item.store || mine <= x.value)) cheapest = list.length;
  }

  const tags = [];
  if (pct != null) tags.push({ kind: "pct", text: `${pct}% off` });
  if (us && us.ratio <= c.good.max_us_average_ratio) tags.push({ kind: "us", text: `About ${Math.round((1 - us.ratio) * 100)}% under US avg.` });
  if (below || matches) tags.push({ kind: "low", text: "Lowest we've listed" });
  if (cheapest) tags.push({ kind: "cheap", text: `Cheapest of ${cheapest} stores` });
  if (item.member_price) tags.push({ kind: "member", text: "Member price" });

  const standout = Boolean(
    item.highlight ||
    (pct != null && pct >= (priority ? c.standout.min_percent_off_priority : c.standout.min_percent_off_other)) ||
    (us && us.ratio <= c.standout.max_us_average_ratio) ||
    (c.standout.below_lowest_listed && below),
  );
  const good = !standout && Boolean(
    (pct != null && pct >= c.good.min_percent_off) ||
    (us && us.ratio <= c.good.max_us_average_ratio) ||
    (c.good.cheapest_across_stores && cheapest) ||
    (c.good.matches_lowest_listed && matches),
  );

  const r = c.ranking;
  const strength = Math.max(
    pct != null ? pct / 100 : 0,
    us ? 1 - us.ratio : 0,
    below ? r.below_lowest_listed + (1 - v / low.price) : 0,
    cheapest ? r.cheapest_across_stores : 0,
  ) + (item.highlight ? r.highlight_bonus : 0) + (isPriority(item, cfg) ? r.priority_category_bonus : 0);

  return { tier: standout ? "standout" : good ? "good" : "sale", score: strength, tags, us, low: lowOk ? low : null, cheapest };
}

// ---------- formatting ----------

export function money(n) {
  if (n < 1) return `${Math.round(n * 100)}¢`;
  return `$${n.toFixed(2)}`;
}

const PACK_LABEL = { lb: "lb", oz: "oz", kg: "kg", g: "g", l: "L", ml: "mL", "fl-oz": "fl oz", gal: "gal", ct: "ct", dozen: "dozen" };

export function packText(pack) {
  return `${pack.size} ${PACK_LABEL[pack.unit]}`;
}

// "$3.49/lb", "4 for $5.00", "$12.99 for 15 lb", "2 for $7.00 (12 oz each)"
export function priceText(deal, price = deal.price) {
  const q = deal.quantity;
  if (deal.unit === "lb") return q > 1 ? `${q} lb for ${money(price)}` : `${money(price)}/lb`;
  if (deal.unit === "each") return q > 1 ? `${q} for ${money(price)}` : `${money(price)} each`;
  return q > 1 ? `${q} for ${money(price)} (${packText(deal.pack)} each)` : `${money(price)} for ${packText(deal.pack)}`;
}

export function unitPriceText(up) {
  if (!up) return "";
  const per = { lb: "lb", each: "each", dozen: "dozen", l: "L", gal: "gal" }[up.per];
  return up.per === "each" ? `${money(up.value)} each` : `${money(up.value)}/${per}`;
}

// Whether showing the unit price adds information beyond the price line.
export function unitPriceIsExtra(item) {
  return item.unit_price && !(item.quantity === 1 && (item.unit === "lb" || item.unit === "each"));
}

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
