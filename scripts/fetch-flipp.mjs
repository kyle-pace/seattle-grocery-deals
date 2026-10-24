// Pulls this week's flyer for every store with a `flipp` entry in
// config/stores.json from Flipp's indexed listings, and writes the rows in the
// same shape as an All Items note (see UPDATING.md), so they can be pasted into
// the note and drafted with draft-week.mjs.
// Usage: node scripts/fetch-flipp.mjs YYYY-MM-DD [out.md]
// The date is the week's Friday. Output defaults to work/flipp-YYYY-MM-DD.md.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { ROOT, loadConfig, isFriday } from "./lib.mjs";

const API = "https://backflipp.wishabi.com/flipp";
const cfg = loadConfig();
const week = process.argv[2];
if (!week || !isFriday(week)) {
  console.error("Usage: node scripts/fetch-flipp.mjs YYYY-MM-DD [out.md] (the week's Friday)");
  process.exit(1);
}
const outPath = process.argv[3] ?? join(ROOT, "work", `flipp-${week}.md`);

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${API}/${path}`, { headers: { "user-agent": "seattlegrocery.deals weekly fetch" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${path}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Run fn over items, a few at a time.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const day = (iso) => (iso ? iso.slice(0, 10) : null);
const money = (n) => `$${n.toFixed(2)}`;
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").replace(/\u2014/g, ", ").trim();

// "Save $3.00 lb", "Save 50¢", "save $1.50": an exact amount, or null.
// "Save up to" and percentages are not exact (UPDATING.md section 3).
function exactSavings(story) {
  if (!story || /up to|%/i.test(story)) return null;
  const m = story.match(/save\s+\$?\s*(\d+(?:\.\d+)?)\s*(¢|c\b)?/i);
  if (!m) return null;
  return m[2] ? Number(m[1]) / 100 : Number(m[1]);
}

// The weekly flyer for a store: the one covering the Friday with the shortest
// run, so monthly or holiday catalogues lose to the weekly ad.
function pickFlyer(flyers, merchant) {
  const want = merchant.toLowerCase();
  return flyers
    .filter((f) => f.merchant.trim().toLowerCase() === want)
    .filter((f) => day(f.valid_from) <= week && day(f.valid_to) >= week)
    .sort((a, b) => (Date.parse(a.valid_to) - Date.parse(a.valid_from)) - (Date.parse(b.valid_to) - Date.parse(b.valid_from)))[0];
}

function row(store, it) {
  const price = Number(it.current_price);
  const pre = (it.pre_price_text ?? "").trim();
  const multi = pre.match(/^(\d+)\s*(?:\/|for)$/i);
  const perLb = /\blb\b|pound/i.test(it.price_text ?? "");
  const size = cell(it.description).match(/^[\d.\-\s]+(?:fl\.? ?oz|oz|lbs?|ct|pk|g|kg|ml|l|gal|dozen|pc|pcs)\.?(?=\W|$)/i)?.[0];
  const name = cell([it.brand && !it.name.toLowerCase().includes(it.brand.toLowerCase()) ? it.brand : "", it.name].filter(Boolean).join(" "));
  const item = size ? `${name}, ${size.replace(/\.$/, "")}` : name;
  const priceCell = multi ? `${multi[1]}/${money(price)}` : money(price);
  const unitCell = perLb ? "lb" : "ea";
  let regular = "";
  if (it.original_price) regular = money(Number(it.original_price));
  else {
    const save = exactSavings(it.sale_story);
    const buyN = Number(it.sale_story?.match(/when you buy (\d+)/i)?.[1] ?? 1);
    if (save != null && (multi ? buyN === Number(multi[1]) : buyN === 1)) regular = money(price + save);
  }
  const notes = [
    // Flipp enters some multi-buys as the total ("4 for" $5) and some as the
    // price of one ("4/" $1.25), so every multi-buy is checked against the flyer.
    multi ? `CHECK: Flipp shows "${pre}" with ${money(price)}; confirm on the flyer whether that is the price for ${multi[1]} or for one. Item image: ${it.cutout_image_url}` : "",
    it.sale_story && !regular ? it.sale_story : "",
    pre && !multi ? `Printed before the price: "${pre}".` : "",
    it.disclaimer_text ?? "",
  ].filter(Boolean).map(cell).join(" ");
  return `| ${store.name} | ${item} | ${priceCell} | ${unitCell} | ${regular} | ${day(it.valid_to) ?? ""} |  | ${notes} |`;
}

const stores = cfg.stores.filter((s) => s.active && s.flipp);
const byPostal = new Map();
for (const s of stores) {
  const pc = s.flipp.postal_code;
  if (!byPostal.has(pc)) byPostal.set(pc, (await get(`flyers?locale=en-us&postal_code=${pc}`)).flyers);
}

const flyerLines = [];
const itemLines = [];
const summary = [];
for (const s of stores) {
  const flyer = pickFlyer(byPostal.get(s.flipp.postal_code), s.flipp.merchant);
  if (!flyer) {
    flyerLines.push(`- ${s.name}: no Flipp flyer covering ${week} | [flyer page](${s.flyer_url}) | status: unreadable, not found on Flipp`);
    summary.push(`${s.id}: no flyer found`);
    continue;
  }
  const { items } = await get(`flyers/${flyer.id}?locale=en-us`);
  const priced = items.filter((i) => i.price && Number(i.price) > 0);
  const details = await pool(priced, 6, async (i) => (await get(`items/${i.id}?locale=en-us`)).item);
  flyerLines.push(`- ${s.name}: ${day(flyer.valid_from)} to ${day(flyer.valid_to)} | [weekly ad](${s.flyer_url}) | status: full, read from the store's indexed listing on Flipp (flyer ${flyer.id})`);
  for (const d of details) itemLines.push(row(s, d));
  summary.push(`${s.id}: flyer ${flyer.id}, ${day(flyer.valid_from)} to ${day(flyer.valid_to)}, ${details.length} priced items (${items.length - priced.length} unpriced tiles skipped)`);
}

const md = `---
type: flipp-rows
week-of: ${week}
---

Rows pulled from Flipp by scripts/fetch-flipp.mjs. Category is left blank, and
non-food items are still in. Fill in categories, drop non-food, and check pack
sizes before merging into the All Items note.

## Flyers

${flyerLines.join("\n")}

## Items

| Store | Item (as printed) | Sale price | Unit | Regular price (only if printed) | Valid through | Category | Notes |
|---|---|---|---|---|---|---|---|
${itemLines.join("\n")}
`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md);
console.log(summary.join("\n"));
console.log(`\nWrote ${itemLines.length} rows to ${outPath}`);
