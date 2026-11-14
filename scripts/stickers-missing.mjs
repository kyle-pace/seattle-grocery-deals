// Which items on the flyers have no sticker of their own yet, most listed first: the list of
// what's worth drawing next. Counts the last few weeks (default 6).
// Usage: node scripts/stickers-missing.mjs [weeks]
import { loadConfig, loadWeeks, stickerFor } from "./lib.mjs";
import { match } from "../vendor/kitchen-catalog/catalog.mjs";

const cfg = loadConfig();
const weeks = loadWeeks().map((w) => w.data).slice(-(Number(process.argv[2]) || 6));
const missing = new Map();
let rows = 0, own = 0, parent = 0, section = 0;
for (const week of weeks) {
  for (const item of week.items) {
    rows++;
    const k = item.item_key;
    let id = k && (cfg.catalog.items[k] ? k : cfg.catalogIdByKey[k]);
    if (!id) {
      const m = match(cfg.catalog, item.item);
      if (m?.strength === "strong") id = m.id;
    }
    const sticker = stickerFor(item, cfg);
    if (id && sticker === id) { own++; continue; }
    if (sticker && !sticker.startsWith("section-")) parent++; else section++;
    if (!id) continue;
    const entry = missing.get(id) ?? { count: 0, shows: sticker };
    entry.count++;
    missing.set(id, entry);
  }
}
const pct = (n) => `${Math.round((100 * n) / rows)}%`;
console.log(`${rows} flyer lines over ${weeks.length} weeks: ${pct(own)} show their own sticker, ${pct(parent)} a more general item's, ${pct(section)} their section's.`);
console.log("No sticker of their own yet (times listed, what shows now):");
for (const [id, e] of [...missing].sort((a, b) => b[1].count - a[1].count).slice(0, Number(process.argv[3]) || 60)) console.log(`  ${String(e.count).padStart(3)}  ${id}  (${e.shows ?? "nothing"})`);
