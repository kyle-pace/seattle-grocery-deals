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

// ---------- deal judgment ----------

export function isStaple(deal, cfg) {
  return Boolean(cfg.items[deal.item_key]?.staple);
}

export function isPriority(deal, cfg) {
  return cfg.criteria.priority_categories.includes(deal.category);
}

export function printedThreshold(deal, cfg) {
  const p = cfg.criteria.printed_discount;
  if (isPriority(deal, cfg)) return p.min_percent_off_priority;
  if (isStaple(deal, cfg)) return p.min_percent_off_staple;
  return p.min_percent_off_other;
}

// Ratio of the deal's unit price to its US average, or null.
export function usAverageRatio(deal) {
  if (!deal.unit_price || !deal.us_average) return null;
  const v = convertPer(deal.unit_price.value, deal.unit_price.per, deal.us_average.per);
  return v == null ? null : v / deal.us_average.price;
}

// Every deal from weeks before `week`, as { week, deal }.
export function priorListings(weeks, week) {
  return weeks.filter((w) => w.week < week).flatMap((w) => w.deals.map((d) => ({ week: w.week, deal: d })));
}

// The lowest earlier listing of the same item_key, in the deal's unit:
// { price, per, week, store, count } or null when there is none.
export function lowestPrior(deal, prior) {
  if (!deal.unit_price) return null;
  let best = null;
  let count = 0;
  for (const { week, deal: o } of prior) {
    if (o.item_key !== deal.item_key || !o.unit_price) continue;
    const v = convertPer(o.unit_price.value, o.unit_price.per, deal.unit_price.per);
    if (v == null) continue;
    count++;
    if (!best || v < best.price || (v === best.price && week > best.week)) {
      best = { price: round2(v), per: deal.unit_price.per, week, store: o.store };
    }
  }
  return best && { ...best, count };
}

// Returns { ok, basis, strength, why } for the deal's stated reference.
// prior is priorListings(...) for the deal's week; needed for site-history.
export function judge(deal, cfg, prior = []) {
  if (deal.reference === "printed") {
    const pct = deal.percent_off;
    const need = printedThreshold(deal, cfg);
    if (pct == null) return { ok: false, why: "reference is printed but percent_off is null" };
    return { ok: pct >= need, basis: "printed", strength: pct / 100, why: `${pct}% off, needs ${need}%` };
  }
  if (deal.reference === "us-average") {
    const ratio = usAverageRatio(deal);
    const max = cfg.criteria.us_average.max_ratio;
    if (ratio == null) return { ok: false, why: "unit price is not comparable to its US average" };
    if (cfg.criteria.us_average.staples_only && !isStaple(deal, cfg)) {
      return { ok: false, why: `${deal.item_key} is not a staple, so it cannot qualify on US average` };
    }
    return { ok: ratio <= max, basis: "us-average", strength: 1 - ratio, why: `${Math.round(ratio * 100)}% of US average, needs ${Math.round(max * 100)}% or less` };
  }
  if (deal.reference === "site-history") {
    const sh = cfg.criteria.site_history;
    const low = lowestPrior(deal, prior);
    if (sh.staples_only && !isStaple(deal, cfg)) return { ok: false, why: `${deal.item_key} is not a staple, so it cannot qualify on site history` };
    if (!low || low.count < sh.min_prior_listings) return { ok: false, why: "no earlier listing of this item to compare against" };
    const v = deal.unit_price.value;
    return {
      ok: v < low.price,
      basis: "site-history",
      low,
      strength: cfg.criteria.ranking.site_history_base + (1 - v / low.price),
      why: `${v} vs lowest earlier listing ${low.price}, needs to be lower`,
    };
  }
  const nr = cfg.criteria.no_reference;
  const ok = nr.allowed && nr.categories.includes(deal.category);
  return { ok, basis: "none", strength: cfg.criteria.ranking.no_reference_strength, why: ok ? "no reference, picked on judgment" : `no-reference deals are only allowed in ${nr.categories.join(", ")}` };
}

export function score(deal, cfg, prior = []) {
  const j = judge(deal, cfg, prior);
  return (j.strength || 0) + (isPriority(deal, cfg) ? cfg.criteria.ranking.priority_category_bonus : 0);
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
export function unitPriceIsExtra(deal) {
  return deal.unit_price && !(deal.quantity === 1 && (deal.unit === "lb" || deal.unit === "each"));
}

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
