// Recipe ideas for this week's deals: /api/recipes.json, taken from the recipe search index
// (kylepace.dev/recipe-search, the owner's own index of trusted recipe sites). Run by the
// build (scripts/build.mjs calls writeRecipes) and on its own: node scripts/recipes.mjs
//
// Two kinds of ideas, both worked out here at build time so the app only ever reads one small
// static file from this site, the same for everyone:
//   by_key    up to 24 recipes for each ingredient on sale ("pork-chops"), in pages of six,
//             each page spread across creators, so the deal sheet's "Something else" has
//             somewhere to go.
//   by_store  up to 12 recipes for each store that use two or more of its deals this week,
//             for the quiet row at the bottom of a store's page.
// Each idea is a name and a link to the recipe on its own site, never the recipe itself.
//
// Deals and the index both name ingredients with KitchenCatalog ids, so the match is by id.
// Only deals with an `item_key` get ideas; branded and packaged items don't.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const INDEX_URL = "https://kylepace.dev/recipe-search/index.json";
export const SEARCH_URL = "https://kylepace.dev/recipe-search/";
export const ABOUT_URL = "https://kylepace.dev/recipe-search/about/";
/** Where the app asks for recipes that use several things on a list (recipe search's own endpoint). */
export const WITH_URL = "https://kylepace.dev/recipe-search/api/with";
const LIVE_COPY = "https://seattlegrocery.deals/api/recipes.json";

/** One page of ideas: what the row shows before "Something else". */
export const PAGE = 6;
/** How many of a page one creator can have. */
const PER_CREATOR = 2;
/** Ideas kept per ingredient (four pages). */
const PER_KEY = 24;
/** Ideas kept per store (two pages), and the fewest worth a row. */
const PER_STORE = 12;
const STORE_MIN = 3;
/** Vegetarian ideas wanted per list, for "Vegetarian deals only" (added after the best ones if short). */
const VEG_WANTED = { key: 12, store: 6 };
/** Under this many recipes, an ingredient borrows its parent's (navel oranges take oranges'). */
const THIN = 3;
/** A store's deal counts for more when it's a standout. */
const TIER_WEIGHT = { standout: 3, good: 2 };
/**
 * In this share of recipes or more, an ingredient is pantry (oil, garlic, eggs, butter, soy
 * sauce: each in 1 in 6 recipes or more): on sale or not, it doesn't make a recipe a reason to
 * shop at a store, so the store row doesn't count it.
 */
export const PANTRY_SHARE = 0.15;

/** A steady number from a string (FNV-1a), for a shuffle that holds for the week. */
function mix(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const singular = (w) => (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);
const wordKey = (id) => id.split("-").map(singular).sort().join(" ");
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).map(singular).join(" ")} `;

export function lookupsFor(index) {
  const byId = new Map(index.ing.map((row, i) => [row[0], i]));
  const byWords = new Map();
  index.ing.forEach((row, i) => { if (!byWords.has(wordKey(row[0]))) byWords.set(wordKey(row[0]), i); });
  return { byId, byWords };
}

/**
 * Where a deal's item key sits in the index's ingredient list, and how it was found, or null.
 * An exact id first (`id`); then the same words in another order (`words`: the deals say
 * "pork-ground", the index "ground-pork"); then, for staples, the catalog parent (`parent`:
 * Atlantic salmon cooks like salmon, but beef feet don't cook like "beef"); then, for keys the
 * catalog copy here doesn't know, the key with its last words dropped (`prefix`).
 */
export function matchFor(key, index, catalog, lookups = lookupsFor(index)) {
  const { byId, byWords } = lookups;
  if (byId.has(key)) return { pos: byId.get(key), how: "id" };
  if (byWords.has(wordKey(key))) return { pos: byWords.get(wordKey(key)), how: "words" };
  const item = catalog?.items?.[key];
  if (item) {
    if (!item.deals?.staple) return null;
    for (let p = item.parent, n = 0; p && n < 10; p = catalog.items[p]?.parent, n++) {
      if (byId.has(p)) return { pos: byId.get(p), how: "parent" };
    }
    return null;
  }
  const parts = key.split("-");
  for (let n = parts.length - 1; n >= 1; n--) {
    const head = parts.slice(0, n).join("-");
    if (byId.has(head)) return { pos: byId.get(head), how: "prefix" };
    if (byWords.has(wordKey(head))) return { pos: byWords.get(wordKey(head)), how: "prefix" };
  }
  return null;
}

/**
 * Whether a recipe is vegetarian: none of its ingredients is meat or seafood, and its name
 * doesn't say so either (the index's ingredient lists miss some: "Wind-Cured Pork Belly").
 */
function vegCheck(index) {
  const meat = new Set(index.diet?.vegetarian ?? []);
  const names = [...meat].map((p) => index.ing[p]?.[1]).filter((n) => n && n.length >= 4).map(norm);
  const seen = new Map();
  return (r) => {
    if (!seen.has(r)) seen.set(r, !r[5].some((p) => meat.has(p)) && !names.some((n) => norm(r[1]).includes(n)));
    return seen.get(r);
  };
}

export const positionFor = (key, index, catalog, lookups) => matchFor(key, index, catalog, lookups)?.pos ?? -1;

/** Recipe rows the rest of this file can trust; a malformed row is skipped, not fatal. */
function goodRows(index) {
  const ok = (r) =>
    Array.isArray(r) && Number.isInteger(r[0]) && index.sources?.[r[0]]?.site && typeof r[1] === "string" && typeof r[2] === "string" &&
    Array.isArray(r[5]) && Array.isArray(r[6]);
  const rows = [];
  let skipped = 0;
  (index.recipes ?? []).forEach((r, i) => (ok(r) ? rows.push(i) : skipped++));
  if (skipped) console.warn(`recipes: skipped ${skipped} malformed recipe rows`);
  return rows;
}

/**
 * Fill pages of PAGE in score order, at most PER_CREATOR of a page from one creator. When the
 * creators run out partway through a page, the page is topped up in score order.
 */
function paged(scored, max, vegWanted) {
  const picks = [];
  const taken = new Set();
  const take = (h) => { taken.add(h.i); picks.push(h); };
  while (picks.length < max && taken.size < scored.length) {
    const end = Math.min(max, picks.length + PAGE);
    const perCreator = new Map();
    for (const h of scored) {
      if (picks.length >= end) break;
      if (taken.has(h.i) || (perCreator.get(h.r[0]) ?? 0) >= PER_CREATOR) continue;
      perCreator.set(h.r[0], (perCreator.get(h.r[0]) ?? 0) + 1);
      take(h);
    }
    for (const h of scored) {
      if (picks.length >= end) break;
      if (!taken.has(h.i)) take(h);
    }
  }
  // Enough vegetarian ones for people who only want those (tofu with pork is common).
  let veg = picks.filter((h) => h.veg).length;
  for (const h of scored) {
    if (veg >= vegWanted) break;
    if (h.veg && !taken.has(h.i)) { taken.add(h.i); picks.push(h); veg++; }
  }
  return picks;
}

function idea(index, h, extra = {}) {
  const r = h.r;
  const src = index.sources[r[0]];
  return { name: r[1], url: r[2].startsWith("http") ? r[2] : src.site + r[2], site: src.name, minutes: r[3] ?? null, image: r[7] || null, veg: h.veg, ...extra };
}

/**
 * The recipe ideas for each item key. `index` is the recipe search index (recipe rows are
 * [source, name, path, minutes, cuisine, ingredients with parents, own ingredients, photo,
 * keywords, opens]).
 */
export function recipesFor(index, catalog, keys, week = "") {
  const lookups = lookupsFor(index);
  const isVeg = vegCheck(index);
  const using = new Map();
  for (const i of goodRows(index)) for (const p of index.recipes[i][5]) (using.get(p) ?? using.set(p, []).get(p)).push(i);

  const byKey = {};
  for (const key of [...new Set(keys)].filter(Boolean).sort()) {
    const pos = positionFor(key, index, catalog, lookups);
    if (pos < 0) continue;
    const [id, name, , , ...aliases] = index.ing[pos];
    let names = [name, ...aliases].map(norm);
    let own = [pos];
    let found = using.get(pos) ?? [];
    if (found.length < THIN) {
      const parents = index.ing[pos][3] ?? [];
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
      // Ties are common (most recipes have no opens yet): shuffled by a number that holds for
      // the week, so the ideas change with the deals and not with every hourly build.
      return { i, r, score, mix: mix(`${week}|${key}|${r[2]}`), veg: isVeg(r) };
    }).sort((a, b) => b.score - a.score || a.mix - b.mix);
    if (!scored.length) continue;

    byKey[key] = {
      // The recipe search's own id for it, which the app sends when it asks about a list.
      id,
      ingredient: name,
      more: `${SEARCH_URL}?with=${encodeURIComponent(id)}`,
      total: scored.length,
      recipes: paged(scored, PER_KEY, VEG_WANTED.key).map((h) => idea(index, h)),
    };
  }
  return byKey;
}

/**
 * For each store, recipes that use two or more of its deals this week. A deal counts more when
 * it's a standout, and less when it's in nearly everything (eggs, soy sauce), so the row leans
 * on what's actually worth buying there. Deals matched only loosely (`prefix`) are left out:
 * "pork for stew" shouldn't make every pork recipe a match.
 */
export function storeRecipesFor(index, catalog, items, week = "", today = "") {
  const lookups = lookupsFor(index);
  const isVeg = vegCheck(index);
  const rows = goodRows(index);
  const count = new Map();
  for (const i of rows) for (const p of index.recipes[i][5]) count.set(p, (count.get(p) ?? 0) + 1);
  const pantry = (p) => (count.get(p) ?? 0) >= PANTRY_SHARE * rows.length;

  const stores = new Map();
  for (const d of items) {
    if (!d?.key || !d.store || (today && d.ends && d.ends < today)) continue;
    const m = matchFor(d.key, index, catalog, lookups);
    if (!m || m.how === "prefix" || pantry(m.pos)) continue;
    const w = (TIER_WEIGHT[d.tier] ?? 1) / (1 + Math.log10(1 + (count.get(m.pos) ?? 0) / 40));
    const s = stores.get(d.store) ?? stores.set(d.store, new Map()).get(d.store);
    s.set(m.pos, Math.max(s.get(m.pos) ?? 0, w));
  }

  const byStore = {};
  for (const [store, weights] of [...stores].sort(([a], [b]) => a.localeCompare(b))) {
    if (weights.size < 2) continue;
    const covered = (p) => weights.has(p) || (index.ing[p]?.[3] ?? []).some((q) => weights.has(q));
    const scored = [];
    for (const i of rows) {
      const r = index.recipes[i];
      const used = [...weights.keys()].filter((p) => r[5].includes(p));
      if (used.length < 2) continue;
      const missing = r[6].filter((p) => !covered(p)).length;
      let score = used.reduce((t, p) => t + weights.get(p), 0);
      score += 0.3 * Math.min(4, Math.log2(1 + (r[9] || 0)));
      if (r[7]) score += 0.5;
      score -= 0.15 * Math.max(0, missing - 8);
      scored.push({ i, r, score, used, mix: mix(`${week}|${store}|${r[2]}`), veg: isVeg(r) });
    }
    scored.sort((a, b) => b.score - a.score || a.mix - b.mix);
    const picks = paged(scored, PER_STORE, VEG_WANTED.store);
    if (picks.length < STORE_MIN) continue;
    byStore[store] = {
      total: scored.length,
      recipes: picks.map((h) => idea(index, h, { uses: h.used.sort((a, b) => weights.get(b) - weights.get(a)).map((p) => index.ing[p][1]) })),
    };
  }
  return byStore;
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
export async function writeRecipes(feed, distDir, { catalog, indexPath = process.env.RECIPES_INDEX, today } = {}) {
  today ??= new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const base = { week: feed.week, page: PAGE, about: ABOUT_URL, search: SEARCH_URL, with_url: WITH_URL };
  let out;
  try {
    const index = indexPath ? JSON.parse(readFileSync(indexPath, "utf8")) : await getJSON(INDEX_URL);
    if (!Array.isArray(index?.ing) || !Array.isArray(index?.recipes) || !Array.isArray(index?.sources)) throw new Error("the index isn't the shape this expects");
    out = {
      ...base,
      index_built: index.built ?? null,
      by_key: recipesFor(index, catalog, feed.items.map((i) => i.key), feed.week),
      by_store: storeRecipesFor(index, catalog, feed.items, feed.week, today),
    };
  } catch (err) {
    console.warn(`recipes: ${err.message}`);
    try {
      const live = await getJSON(LIVE_COPY, 10000);
      out = { ...base, index_built: live.index_built ?? null, by_key: live.by_key ?? {}, by_store: live.by_store ?? {}, note: "Kept from the last build." };
    } catch {
      out = { ...base, index_built: null, by_key: {}, by_store: {}, note: "The recipe index couldn't be read for this build." };
    }
  }
  mkdirSync(join(distDir, "api"), { recursive: true });
  writeFileSync(join(distDir, "api", "recipes.json"), JSON.stringify(out));
  console.log(`recipes.json: ideas for ${Object.keys(out.by_key).length} ingredients and ${Object.keys(out.by_store).length} stores${out.note ? ` (${out.note})` : ""}`);
  return out;
}

// Run on its own against the built feed.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const feed = JSON.parse(readFileSync(join(root, "dist", "api", "week.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(root, "vendor", "kitchen-catalog", "catalog.json"), "utf8"));
  await writeRecipes(feed, join(root, "dist"), { catalog });
}
