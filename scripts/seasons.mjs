// Seasonal items: what's in season comes from KitchenCatalog (vendor/kitchen-catalog/seasons.json),
// how the site and app present it from config/seasons.json. Persimmons are first; adding the next
// item is an entry in each file (see config/seasons.json's "about").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inSeason, isStar, matches, seasonEnd } from "../vendor/kitchen-catalog/seasons.mjs";

const OZ_PER_LB = 16;
// The site's own green, for items without colors of their own.
const PLAIN = {
  light: { main: "#1d4d33", text: "#1d4d33", soft: "#e3efe7", ink: "#141414", bg: ["#f7f5f0", "#eef2ec"] },
  dark: { main: "#5fae86", text: "#8fd1ae", soft: "#1d2a22", ink: "#eef1ee", bg: ["#141614", "#18201b"] },
};

/** Fills {name} placeholders. Unknown names stay as they are, so a typo shows up on the page. */
export function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** Every season in the calendar, with the site's presentation and defaults filled in. */
export function loadSeasons(root) {
  const calendar = JSON.parse(readFileSync(join(root, "vendor", "kitchen-catalog", "seasons.json"), "utf8")).seasons;
  const site = JSON.parse(readFileSync(join(root, "config", "seasons.json"), "utf8")).seasons;
  return calendar.map((s) => {
    const look = site[s.id] ?? {};
    const item = s.label.toLowerCase();
    // "Fuyu", or "apples" when there's no star kind ("The best apples deal").
    const star = s.star?.label ?? item;
    const copy = {
      name: `${s.label} season`,
      eyebrow: `It's ${item} season`,
      eyebrow_after: `It's ${item} season (or it was)`,
      kicker: `The best ${star} deal in this week's flyers`,
      none_title: `No ${star} on sale this week.`,
      none_line: "Check back Friday.",
      also_title: "Also on sale",
      others_title: `Other ${item}`,
      others_note: "",
      log_title: "The price log",
      log_note: `The best ${star} deal in the flyers each week.`,
      facts_title: `${s.label} facts`,
      foot: `Click anywhere for more ${item}.`,
      per_10_note: "Roughly, at {each_oz} oz each.",
      story: `${s.label} are in season, and {stores_have} them on sale. The cheapest is {store} at {price}.`,
      share_title: `${s.label} season: ${star} at {price} at {store}`,
      share_title_none: `${s.label} season`,
      share_text: `The best ${star} deal in this week's flyers: {price} at {store}.`,
      share_text_none: `No ${star} on sale this week. Check back Friday.`,
      ...look.copy,
    };
    return {
      ...s,
      slug: look.slug ?? s.id,
      item,
      starLabel: star,
      compare_per: look.compare_per ?? "lb",
      each_oz: look.each_oz ?? null,
      colors: look.colors ?? PLAIN,
      og_image: look.og_image ?? null,
      og_alt: look.og_alt ?? null,
      copy,
    };
  });
}

/** Is the season on for a week (its yyyy-mm-dd)? */
export const seasonOn = (season, week) => inSeason(season, week);

/** A deal's price in the season's comparison unit, or Infinity when it can't be compared. */
export function comparable(season, deal) {
  const up = deal.unit_price;
  if (!up) return Infinity;
  if (up.per === season.compare_per) return up.value;
  // Per-each prices become per pound with the item's usual weight.
  if (up.per === "each" && season.compare_per === "lb" && season.each_oz) return up.value / (season.each_oz / OZ_PER_LB);
  if (up.per === "lb" && season.compare_per === "each" && season.each_oz) return up.value * (season.each_oz / OZ_PER_LB);
  return Infinity;
}

/**
 * The season's deals in one week: `star` (the kind to look for, cheapest first; all of them when
 * there's no star kind), `others` (other kinds), `best`, and `perTen` (about how many for $10).
 */
export function seasonDeals(season, cfg, items) {
  const any = items.filter((i) => matches(season, cfg.catalog, { key: cfg.catalogIdByKey[i.item_key] ?? i.item_key, name: i.item }));
  const all = any.filter((i) => i.unit_price);
  const by = (a, b) => comparable(season, a) - comparable(season, b);
  const star = (season.star ? all.filter((i) => isStar(season, i.item)) : all).sort(by);
  const others = (season.star ? all.filter((i) => !isStar(season, i.item)) : []).sort(by);
  const best = star[0] ?? null;
  const lbPrice = best ? comparable({ ...season, compare_per: "lb" }, best) : Infinity;
  const perTen = best && season.each_oz && isFinite(lbPrice) ? Math.floor(10 / (lbPrice * (season.each_oz / OZ_PER_LB))) : null;
  // Stores with any of it on sale, priced per unit or not.
  const stores = new Set(any.map((i) => i.store)).size;
  return { all, star, others, best, perTen, stores };
}

/** The best star deal in each week, oldest first, for the price log. */
export function seasonLog(season, cfg, weeks) {
  return weeks.map((w) => {
    const best = seasonDeals(season, cfg, w.items).star[0];
    return best ? { week: w.week, deal: best, value: comparable(season, best), about: best.unit_price.per !== season.compare_per } : null;
  }).filter(Boolean);
}

export { seasonEnd };
