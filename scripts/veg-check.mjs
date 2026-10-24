// Lists the items outside meat and seafood that the site would show as
// vegetarian, so a person (or the Friday routine) can catch any that contain
// meat or fish. Usage: node scripts/veg-check.mjs drafts/2026-10-30.json
import { readJson, isVegetarian } from "./lib.mjs";

const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/veg-check.mjs <week file>"); process.exit(1); }
const items = readJson(file).items;
const loose = ["frozen", "prepared", "pantry", "bakery", "snacks-drinks", "other"];
const shown = items.filter((i) => loose.includes(i.category) && isVegetarian(i));
console.log(`${items.filter(isVegetarian).length} of ${items.length} items would show as vegetarian.`);
console.log(`Check these ${shown.length} for hidden meat or fish (set "vegetarian": false on any that have it):`);
for (const i of shown) console.log(`  ${i.store}  ${i.category}  ${i.item}`);
