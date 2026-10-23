// Turns an "All Items YYYY-MM-DD.md" note into drafts/YYYY-MM-DD.draft.json:
// flyer entries ready to copy, and every readable item as a candidate with
// parsed prices, a suggested item_key, and whether it meets the criteria.
// Choosing deals and writing reasons stays a judgment step (see UPDATING.md).
// Usage: node scripts/draft-week.mjs "/path/to/All Items 2026-10-23.md"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { ROOT, loadConfig, loadWeeks, priorListings, lowestPrior, computeUnitPrice, round2, percentOff, judge, isFriday } from "./lib.mjs";

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
const prior = priorListings(loadWeeks().map((w) => w.data), week);

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
    note: "",
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
const candidates = [];
const skipped = [];
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
  const d = { store, item: raw.item, ...parsed };
  // Eggs compare per dozen, so express counted cartons in dozens.
  if (suggestKey(raw.item) === "eggs" && d.pack?.unit === "ct" && d.pack.size % 6 === 0) d.pack = { size: d.pack.size / 12, unit: "dozen" };
  const up = computeUnitPrice(d);
  d.unit_price = up ? { value: round2(up.value), per: up.per } : null;
  const regular = raw.regular && !/^(-|n\/a|none|)$/i.test(raw.regular) ? num(raw.regular) : null;
  d.regular_price = regular && regular > d.price ? round2(regular) : null;
  d.percent_off = d.regular_price ? percentOff(d.price, d.regular_price) : null;
  const pctPrinted = raw.regular.match(/(\d+)\s*%/);
  if (!d.percent_off && pctPrinted) d.percent_off = Number(pctPrinted[1]);
  d.valid_through = findDates(raw.through)[0] ?? null;
  d.category_in_note = raw.category;
  d.notes_in_note = raw.notes;
  d.item_key_suggested = suggestKey(raw.item);

  // Check both ways it could qualify, using the suggested key.
  const item = cfg.items[d.item_key_suggested];
  const checks = {};
  if (item) {
    const base = { ...d, item_key: d.item_key_suggested, category: item.category };
    if (d.percent_off != null && cfg.storeById[store].prints_regular_prices) {
      checks.printed = judge({ ...base, reference: "printed" }, cfg);
    }
    if (item.benchmark && d.unit_price) {
      const b = cfg.benchmarks[item.benchmark];
      checks.us_average = judge({ ...base, reference: "us-average", us_average: { benchmark: item.benchmark, price: b.price, per: b.per, period: b.period } }, cfg);
    }
    if (d.unit_price) {
      const low = lowestPrior(base, prior);
      if (low) {
        checks.site_history = judge({ ...base, reference: "site-history" }, cfg, prior);
        d.site_history_suggested = { price: low.price, per: low.per, week: low.week, store: low.store };
      }
    }
  }
  d.checks = checks;
  d.meets_criteria = Object.values(checks).some((j) => j.ok);
  // Produce, meat and seafood with nothing to compare against can still go in on judgment.
  d.judgment_candidate = !d.meets_criteria && cfg.criteria.no_reference.allowed &&
    cfg.criteria.no_reference.categories.includes(item?.category ?? raw.category.toLowerCase());
  d.strength = Math.max(0, ...Object.values(checks).filter((j) => j.ok).map((j) => j.strength));
  candidates.push(d);
}
candidates.sort((a, b) => b.meets_criteria - a.meets_criteria || b.strength - a.strength);

// ---------- write ----------

mkdirSync(join(ROOT, "drafts"), { recursive: true });
const out = join(ROOT, "drafts", `${week}.draft.json`);
writeFileSync(out, JSON.stringify({ week, source: basename(notePath), flyers, candidates, skipped }, null, 2) + "\n");

const meets = candidates.filter((c) => c.meets_criteria);
console.log(`Week ${week}: ${flyers.length} flyer lines, ${candidates.length} readable items, ${skipped.length} skipped.`);
console.log(`${meets.length} items meet the criteria (by suggested key). Review all candidates; keys are only suggestions.\n`);
for (const c of meets) {
  const how = Object.entries(c.checks).filter(([, j]) => j.ok).map(([k, j]) => `${k}: ${j.why}`).join("; ");
  console.log(`  ${c.store.padEnd(15)} ${c.item.slice(0, 44).padEnd(44)} ${String(c.price).padStart(6)} ${c.unit.padEnd(5)} ${c.item_key_suggested}  (${how})`);
}
const judged = candidates.filter((c) => c.judgment_candidate).length;
if (judged) console.log(`\n${judged} produce, meat or seafood items did not meet a test but could go in on judgment (reference "none"). Look through them for clearly good prices.`);
const unkeyed = candidates.filter((c) => !c.item_key_suggested).length;
if (unkeyed) console.log(`\n${unkeyed} items had no suggested key. Check them by hand, and add keys to config/items.json if needed.`);
const unmatched = flyers.filter((f) => f.unmatched_line);
if (unmatched.length) console.log(`\nFlyer lines with no known store:\n${unmatched.map((f) => "  " + f.unmatched_line).join("\n")}`);
console.log(`\nWrote ${out}`);
