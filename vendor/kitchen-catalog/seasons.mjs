// What's in season (Sources/KitchenCatalog/Resources/seasons.json), for the Grocery Deals site.
// Same rules as Seasons.swift; both run Tests/season-cases.json.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalize, match } from "./catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const SEASONS_PATH = join(here, "..", "Sources", "KitchenCatalog", "Resources", "seasons.json");

export function loadSeasons(path = SEASONS_PATH) {
  return JSON.parse(readFileSync(path, "utf8")).seasons;
}

/** "2026-10-30" or "10-30": is that day inside the season? Both ends count; can wrap the new year. */
export function inSeason(season, day) {
  const md = String(day).length > 5 ? String(day).slice(5, 10) : String(day);
  const { from, to } = season;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** The seasons that include a day, in the file's order. */
export function seasonsOn(seasons, day) {
  return seasons.filter((s) => inSeason(s, day));
}

/** The last day of the season that includes `day` (or the next one to end), as yyyy-mm-dd. */
export function seasonEnd(season, day) {
  const iso = String(day).slice(0, 10);
  const year = Number(iso.slice(0, 4));
  const md = iso.slice(5);
  // Past this year's last day, the next end is next year's (autumn days of a season that wraps).
  return `${md > season.to ? year + 1 : year}-${season.to}`;
}

/** Does a catalog id belong to the season, directly or as a kind of one of its items? */
export function coversItem(season, catalog, id) {
  for (let p = id, n = 0; p && n < 10; p = catalog?.items?.[p]?.parent, n++) if (season.items.includes(p)) return true;
  return false;
}

/** Does a name ("Fuyu Persimmons, jumbo") mention the season's item? Whole words, made singular. */
export function mentions(season, text) {
  const words = new Set(normalize(text).split(" "));
  const own = [...season.words, season.label].map((w) => normalize(w));
  return own.some((w) => (w.includes(" ") ? ` ${normalize(text)} `.includes(` ${w} `) : words.has(w)));
}

/** Is a name the season's star kind ("Fuyu")? False when the season has no star. */
export function isStar(season, text) {
  if (!season.star) return false;
  const words = new Set(normalize(text).split(" "));
  return season.star.words.some((w) => words.has(normalize(w)));
}

/**
 * Does a deal or pantry line belong to the season? Its catalog id decides when it has one (a known
 * `key`, or else what the name matches in the catalog, strong or weak): "Pastry Mitten Pie Slices,
 * fuji apple" is pastries, not apples. Only a name the catalog doesn't know ("Hoshigaki") falls
 * back to the season's words. `catalog` is the loaded catalog (load() in catalog.mjs).
 */
export function matches(season, catalog, { key, name }) {
  const id = key != null && catalog?.items?.[key] ? key : catalog?.terms ? match(catalog, name ?? "")?.id : null;
  if (id) return coversItem(season, catalog, id);
  return mentions(season, name ?? "");
}
