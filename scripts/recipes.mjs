// Recipe ideas for this week's deals: /api/recipes.json, a few recipes for each ingredient
// that's on sale, taken from the recipe search index (kylepace.dev/recipe-search, the owner's
// own index of trusted recipe sites). Run by the build (scripts/build.mjs calls writeRecipes)
// and on its own: node scripts/recipes.mjs
//
// Worked out here, at build time, so the app and the site only ever read a small static file
// from this site: looking at a deal tells no one what you looked at. Each idea is a name and
// a link to the recipe on its own site, never the recipe itself.
//
// Deals and the index both name ingredients with KitchenCatalog ids ("pork-chops"), so the
// match is by id. Only deals with an `item_key` get ideas; branded and packaged items don't.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const INDEX_URL = "https://kylepace.dev/recipe-search/index.json";
export const SEARCH_URL = "https://kylepace.dev/recipe-search/";
export const ABOUT_URL = "https://kylepace.dev/recipe-search/about/";
const LIVE_COPY = "https://seattlegrocery.deals/api/recipes.json";
/** Ideas kept per ingredient, and how many of them one creator can have. */
const PER_KEY = 6;
const PER_CREATOR = 2;
/** When fewer than this many of the picks are vegetarian, more are added for "Vegetarian deals only". */
const VEG_WANTED = 4;

/** Under this many recipes, an ingredient borrows its parent's. */
const THIN = 3;

/** A steady number from a string (FNV-1a), for the weekly shuffle. */
function mix(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const singular = (w) => (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);
const words = (id) => id.split("-").map(singular);
const wordKey = (id) => words(id).sort().join(" ");
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).map(singular).join(" ")} `;

/**
 * Where a deal's item key sits in the index's ingredient list, or -1. An exact id first; then
 * the same words in another order (the deals say "pork-ground", the index "ground-pork");
 * then the catalog's parent ("salmon-atlantic" is a kind of "salmon"); then the key with its
 * last words dropped ("pork-stew" to "pork"), for keys the catalog copy here doesn't know.
 */
export function positionFor(key, index, catalog, lookups = lookupsFor(index)) {
  const { byId, byWords } = lookups;
  if (byId.has(key)) return byId.get(key);
  if (byWords.has(wordKey(key))) return byWords.get(wordKey(key));
  const item = catalog?.items?.[key];
  if (item) {
    // A stand-in only for staples: Atlantic salmon cooks like salmon, but beef feet and
    // tripe don't cook like "beef", so those get no ideas.
    if (!item.deals?.staple) return -1;
    for (let p = item.parent, n = 0; p && n < 10; p = catalog.items[p]?.parent, n++) {
      if (byId.has(p)) return byId.get(p);
    }
    return -1;
  }
  const parts = key.split("-");
  for (let n = parts.length - 1; n >= 1; n--) {
    const head = parts.slice(0, n).join("-");
    if (byId.has(head)) return byId.get(head);
    if (byWords.has(wordKey(head))) return byWords.get(wordKey(head));
  }
  return -1;
}

export function lookupsFor(index) {
  const byId = new Map(index.ing.map((row, i) => [row[0], i]));
  const byWords = new Map();
  index.ing.forEach((row, i) => { if (!byWords.has(wordKey(row[0]))) byWords.set(wordKey(row[0]), i); });
  return { byId, byWords };
}

/**
 * The recipe ideas for each item key. `index` is the recipe search index
 * (recipe rows are [source, name, path, minutes, cuisine, ingredients with parents, own
 * ingredients, photo, keywords, opens]).
 */
export function recipesFor(index, catalog, keys, week = "") {
  const lookups = lookupsFor(index);
  const meat = new Set(index.diet?.vegetarian ?? []);
  // Each ingredient's recipes, found once.
  const using = new Map();
  index.recipes.forEach((r, i) => { for (const p of r[5]) (using.get(p) ?? using.set(p, []).get(p)).push(i); });

  const byKey = {};
  for (const key of [...new Set(keys)].filter(Boolean).sort()) {
    const pos = positionFor(key, index, catalog, lookups);
    if (pos < 0) continue;
    const [id, name, , , ...aliases] = index.ing[pos];
    let names = [name, ...aliases].map(norm);
    let own = [pos];
    // Very few recipes name it (navel oranges): add the ones for what it's a kind of (oranges).
    let found = using.get(pos) ?? [];
    if (found.length < THIN) {
      const parents = index.ing[pos][3];
      found = [...new Set([...found, ...parents.flatMap((p) => using.get(p) ?? [])])];
      names = names.concat(parents.flatMap((p) => { const [, n, , , ...a] = index.ing[p]; return [n, ...a].map(norm); }));
      own = own.concat(parents);
    }
    const scored = found.map((i) => {
      const r = index.recipes[i];
      const title = norm(r[1]);
      let score = Math.min(4, Math.log2(1 + (r[9] || 0))); // what people open, a little
      if (names.some((n) => title.includes(n))) score += 8; // "Pork Chops with ..." leads
      if (own.some((p) => r[6].includes(p))) score += 2; // names this very thing, not just a kind of it
      if (r[7]) score += 1; // has a photo
      if (r[3]) score += 0.5; // says how long it takes
      score -= Math.max(0, r[6].length - 12) * 0.25; // long shopping lists sink a little
      // Ties are common (most recipes have no opens yet): a shuffle that holds for the week,
      // so the ideas change with the deals and not with every hourly build.
      return { i, r, score, mix: mix(`${week}|${key}|${r[2]}`), veg: !r[5].some((p) => meat.has(p)) };
    }).sort((a, b) => b.score - a.score || a.mix - b.mix);
    if (!scored.length) continue;

    // The best few, but spread across creators so one site doesn't fill the list.
    const picks = [];
    const perCreator = new Map();
    const take = (h) => {
      if (picks.includes(h) || (perCreator.get(h.r[0]) ?? 0) >= PER_CREATOR) return false;
      perCreator.set(h.r[0], (perCreator.get(h.r[0]) ?? 0) + 1);
      picks.push(h);
      return true;
    };
    for (const h of scored) { if (picks.length >= PER_KEY) break; take(h); }
    // Enough vegetarian ones for people who only want those (tofu with pork is common).
    let veg = picks.filter((h) => h.veg).length;
    for (const h of scored) { if (veg >= VEG_WANTED) break; if (h.veg && take(h)) veg++; }

    byKey[key] = {
      ingredient: name,
      // The rest, on the recipe search page.
      more: `${SEARCH_URL}?with=${encodeURIComponent(id)}`,
      total: scored.length,
      recipes: picks.map(({ r, veg }) => {
        const src = index.sources[r[0]];
        return { name: r[1], url: src.site + r[2], site: src.name, minutes: r[3] ?? null, cuisine: r[4] || null, image: r[7] || null, veg };
      }),
    };
  }
  return byKey;
}

async function getJSON(url, ms = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/**
 * Writes dist/api/recipes.json for the feed's deals. Never fails the build: if the index
 * can't be read, the copy that's live now is kept, and failing that the file says so and
 * holds no ideas (the app then shows none).
 */
export async function writeRecipes(feed, distDir, { catalog, indexPath = process.env.RECIPES_INDEX } = {}) {
  const base = { week: feed.week, about: ABOUT_URL, search: SEARCH_URL };
  let out;
  try {
    const index = indexPath ? JSON.parse(readFileSync(indexPath, "utf8")) : await getJSON(INDEX_URL);
    out = { ...base, index_built: index.built ?? null, by_key: recipesFor(index, catalog, feed.items.map((i) => i.key), feed.week) };
  } catch (err) {
    console.warn(`recipes: ${err.message}`);
    try {
      const live = await getJSON(LIVE_COPY, 10000);
      out = { ...base, index_built: live.index_built ?? null, by_key: live.by_key ?? {}, note: "Kept from the last build." };
    } catch {
      out = { ...base, index_built: null, by_key: {}, note: "The recipe index couldn't be read for this build." };
    }
  }
  mkdirSync(join(distDir, "api"), { recursive: true });
  writeFileSync(join(distDir, "api", "recipes.json"), JSON.stringify(out));
  const n = Object.keys(out.by_key).length;
  console.log(`recipes.json: ideas for ${n} ingredients${out.note ? ` (${out.note})` : ""}`);
  return out;
}

// Run on its own against the built feed.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const feed = JSON.parse(readFileSync(join(root, "dist", "api", "week.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(root, "vendor", "kitchen-catalog", "catalog.json"), "utf8"));
  await writeRecipes(feed, join(root, "dist"), { catalog });
}
