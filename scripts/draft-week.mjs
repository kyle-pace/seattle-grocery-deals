// Turns an "All Items YYYY-MM-DD.md" note into drafts/YYYY-MM-DD.json, a week
// file with every readable item, plus drafts/YYYY-MM-DD.report.json listing
// what to check by hand. Review it, add highlight reasons, then move it to
// data/weeks/ (see UPDATING.md).
// Usage: node scripts/draft-week.mjs "/path/to/All Items 2026-10-23.md"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { ROOT, loadConfig, loadWeeks, priorListings, peerPrices, analyze, computeUnitPrice, round2, percentOff, priceText, isFriday, leaveOutReason, collapseVariants } from "./lib.mjs";
import { match as matchCatalog } from "../vendor/kitchen-catalog/catalog.mjs";

const cfg = loadConfig();
const notePath = process.argv[2];
if (!notePath) {
  console.error('Usage: node scripts/draft-week.mjs "/path/to/All Items YYYY-MM-DD.md"');
  process.exit(1);
}
const text = readFileSync(notePath, "utf8");
const week = (basename(notePath).match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
if (!week || !isFriday(week)) {
  console.error(`Could not find a Friday date in the file name: ${basename(notePath)}`);
  process.exit(1);
}
const YEAR = Number(week.slice(0, 4));

// ---------- helpers ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

// All dates in a string, as YYYY-MM-DD, in order.
function findDates(s) {
  const out = [];
  const re = /(\d{4})-(\d{2})-(\d{2})|\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?)?(?:\s*(?:-|to|through)\s*(\d{1,2})\b(?!\/))?/gi;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) out.push(`${m[1]}-${m[2]}-${m[3]}`);
    else if (m[4]) {
      const y = m[6] ? (m[6].length === 2 ? 2000 + Number(m[6]) : Number(m[6])) : YEAR;
      out.push(`${y}-${pad(m[4])}-${pad(m[5])}`);
    } else {
      const mo = MONTHS[m[7].toLowerCase()];
      const y = m[9] ? Number(m[9]) : YEAR;
      out.push(`${y}-${pad(mo)}-${pad(m[8])}`);
      if (m[10]) out.push(`${y}-${pad(mo)}-${pad(m[10])}`);
    }
  }
  return out;
}

function findStore(s) {
  const lower = s.toLowerCase();
  let best = null;
  for (const st of cfg.stores) {
    for (const a of [st.name, ...(st.aliases || [])]) {
      const i = lower.indexOf(a.toLowerCase());
      if (i !== -1 && (!best || i < best.i || (i === best.i && a.length > best.len))) best = { id: st.id, i, len: a.length };
    }
  }
  return best?.id ?? null;
}

function links(s) {
  const out = [];
  const md = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = md.exec(s))) out.push({ label: m[1].slice(0, 40), url: m[2] });
  const stripped = s.replace(md, "");
  for (const u of stripped.match(/https:\/\/[^\s)>\]]+/g) || []) out.push({ label: `Page ${out.length + 1}`, url: u.replace(/[.,;]+$/, "") });
  return out;
}

function section(name) {
  const re = new RegExp(`^##\\s+${name}\\s*$`, "im");
  const m = re.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return next === -1 ? rest : rest.slice(0, next);
}

const num = (s) => {
  const m = String(s).replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(¢|c\b|cents?)?/i);
  if (!m) return null;
  return m[2] ? round2(Number(m[1]) / 100) : Number(m[1]);
};

const PACK_UNITS = { lb: "lb", lbs: "lb", pound: "lb", pounds: "lb", oz: "oz", ounce: "oz", kg: "kg", g: "g", l: "l", liter: "l", litre: "l", ml: "ml", "fl oz": "fl-oz", "fl. oz": "fl-oz", floz: "fl-oz", gal: "gal", gallon: "gal", ct: "ct", count: "ct", pc: "ct", pcs: "ct", pk: "ct", dozen: "dozen", doz: "dozen" };

// Parse "Sale price" and "Unit" cells into price, quantity, unit, pack.
function parsePrice(priceCell, unitCell) {
  const p = priceCell.trim();
  const u = (unitCell || "").trim().toLowerCase();
  let quantity = 1;
  let price;
  const multi = p.match(/(\d+)\s*(?:\/|for)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (multi && !/^\$/.test(p)) {
    quantity = Number(multi[1]);
    price = Number(multi[2]);
  } else price = num(p);
  if (price == null) return null;

  let unit = null;
  let pack;
  const per = `${p} ${u}`.toLowerCase();
  if (/(\/|per\s*)\s*lb\b/.test(per) || /^(per\s+)?(lb|lbs|pound)$/.test(u)) unit = "lb";
  else if (/^(each|ea|per item|item|1)$/.test(u) || /\b(each|ea)\b/.test(p.toLowerCase())) unit = "each";
  else {
    const m = u.match(/(\d+(?:\.\d+)?)\s*-?\s*(fl\.? ?oz|floz|lbs?|pounds?|oz|ounces?|kg|g|liters?|litres?|l|ml|gal(?:lons?)?|ct|count|pcs?|pk|dozen|doz)\b/);
    if (m) {
      const key = m[2].replace(/\.$/, "").replace(/s$/, "").replace("ounce", "oz").replace("gallon", "gal").replace("pound", "lb");
      const pu = PACK_UNITS[key] ?? PACK_UNITS[m[2]] ?? (key.startsWith("fl") ? "fl-oz" : null);
      if (pu) {
        unit = "pack";
        pack = { size: Number(m[1]), unit: pu };
      }
    } else if (/dozen|doz/.test(u)) {
      unit = "pack";
      pack = { size: 1, unit: "dozen" };
    }
  }
  if (!unit) return { price, quantity, unit: null, unparsed_unit: unitCell };
  const out = { price: round2(price), quantity, unit };
  if (pack) out.pack = pack;
  return out;
}

function suggestKey(name) {
  const lower = name.toLowerCase();
  let best = null;
  for (const [key, item] of Object.entries(cfg.items)) {
    for (const word of item.match || []) {
      if (lower.includes(word) && (!best || word.length > best.len)) best = { key, len: word.length };
    }
  }
  return best?.key ?? null;
}

// The Deals key KitchenCatalog's matcher reads a name as: a strong match on an
// ingredient (not a ready-made product), then that item's own id, an older id in
// its "also", or the nearest parent that is a Deals key. Only a suggestion: on the
// week of Oct 23 about a third of these didn't compare on price (yogurt drinks as
// yogurt, egg whites as eggs, sliced shabu pork as shoulder), so a person decides.
const alsoKey = {};
for (const [id, it] of Object.entries(cfg.catalog.items)) for (const old of it.also ?? []) if (cfg.items[old]) alsoKey[id] ??= old;
function catalogKey(name) {
  const m = matchCatalog(cfg.catalog, name);
  if (m?.strength !== "strong" || cfg.catalog.items[m.id]?.product) return null;
  for (let id = m.id, hops = 0; id; id = cfg.catalog.items[id]?.parent, hops++) {
    const key = cfg.items[id] ? id : alsoKey[id];
    if (key) return { key, catalog: m.id, via: hops ? "parent" : "id" };
  }
  return null;
}

// ---------- flyers ----------

const flyers = [];
for (const line of section("Flyers").split("\n")) {
  if (!/^\s*[-*]\s+/.test(line)) continue;
  const store = findStore(line);
  if (!store) {
    flyers.push({ unmatched_line: line.trim() });
    continue;
  }
  const lower = line.toLowerCase();
  const status = /unreadable|not readable|no items|could not read|couldn't read/.test(lower)
    ? "unreadable"
    : /stale|last week|old dates|still show/.test(lower)
      ? "stale"
      : /partly|partial|only part|not fully/.test(lower)
        ? "partial"
        : "full";
  const dates = findDates(line.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/https:\/\/\S+/g, ""));
  flyers.push({
    store,
    status,
    valid_from: dates[0] ?? null,
    valid_through: dates[1] ?? null,
    links: links(line),
    note: status === "partial" || status === "stale"
      ? line.replace(/\[([^\]]*)\]\([^)]*\)/g, "").replace(/https:\/\/\S+/g, "").replace(/^\s*[-*]\s+/, "").replace(/\s+/g, " ").trim().slice(0, 300)
      : "",
    source_line: line.trim(),
  });
}

// ---------- items ----------

const rows = section("Items").split("\n").filter((l) => l.trim().startsWith("|"));
const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const header = rows.length ? cells(rows[0]).map((h) => h.toLowerCase()) : [];
const col = (name) => header.findIndex((h) => h.startsWith(name));
const C = {
  store: col("store"), item: col("item"), price: col("sale"), unit: col("unit"),
  regular: col("regular"), through: col("valid"), category: col("categ"), notes: col("note"),
};
const CATS = cfg.criteria.categories;
const items = [];
const review = [];
const suggested = [];
const skipped = [];
const leftOut = [];
const readStores = new Set(flyers.filter((f) => f.status === "full" || f.status === "partial").map((f) => f.store));
for (const r of rows.slice(1)) {
  if (/^\|?\s*:?-{2,}/.test(r.trim().replace(/^\|/, ""))) continue;
  const c = cells(r);
  const get = (k) => (C[k] >= 0 ? c[C[k]] ?? "" : "");
  const raw = { store: get("store"), item: get("item"), price: get("price"), unit: get("unit"), regular: get("regular"), through: get("through"), category: get("category"), notes: get("notes") };
  if (/unverified/i.test(raw.price) || /unverified/i.test(raw.regular)) {
    skipped.push({ reason: "unverified", ...raw });
    continue;
  }
  const store = findStore(raw.store);
  const parsed = parsePrice(raw.price, raw.unit);
  if (!store || !parsed || !parsed.unit) {
    skipped.push({ reason: !store ? "unknown store" : "could not parse price or unit", ...raw });
    continue;
  }
  if (!readStores.has(store)) {
    skipped.push({ reason: "store's flyer is not marked full or partial", ...raw });
    continue;
  }
  const key = suggestKey(raw.item);
  const d = { store, item: raw.item.slice(0, 120), item_key: key };
  const noteCat = raw.category.toLowerCase().trim();
  d.category = CATS.includes(noteCat) ? noteCat : (key ? cfg.items[key].category : "other");
  const leave = leaveOutReason(cfg, raw.item, d.category);
  if (leave) {
    leftOut.push({ reason: leave, store, item: raw.item, category: d.category });
    continue;
  }
  Object.assign(d, { price: parsed.price, quantity: parsed.quantity, unit: parsed.unit });
  if (parsed.pack) d.pack = parsed.pack;
  // Eggs compare per dozen, so express counted cartons in dozens.
  if (key === "eggs" && d.pack?.unit === "ct" && d.pack.size % 6 === 0) d.pack = { size: d.pack.size / 12, unit: "dozen" };
  const up = computeUnitPrice(d);
  d.unit_price = up ? { value: round2(up.value), per: up.per } : null;

  const prints = cfg.storeById[store].prints_regular_prices;
  const regular = raw.regular && !/^(-|n\/a|none|)$/i.test(raw.regular) && !/up to/i.test(raw.regular) ? num(raw.regular) : null;
  const pctPrinted = raw.regular.match(/(\d+)\s*%/);
  d.regular_price = prints && regular && regular > d.price && !pctPrinted ? round2(regular) : null;
  d.percent_off = d.regular_price ? percentOff(d.price, d.regular_price) : prints && pctPrinted && !/up to/i.test(raw.regular) ? Number(pctPrinted[1]) : null;
  if (!prints && raw.regular.trim() && !/^(-|n\/a|none)$/i.test(raw.regular)) review.push(`${store} "${raw.item}": regular price "${raw.regular}" dropped because config says this store prints none`);
  d.member_price = /member|card|loyalty|app only|app-only|prime/i.test(raw.notes);
  d.valid_through = findDates(raw.through)[0] ?? null;
  const notes = [raw.notes, /up to/i.test(raw.regular) ? `Printed as ${raw.regular.trim()}.` : ""].filter(Boolean).join(" ").trim();
  d.notes = notes.slice(0, 200);
  const fromCatalog = catalogKey(raw.item);
  if (!key && fromCatalog) {
    review.push(`${store} "${raw.item}": no item_key; KitchenCatalog reads it as ${fromCatalog.catalog}, key ${fromCatalog.key}${fromCatalog.via === "parent" ? " (a parent)" : ""}. Use it only if it compares on price with other ${fromCatalog.key} listings`);
    suggested.push({ store, item: raw.item, suggest: fromCatalog.key, catalog: fromCatalog.catalog, via: fromCatalog.via });
  } else if (!key) review.push(`${store} "${raw.item}": no item_key suggested`);
  else if (fromCatalog && fromCatalog.key !== key) {
    review.push(`${store} "${raw.item}": key ${key}, but KitchenCatalog reads it as ${fromCatalog.catalog}, key ${fromCatalog.key}; pick one`);
    suggested.push({ store, item: raw.item, current: key, suggest: fromCatalog.key, catalog: fromCatalog.catalog, via: fromCatalog.via });
  }
  if (key && cfg.items[key].category !== d.category) review.push(`${store} "${raw.item}": key ${key} is ${cfg.items[key].category}, note says ${d.category}; check the key`);
  items.push(d);
}

// ---------- one row per product line ----------

// Flavors and varieties sold at one price become one row (collapseVariants in lib.mjs).
const { items: collapsed, merged: variants } = collapseVariants(items, cfg.storeById);
items.splice(0, items.length, ...collapsed);

// ---------- rank, to help pick highlights ----------

const allWeeks = loadWeeks().map((w) => w.data);
const prior = priorListings(allWeeks, week);
const peers = peerPrices(items);
const ranked = items.map((i) => ({ i, a: analyze(i, { cfg, prior, peers }) })).sort((x, y) => y.a.score - x.a.score);

// ---------- write ----------

const out = join(ROOT, "drafts", `${week}.json`);
mkdirSync(join(ROOT, "drafts"), { recursive: true });
const weekFile = { week, flyers: flyers.filter((f) => f.store).map(({ source_line, ...f }) => (f.note ? f : (delete f.note, f))), items };
writeFileSync(out, JSON.stringify(weekFile, null, 2) + "\n");
writeFileSync(join(ROOT, "drafts", `${week}.report.json`), JSON.stringify({ skipped, left_out: leftOut, merged_variants: variants, review, suggested_keys: suggested, unmatched_flyer_lines: flyers.filter((f) => f.unmatched_line).map((f) => f.unmatched_line) }, null, 2) + "\n");

const tiers = { standout: 0, good: 0, sale: 0 };
for (const r of ranked) tiers[r.a.tier]++;
console.log(`Week ${week}: ${weekFile.flyers.length} flyers, ${items.length} items (${tiers.standout} standouts, ${tiers.good} good), ${skipped.length} skipped, ${leftOut.length} left out as snacks or packaged food.\n`);
console.log("Top 15 by score (candidates for a highlight reason):");
for (const { i, a } of ranked.slice(0, 15)) {
  console.log(`  ${a.tier.padEnd(8)} ${i.store.padEnd(14)} ${i.item.slice(0, 42).padEnd(42)} ${priceText(i).padEnd(18)} ${a.tags.map((t) => t.text).join(", ")}`);
}
if (review.length) console.log(`\nCheck by hand (${review.length}):\n${review.map((r) => "  " + r).join("\n")}`);
if (skipped.length) console.log(`\nSkipped (${skipped.length}): ${Object.entries(skipped.reduce((m, s) => ((m[s.reason] = (m[s.reason] ?? 0) + 1), m), {})).map(([k, v]) => `${v} ${k}`).join(", ")}`);
if (leftOut.length) console.log(`\nLeft out as snacks or packaged food (${leftOut.length}; the reader should have skipped these, see left_out in the report; to keep one, add a word to keep_words in config/leave-out.json):\n${leftOut.map((l) => `  ${l.store} "${l.item}": ${l.reason}`).join("\n")}`);
if (variants.length) console.log(`\nFlavors and varieties joined into one row (${variants.length}; check the names read well, see merged_variants in the report):\n${variants.map((v) => `  ${v.store} "${v.item}" from ${v.from.length} rows`).join("\n")}`);
const unmatched = flyers.filter((f) => f.unmatched_line);
if (unmatched.length) console.log(`\nFlyer lines with no known store:\n${unmatched.map((f) => "  " + f.unmatched_line).join("\n")}`);
console.log(`\nWrote ${out}\nDetails in drafts/${week}.report.json. Validate with: node scripts/validate.mjs ${out}`);
