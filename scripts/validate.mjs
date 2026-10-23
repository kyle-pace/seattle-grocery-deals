// Validates every data/weeks/*.json file (or the paths given) against the
// schema and the cross checks below, and scans repo text for em dashes.
// Usage: node scripts/validate.mjs [path/to/week.json ...]
// Exits 1 on any error. Warnings do not fail.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative, resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  ROOT, WEEKS_DIR, readJson, loadConfig, weekFiles, isFriday, addDays,
  computeUnitPrice, round2, percentOff, judge, priorListings, lowestPrior,
} from "./lib.mjs";

const cfg = loadConfig();
// Earlier weeks, for site-history checks. Unparseable files are reported by checkWeek.
const repoWeeks = weekFiles().flatMap((f) => {
  try {
    const w = readJson(join(WEEKS_DIR, f));
    return w && typeof w.week === "string" && Array.isArray(w.deals) ? [w] : [];
  } catch {
    return [];
  }
});
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
    if (s.flyer_url === null && !s.flyer_url_note) err(w, "flyer_url is null, so flyer_url_note must explain why");
  }
  for (const [key, item] of Object.entries(cfg.items)) {
    const w = `config/items.json ${key}`;
    if (!cfg.criteria.categories.includes(item.category)) err(w, `unknown category ${item.category}`);
    if (item.benchmark && !cfg.benchmarks[item.benchmark]) err(w, `unknown benchmark ${item.benchmark}`);
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
  }
  for (const s of cfg.stores) {
    if (s.active && s.tracked_since <= week.week && !flyerByStore[s.id]) warn(name, `active store ${s.id} has no flyer entry (shown as not checked)`);
  }

  // Deals
  const seenDeal = new Set();
  for (const [i, d] of week.deals.entries()) {
    const w = `${name} deals[${i}] ${d.store} "${d.item}"`;
    const store = cfg.storeById[d.store];
    const item = cfg.items[d.item_key];
    if (!store) { err(w, "store not in config/stores.json"); continue; }
    if (!item) { err(w, `item_key ${d.item_key} not in config/items.json`); continue; }
    if (item.category !== d.category) err(w, `category ${d.category} does not match items.json (${item.category})`);

    const flyer = flyerByStore[d.store];
    if (!flyer) err(w, "no flyer entry for this store");
    else if (!["full", "partial"].includes(flyer.status)) err(w, `flyer status is ${flyer.status}; deals need a full or partial read`);
    else if (flyer.valid_through && d.valid_through > flyer.valid_through) err(w, "valid_through is after the flyer's valid_through");

    if (d.valid_through < addDays(week.week, -7) || d.valid_through > addDays(week.week, 21)) err(w, "valid_through is not near this week");

    const dupKey = `${d.store}|${d.item}|${d.price}|${d.unit}`;
    if (seenDeal.has(dupKey)) err(w, "duplicate deal");
    seenDeal.add(dupKey);

    // Unit price
    const expected = computeUnitPrice(d);
    if (expected && !d.unit_price) err(w, `unit_price can be computed: ${round2(expected.value)}/${expected.per}`);
    if (d.unit_price && expected) {
      if (d.unit_price.per !== expected.per) err(w, `unit_price.per should be ${expected.per}`);
      else if (Math.abs(d.unit_price.value - round2(expected.value)) > 0.011) err(w, `unit_price should be ${round2(expected.value)}`);
    }

    // Regular price and percent off
    if (d.regular_price != null) {
      if (d.regular_price <= d.price) err(w, "regular_price must be higher than price");
      const pct = percentOff(d.price, d.regular_price);
      if (d.percent_off == null) err(w, `percent_off should be ${pct}`);
      else if (Math.abs(d.percent_off - pct) > 1) err(w, `percent_off should be ${pct}`);
    }
    if (d.regular_price != null || d.percent_off != null) {
      if (!store.prints_regular_prices) err(w, `${store.id} does not print regular prices (config), so regular_price and percent_off must be null`);
    }

    // Reference
    if (d.reference === "printed" && d.percent_off == null) err(w, "printed reference needs regular_price or percent_off");
    if (d.reference === "us-average") {
      if (!d.us_average) err(w, "us-average reference needs us_average");
      else {
        const b = cfg.benchmarks[d.us_average.benchmark];
        if (!b) err(w, `unknown benchmark ${d.us_average.benchmark}`);
        else if (item.benchmark !== d.us_average.benchmark) err(w, `benchmark for ${d.item_key} is ${item.benchmark ?? "none"} in items.json`);
        else if (b.per !== d.us_average.per) err(w, "us_average.per does not match benchmarks.json");
      }
    } else if (d.us_average) err(w, "us_average must be null unless reference is us-average");

    const prior = priorListings(repoWeeks, week.week);
    if (d.reference === "site-history") {
      const low = lowestPrior(d, prior);
      if (!d.site_history) err(w, "site-history reference needs site_history");
      else if (low && (Math.abs(d.site_history.price - low.price) > 0.011 || d.site_history.week !== low.week || d.site_history.store !== low.store || d.site_history.per !== low.per)) {
        err(w, `site_history should be ${JSON.stringify({ price: low.price, per: low.per, week: low.week, store: low.store })}`);
      }
    } else if (d.site_history) err(w, "site_history must be null unless reference is site-history");

    const j = judge(d, cfg, prior);
    if (!j.ok) err(w, `does not meet the criteria (${j.why})`);

    if (d.reason.length > cfg.criteria.reason_max_length) err(w, "reason is too long");
    if (d.member_price && !/member|card|app|loyalty|prime/i.test(d.notes + d.reason)) warn(w, "member_price is true; say which program in notes");
  }
}

// ---------- repo text scan ----------

function scanText(dir) {
  for (const entry of readdirSync(dir)) {
    if ([".git", "node_modules", "dist", "drafts"].includes(entry)) continue;
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
