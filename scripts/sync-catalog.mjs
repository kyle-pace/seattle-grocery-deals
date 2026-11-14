// Copies the shared KitchenCatalog (a sibling checkout) into vendor/kitchen-catalog/, and its
// stickers into the app's asset catalog.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Not lib.mjs's ROOT: lib.mjs imports the vendored files this script is about to copy.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const src = process.env.KITCHEN_CATALOG ?? join(ROOT, "..", "KitchenCatalog");
const files = [["js/catalog.mjs", "catalog.mjs"], ["Sources/KitchenCatalog/Resources/catalog.json", "catalog.json"],
  // What's in season (since 2026-10-31): the site's season pages and the app feed's seasons.
  ["js/seasons.mjs", "seasons.mjs"], ["Sources/KitchenCatalog/Resources/seasons.json", "seasons.json"],
  // The drawings on the app's deal rows (since 2026-11-14): the feed names one per deal.
  ["js/stickers.mjs", "stickers.mjs"], ["stickers/stickers.json", "stickers.json"]];
if (!existsSync(src)) {
  console.error(`No KitchenCatalog at ${src}. Clone it next to this repo or set KITCHEN_CATALOG.`);
  process.exit(1);
}
for (const [from, to] of files) {
  // A file the checkout doesn't have (it's on another branch there): keep the copy already here.
  if (!existsSync(join(src, from))) { console.warn(`Kept vendor/kitchen-catalog/${to}: ${from} isn't in ${src}.`); continue; }
  copyFileSync(join(src, from), join(ROOT, "vendor", "kitchen-catalog", to));
}
console.log(`Copied KitchenCatalog from ${src}.`);

// One image set per sticker in Assets.xcassets/Stickers, so the app shows `Image("Stickers/bok-choy")`.
// The folder is rebuilt each time: a sticker removed from the catalog leaves the app too.
const { load, shapes, svg } = await import("../vendor/kitchen-catalog/stickers.mjs");
const stickers = load(join(ROOT, "vendor", "kitchen-catalog", "stickers.json"));
const assets = join(ROOT, "apple", "GroceryDeals", "Resources", "Assets.xcassets", "Stickers");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });
writeFileSync(join(assets, "Contents.json"), json({ info: { author: "xcode", version: 1 }, properties: { "provides-namespace": true } }));
const names = Object.keys(stickers.stickers).sort();
for (const name of names) {
  const set = join(assets, `${name}.imageset`);
  mkdirSync(set);
  writeFileSync(join(set, `${name}.svg`), svg(shapes(stickers, name)));
  // Kept as vectors, so the same drawing is sharp on a row and on the deal sheet.
  writeFileSync(join(set, "Contents.json"), json({ images: [{ filename: `${name}.svg`, idiom: "universal" }],
    info: { author: "xcode", version: 1 }, properties: { "preserves-vector-representation": true } }));
}
console.log(`Wrote ${names.length} stickers to apple/GroceryDeals/Resources/Assets.xcassets/Stickers.`);
