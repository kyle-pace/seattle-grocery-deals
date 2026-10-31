// Validates every data/weeks/*.json file (or the paths given) against the
// schema and the cross checks below, and scans repo text for em dashes.
// Usage: node scripts/validate.mjs [path/to/week.json ...]
// Exits 1 on any error. Warnings do not fail.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, relative, resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  ROOT, WEEKS_DIR, readJson, loadConfig, weekFiles, isFriday, addDays,
  computeUnitPrice, round2, percentOff, leaveOutReason, flyerKind, collapseVariants,
} from "./lib.mjs";
import { FRUIT_SVG } from "./buddy.mjs";

const cfg = loadConfig();
const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const EM_DASH = String.fromCharCode(0x2014);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ---------- config checks ----------

function checkConfig() {
  const seen = new Set();
  for (const s of cfg.stores) {
    const w = `config/stores.json ${s.id}`;
    if (seen.has(s.id)) err(w, "duplicate store id");
    seen.add(s.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) err(w, "id must be lowercase words joined by hyphens");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.tracked_since ?? "")) err(w, "tracked_since must be a YYYY-MM-DD date");
    for (const k of ["name", "sale_period", "prints_regular_prices", "flyer_format", "representative_location", "how_to_read", "active"]) {
      if (s[k] === undefined) err(w, `missing ${k}`);
    }
    if (!["web-page", "images", "pdf", "catalogue-viewer"].includes(s.flyer_format)) err(w, `unknown flyer_format ${s.flyer_format}`);
    if (s.web_only_flyer !== undefined && typeof s.web_only_flyer !== "boolean") err(w, "web_only_flyer must be true or false");
    if (s.flyer_url === null && !s.flyer_url_note) err(w, "flyer_url is null, so flyer_url_note must explain why");
    if (typeof s.about !== "string" || s.about.length < 20 || s.about.length > 300) err(w, "about must be 20 to 300 characters");
    if (!Array.isArray(s.locations)) err(w, "locations must be a list (empty for delivery-only)");
    if (s.delivery !== undefined && (typeof s.delivery !== "string" || s.delivery.length < 10 || s.delivery.length > 200)) err(w, "delivery must be 10 to 200 characters saying how the store delivers");
    for (const [i, l] of (s.locations || []).entries()) {
      const lw = `${w} locations[${i}]`;
      if (!l.label || !l.address) err(lw, "needs label and address");
      if (!(l.lat > 46.5 && l.lat < 48.5 && l.lon > -123.5 && l.lon < -121.5)) err(lw, "lat/lon is not in the Seattle area");
      if (typeof l.flyer !== "boolean") err(lw, "flyer must be true or false (does the tracked flyer apply here?)");
    }
  }
  for (const [key, item] of Object.entries(cfg.items)) {
    const w = `config/items.json ${key}`;
    if (!cfg.criteria.categories.includes(item.category)) err(w, `unknown category ${item.category}`);
    if (item.benchmark && !cfg.benchmarks[item.benchmark]) err(w, `unknown benchmark ${item.benchmark}`);
  }
  checkSeasons();
}

// Seasonal items: KitchenCatalog's calendar (vendor copy) and this site's config/seasons.json.
function checkSeasons() {
  const calendar = readJson(join(ROOT, "vendor", "kitchen-catalog", "seasons.json")).seasons;
  const site = readJson(join(ROOT, "config", "seasons.json")).seasons;
  const ids = new Set();
  const md = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  for (const s of calendar) {
    const w = `vendor/kitchen-catalog/seasons.json ${s.id}`;
    if (ids.has(s.id)) err(w, "season id used twice");
    ids.add(s.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) err(w, "id must be lowercase words joined by hyphens (it's the page address)");
    if (!md.test(s.from) || !md.test(s.to)) err(w, "from and to must be MM-DD");
    for (const item of s.items ?? []) if (!cfg.catalog.items[item]) err(w, `item ${item} isn't in the catalog`);
    if (s.buddy && !FRUIT_SVG[s.buddy]) warn(w, `the site has no "${s.buddy}" character yet (scripts/buddy.mjs), so the page shows a leaf`);
  }
  const placeholders = new Set(["label", "item", "star", "price", "store", "stores_have", "each_oz"]);
  const hex = /^#[0-9a-f]{6}$/i;
  for (const [id, look] of Object.entries(site)) {
    const w = `config/seasons.json ${id}`;
    if (!ids.has(id)) err(w, "no season with this id in KitchenCatalog's seasons.json (run npm run sync-catalog?)");
    if (look.each_oz != null && !(look.each_oz > 0)) err(w, "each_oz must be a weight in ounces");
    for (const mode of ["light", "dark"]) {
      const c = look.colors?.[mode];
      if (!look.colors) break;
      if (!c) { err(w, `colors needs ${mode}`); continue; }
      for (const k of ["main", "text", "soft", "ink"]) if (!hex.test(c[k] ?? "")) err(w, `colors.${mode}.${k} must be a #rrggbb color`);
      if (!Array.isArray(c.bg) || c.bg.length !== 2 || !c.bg.every((x) => hex.test(x))) err(w, `colors.${mode}.bg must be two #rrggbb colors`);
    }
    if (look.og_image && !existsSync(join(ROOT, "site", look.og_image))) err(w, `og_image ${look.og_image} isn't in site/`);
    for (const [k, text] of Object.entries(look.copy ?? {})) {
      for (const [, name] of String(text).matchAll(/\{(\w+)\}/g)) if (!placeholders.has(name)) err(w, `copy.${k} uses an unknown {${name}}`);
    }
  }
}

// ---------- week checks ----------

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, multipleOfPrecision: 6 });
addFormats(ajv);
const validateSchema = ajv.compile(readJson(join(ROOT, "schema", "week.schema.json")));

function walkStrings(value, path, fn) {
  if (typeof value === "string") fn(value, path);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, fn));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walkStrings(v, `${path}.${k}`, fn);
}

function checkWeek(path) {
  const name = basename(path);
  let week;
  try {
    week = readJson(path);
  } catch (e) {
    return err(name, `not valid JSON: ${e.message}`);
  }
  if (!validateSchema(week)) {
    for (const e of validateSchema.errors) err(name, `schema ${e.instancePath || "/"} ${e.message}`);
    return;
  }

  if (name !== `${week.week}.json`) err(name, `file name must be ${week.week}.json`);
  if (!isFriday(week.week)) err(name, `week ${week.week} is not a Friday`);

  walkStrings(week, "", (s, p) => {
    if (s.includes(EM_DASH)) err(name, `em dash in ${p}`);
    if (EMAIL.test(s)) err(name, `looks like an email address in ${p}`);
    if (/unverified/i.test(s)) err(name, `"unverified" in ${p}: unverified prices are left out`);
  });

  // Flyers
  const flyerByStore = {};
  for (const [i, f] of week.flyers.entries()) {
    const w = `${name} flyers[${i}] ${f.store}`;
    if (!cfg.storeById[f.store]) err(w, "store not in config/stores.json");
    if (flyerByStore[f.store]) err(w, "store listed twice");
    flyerByStore[f.store] = f;
    if (f.valid_from && f.valid_through && f.valid_from > f.valid_through) err(w, "valid_from is after valid_through");
    if (f.status === "partial" && !f.note) err(w, "partial flyers need a note saying what was not read");
    if ((f.status === "full" || f.status === "partial") && (!f.valid_from || !f.valid_through)) warn(w, "read flyer has no printed dates");
    if (f.status === "full" && f.valid_through && f.valid_through < week.week) err(w, "valid_through is before the week date; should this be stale?");
    // The app shows page images and PDFs in its own flyer viewer (from 2026-10-28); a flyer with
    // only web pages opens in Safari instead. Stores whose specials are only a web page say so.
    if ((f.status === "full" || f.status === "partial") && week.week >= "2026-10-30" && !cfg.storeById[f.store]?.web_only_flyer
        && !f.links.some((l) => flyerKind(l.url) !== "web")) {
      warn(w, "no page image or PDF linked, so the app can only open the store's site; link each page image (UPDATING.md section 7)");
    }
  }
  for (const s of cfg.stores) {
    if (s.active && !s.no_online_flyer && s.tracked_since <= week.week && !flyerByStore[s.id]) warn(name, `active store ${s.id} has no flyer entry (shown as not checked)`);
  }

  // Items
  const seen = new Set();
  for (const [i, d] of week.items.entries()) {
    const w = `${name} items[${i}] ${d.store} "${d.item}"`;
    const store = cfg.storeById[d.store];
    if (!store) { err(w, "store not in config/stores.json"); continue; }
    if (d.item_key != null && !cfg.items[d.item_key]) err(w, `item_key ${d.item_key} not in config/items.json (add it, or use null)`);

    const flyer = flyerByStore[d.store];
    if (!flyer) err(w, "no flyer entry for this store");
    else if (!["full", "partial"].includes(flyer.status)) err(w, `flyer status is ${flyer.status}; items need a full or partial read`);
    else if (flyer.valid_through && d.valid_through && d.valid_through > flyer.valid_through) err(w, "valid_through is after the flyer's valid_through");

    if (d.valid_through && (d.valid_through < addDays(week.week, -7) || d.valid_through > addDays(week.week, 21))) err(w, "valid_through is not near this week");

    const dupKey = `${d.store}|${d.item}|${d.price}|${d.quantity}|${d.unit}`;
    if (seen.has(dupKey)) err(w, "duplicate item");
    seen.add(dupKey);

    // Unit price
    const expected = computeUnitPrice(d);
    if (expected && !d.unit_price) err(w, `unit_price can be computed: ${round2(expected.value)}/${expected.per}`);
    if (d.unit_price && expected) {
      if (d.unit_price.per !== expected.per) err(w, `unit_price.per should be ${expected.per}`);
      else if (Math.abs(d.unit_price.value - round2(expected.value)) > 0.011) err(w, `unit_price should be ${round2(expected.value)}`);
    }

    // Regular price and percent off: only what the store printed.
    if (d.regular_price != null) {
      if (d.regular_price <= d.price) err(w, "regular_price must be higher than price");
      const pct = percentOff(d.price, d.regular_price);
      if (d.percent_off == null) err(w, `percent_off should be ${pct}`);
      else if (Math.abs(d.percent_off - pct) > 1) err(w, `percent_off should be ${pct}`);
    }
    if ((d.regular_price != null || d.percent_off != null) && !store.prints_regular_prices) {
      err(w, `${store.id} does not print regular prices (config), so regular_price and percent_off must be null`);
    }

    if (/\bCHECK:/.test(d.notes ?? "")) err(w, "notes still has a CHECK: note; confirm it on the flyer and remove it");
    if (d.vegetarian === true && (d.category === "meat" || d.category === "seafood")) err(w, "vegetarian is true on a meat or seafood item");
    else if (d.vegetarian === true && namesMeat(d)) warn(w, "vegetarian is true but the name mentions meat or fish; check it");
    if (d.member_price && !/member|card|app|loyalty|prime/i.test(d.notes)) warn(w, "member_price is true; say which program in notes");
    const leave = week.week >= cfg.leaveOut.since && leaveOutReason(cfg, d.item, d.category);
    if (leave) warn(w, `looks like a snack or packaged food (${leave}); these are left out (config/leave-out.json). Remove it, or add a keep word if it belongs`);
  }

  // Flavors sold at one price belong on one row (UPDATING.md section 3). Weeks from Oct 30.
  if (week.week >= "2026-10-30") {
    for (const m of collapseVariants(week.items, cfg.storeById).merged) {
      warn(`${name} ${m.store}`, `${m.from.length} rows look like flavors of one deal; make them one row, e.g. "${m.item}" (npm run draft does this)`);
    }
  }

  // A week with nothing read would replace the live week with an empty one.
  const readable = week.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
  if (!readable) err(name, "no flyer was read (full or partial); publishing this would empty the live site");
  if (!week.items.length) err(name, "no items; publishing this would empty the live site");
  const prev = weekFiles().filter((f) => f < `${week.week}.json`).pop();
  if (prev && week.items.length) {
    const n = readJson(join(WEEKS_DIR, prev)).items.length;
    if (week.items.length < n / 2) warn(name, `${week.items.length} items, under half of the ${n} in ${prev}; check that no store was missed`);
  }
}

// ---------- repo text scan ----------

function scanText(dir) {
  for (const entry of readdirSync(dir)) {
    if ([".git", "node_modules", "dist", "drafts", "fonts", "leaflet"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) scanText(p);
    else if (/\.(md|json|mjs|js|css|html|yml|txt)$/.test(entry)) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes(EM_DASH)) err(`${relative(ROOT, p)}:${i + 1}`, "em dash");
      });
    }
  }
}

// ---------- run ----------

checkConfig();
const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => resolve(p))
  : weekFiles().map((f) => join(WEEKS_DIR, f));
for (const t of targets) checkWeek(t);
scanText(ROOT);

for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`ERROR    ${e}`);
console.log(`\nChecked ${targets.length} week file(s): ${errors.length} error(s), ${warnings.length} warning(s).`);
process.exit(errors.length ? 1 : 0);
