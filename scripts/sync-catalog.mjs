// Copies the shared KitchenCatalog (a sibling checkout) into vendor/kitchen-catalog/.
//
//   node scripts/sync-catalog.mjs [--allow-drop]      (KITCHEN_CATALOG=<path> for another checkout)
//
// It checks everything before copying anything, so a sync never leaves half a copy:
// - Every file has to be there. Seasons are the exception: they live on KitchenCatalog's
//   `seasons` branch until that is merged, so a checkout without them keeps the copy here.
// - It stops when an item id in the copy here is missing from the checkout (ids never change
//   in KitchenCatalog; a merged one moves into the survivor's `also`), which means the
//   checkout is behind or on the wrong branch. --allow-drop goes ahead anyway.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const src = process.env.KITCHEN_CATALOG ?? join(ROOT, "..", "KitchenCatalog");
const dest = join(ROOT, "vendor", "kitchen-catalog");
const allowDrop = process.argv.includes("--allow-drop");
const files = [["js/catalog.mjs", "catalog.mjs"], ["Sources/KitchenCatalog/Resources/catalog.json", "catalog.json"]];
// What's in season (since 2026-10-31): the site's season pages and the app feed's seasons.
const seasons = [["js/seasons.mjs", "seasons.mjs"], ["Sources/KitchenCatalog/Resources/seasons.json", "seasons.json"]];

/** Item ids `current` has that `incoming` no longer answers to, by id or by `also`. */
export function lostItems(current, incoming) {
  const known = new Set(Object.keys(incoming?.items ?? {}));
  for (const item of Object.values(incoming?.items ?? {})) for (const id of item.also ?? []) known.add(id);
  return Object.keys(current?.items ?? {}).filter((id) => !known.has(id));
}

function stop(message) {
  console.error(`${message}\nNothing was copied.`);
  process.exit(1);
}

if (process.argv[1]?.endsWith("sync-catalog.mjs")) {
  if (!existsSync(src)) stop(`No KitchenCatalog at ${src}. Clone it next to this repo or set KITCHEN_CATALOG.`);
  const missing = files.filter(([from]) => !existsSync(join(src, from))).map(([from]) => from);
  if (missing.length) stop(`KitchenCatalog at ${src} is missing ${missing.join(", ")}.`);
  const hasSeasons = seasons.every(([from]) => existsSync(join(src, from)));
  let incoming;
  try {
    incoming = JSON.parse(readFileSync(join(src, files[1][0]), "utf8"));
  } catch (e) {
    stop(`${join(src, files[1][0])} isn't valid JSON (${e.message}).`);
  }
  if (!Object.keys(incoming.items ?? {}).length) stop("The incoming catalog has no items.");
  const here = join(dest, "catalog.json");
  const lost = existsSync(here) ? lostItems(JSON.parse(readFileSync(here, "utf8")), incoming) : [];
  if (lost.length && !allowDrop) {
    stop(`${lost.length} item id(s) here would disappear: ${lost.slice(0, 10).join(", ")}${lost.length > 10 ? " and more" : ""}.\n` +
      `Is the checkout behind (git pull there) or on another branch? If this is meant, run it again with --allow-drop.`);
  }
  for (const [from, to] of [...files, ...(hasSeasons ? seasons : [])]) copyFileSync(join(src, from), join(dest, to));
  console.log(`Copied KitchenCatalog from ${src}.` + (hasSeasons ? "" : " It has no seasons files (they are on its `seasons` branch), so the seasons copy here was left as it is."));
}
