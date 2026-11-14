// Copies the shared KitchenCatalog (a sibling checkout) into vendor/kitchen-catalog/.
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const src = process.env.KITCHEN_CATALOG ?? join(ROOT, "..", "KitchenCatalog");
const files = [["js/catalog.mjs", "catalog.mjs"], ["Sources/KitchenCatalog/Resources/catalog.json", "catalog.json"],
  // What's in season (since 2026-10-31): the site's season pages and the app feed's seasons.
  ["js/seasons.mjs", "seasons.mjs"], ["Sources/KitchenCatalog/Resources/seasons.json", "seasons.json"]];
if (!existsSync(src)) {
  console.error(`No KitchenCatalog at ${src}. Clone it next to this repo or set KITCHEN_CATALOG.`);
  process.exit(1);
}
for (const [from, to] of files) copyFileSync(join(src, from), join(ROOT, "vendor", "kitchen-catalog", to));
console.log(`Copied KitchenCatalog from ${src}.`);
