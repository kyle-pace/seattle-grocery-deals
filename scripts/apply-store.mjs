// Puts one or more stores' new flyers into the current week, for MODE: update in ROUTINE.md.
//
//   node scripts/apply-store.mjs --week                       # print the current week date
//   node scripts/apply-store.mjs drafts/2026-11-04.json "/tmp/updates/All Items 2026-11-04.md"
//
// The first form prints the week the update belongs to: the most recent Friday in Seattle,
// on or before today. Write the store note and draft for that date.
//
// The second form takes a draft made by `npm run draft` from a note that has only the
// updated stores, and:
//   1. Starts the week file if it doesn't exist yet, by carrying the previous week forward:
//      flyers that still run on the new Friday keep their items; flyers that ended before it
//      become "stale" with no items, until their store's next update.
//   2. Replaces those stores' flyer entries and items in data/weeks/<week>.json.
//   3. Replaces their flyer lines and rows in notes/all-items/All Items <week>.md.
//   4. Prints checks and writes them to drafts/<week>.flags.json. Any flag means a person
//      should look first: open a pull request instead of pushing to main.
//
// It never touches other stores.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, WEEKS_DIR, readJson, weekFiles, addDays } from "./lib.mjs";

// SGD_TODAY=YYYY-MM-DD overrides today, for testing.
const today = process.env.SGD_TODAY ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sunday .. 5 Friday
const currentWeek = addDays(today, -((dow + 2) % 7));

const args = process.argv.slice(2);
if (args[0] === "--week") {
  console.log(currentWeek);
  process.exit(0);
}
const [draftPath, notePath] = args;
if (!draftPath || !notePath) {
  console.error('Usage: node scripts/apply-store.mjs drafts/<week>.json "<store note>.md"');
  process.exit(1);
}

const cfgStores = readJson(join(ROOT, "config", "stores.json")).stores;
const storeNames = Object.fromEntries(cfgStores.map((s) => [s.id, s.name]));

const draft = readJson(draftPath);
const week = draft.week;
if (week !== currentWeek) console.warn(`Note: the draft is for ${week}, but the current week is ${currentWeek}. Using ${week}.`);
const storeIds = draft.flyers.map((f) => f.store);
if (!storeIds.length) fail("The draft has no flyers.");

const weekPath = join(WEEKS_DIR, `${week}.json`);
const allNotePath = join(ROOT, "notes", "all-items", `All Items ${week}.md`);

// ---------- 1. start the week if needed ----------

let started = false;
if (!existsSync(weekPath)) {
  const prevFile = weekFiles().filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${week}.json`).pop();
  if (!prevFile) fail("No earlier week to carry forward.");
  const prev = readJson(join(WEEKS_DIR, prevFile));
  const prevWeek = prev.week;
  const ended = new Set();
  const flyers = prev.flyers.map((f) => {
    if ((f.status === "full" || f.status === "partial") && f.valid_through && f.valid_through < week) {
      ended.add(f.store);
      return { store: f.store, status: "stale", valid_from: f.valid_from, valid_through: f.valid_through, links: f.links,
        note: `The flyer that ended ${f.valid_through} is the latest one read; waiting for the next one.` };
    }
    return f;
  });
  const items = prev.items.filter((i) => !ended.has(i.store));
  writeFileSync(weekPath, JSON.stringify({ week, flyers, items }, null, 2) + "\n");

  const prevNotePath = join(ROOT, "notes", "all-items", `All Items ${prevWeek}.md`);
  if (existsSync(prevNotePath)) {
    const n = parseNote(readFileSync(prevNotePath, "utf8"));
    n.title = `# All Items ${week}`;
    n.intro = `Carried forward from the week of ${prevWeek}; each store is replaced when its next flyer is read (MODE: update in ROUTINE.md).`;
    for (const id of ended) {
      const i = n.flyers.findIndex((l) => storeOfLine(l) === id);
      if (i >= 0) n.flyers[i] = n.flyers[i].replace(/\|\s*status:.*$/, "| status: stale, ended before this week; waiting for the next flyer");
      n.rows = n.rows.filter((r) => storeOfRow(r) !== id);
    }
    writeFileSync(allNotePath, renderNote(n));
  }
  started = true;
  console.log(`Started ${week} from ${prevWeek}${ended.size ? `; ended flyers marked stale: ${[...ended].join(", ")}` : ""}.`);
}

// ---------- 2. the week file ----------

const w = readJson(weekPath);
const before = Object.fromEntries(storeIds.map((id) => [id, {
  flyer: w.flyers.find((f) => f.store === id) ?? null,
  items: w.items.filter((i) => i.store === id),
}]));
for (const f of draft.flyers) {
  const i = w.flyers.findIndex((x) => x.store === f.store);
  if (i >= 0) w.flyers[i] = f; else w.flyers.push(f);
}
w.items = w.items.filter((i) => !storeIds.includes(i.store)).concat(draft.items);
writeFileSync(weekPath, JSON.stringify(w, null, 2) + "\n");

// ---------- 3. the All Items note ----------

const upd = parseNote(readFileSync(notePath, "utf8"));
const all = existsSync(allNotePath) ? parseNote(readFileSync(allNotePath, "utf8"))
  : { title: `# All Items ${week}`, intro: "Each store's latest flyer, read by MODE: update in ROUTINE.md.", flyers: [], header: upd.header, rows: [] };
for (const line of upd.flyers) {
  const id = storeOfLine(line);
  const i = all.flyers.findIndex((l) => storeOfLine(l) === id);
  if (i >= 0) all.flyers[i] = line; else all.flyers.push(line);
}
all.rows = all.rows.filter((r) => !storeIds.includes(storeOfRow(r))).concat(upd.rows);
writeFileSync(allNotePath, renderNote(all));

// ---------- 4. checks ----------

const flags = [];
const lines = [];
const prior = priorKeyPrices(week, storeIds);
for (const id of storeIds) {
  const f = draft.flyers.find((x) => x.store === id);
  const b = before[id];
  const n = draft.items.filter((i) => i.store === id).length;
  const was = b.items.length || lastCount(id, week);
  lines.push(`${id}: ${f.status}, ${f.valid_from ?? "?"} to ${f.valid_through ?? "?"}, ${n} items (was ${was})`);
  if (f.status !== "full" && f.status !== "partial") flags.push(`${id}: flyer is ${f.status}, so no items were added`);
  if (b.flyer?.valid_from && f.valid_from && f.valid_from < b.flyer.valid_from) flags.push(`${id}: the new flyer starts ${f.valid_from}, before the one it replaced (${b.flyer.valid_from})`);
  if (b.flyer?.valid_from && f.valid_from === b.flyer.valid_from && b.flyer.status === f.status) flags.push(`${id}: same start date as the flyer already live (${f.valid_from}); check it really is new`);
  if (f.valid_through && f.valid_through < today) flags.push(`${id}: the flyer already ended (${f.valid_through})`);
  if (was >= 10 && n < was * 0.6) flags.push(`${id}: ${n} items, down from ${was}; check nothing was missed`);
  for (const it of draft.items.filter((i) => i.store === id && i.item_key && i.unit_price)) {
    const p = prior[`${it.item_key}|${it.unit_price.per}`];
    if (!p) continue;
    const r = it.unit_price.value / p.value;
    if (r > 3 || r < 1 / 3) flags.push(`${id}: "${it.item}" is ${it.unit_price.value}/${it.unit_price.per}, ${r.toFixed(1)}x the last ${it.item_key} listing (${p.value} at ${p.store}); a unit or pack mistake?`);
  }
}
console.log(lines.join("\n"));
console.log(flags.length ? `\nFlags (open a pull request instead of pushing to main):\n- ${flags.join("\n- ")}` : "\nNo flags: fine to publish.");
mkdirSync(join(ROOT, "drafts"), { recursive: true });
writeFileSync(join(ROOT, "drafts", `${week}.flags.json`), JSON.stringify({ week, stores: storeIds, started, flags }, null, 2) + "\n");

// ---------- helpers ----------

function parseNote(text) {
  const lines = text.split("\n");
  const out = { title: lines.find((l) => l.startsWith("# ")) ?? "", intro: "", flyers: [], header: [], rows: [] };
  let section = "";
  for (const l of lines) {
    if (/^## Flyers/.test(l)) { section = "flyers"; continue; }
    if (/^## Items/.test(l)) { section = "items"; continue; }
    if (l.startsWith("# ")) continue;
    if (!section && l.trim()) out.intro = out.intro ? `${out.intro}\n${l}` : l;
    if (section === "flyers" && /^\s*[-*]\s+/.test(l)) out.flyers.push(l);
    if (section === "items" && l.startsWith("|")) {
      if (/^\|\s*Store\s*\|/.test(l) || /^\|\s*-+/.test(l)) out.header.push(l); else out.rows.push(l);
    }
  }
  if (out.header.length < 2) out.header = ["| Store | Item (as printed) | Sale price | Unit | Regular price (only if printed) | Valid through | Category | Notes |", "|---|---|---|---|---|---|---|---|"];
  return out;
}
function renderNote(n) {
  return `${n.title}\n\n${n.intro}\n\n## Flyers\n\n${n.flyers.join("\n")}\n\n## Items\n\n${n.header.slice(0, 2).join("\n")}\n${n.rows.join("\n")}\n`;
}
function idForName(name) {
  const lower = name.trim().toLowerCase();
  for (const [id, nm] of Object.entries(storeNames)) if (nm.toLowerCase() === lower) return id;
  for (const s of cfgStores) if ((s.aliases ?? []).some((a) => a.toLowerCase() === lower)) return s.id;
  return lower;
}
function storeOfLine(l) { return idForName(l.replace(/^\s*[-*]\s+/, "").split(":")[0]); }
function storeOfRow(r) { return idForName(r.split("|")[1] ?? ""); }
function lastCount(id, wk) {
  for (const f of weekFiles().filter((f) => f < `${wk}.json`).reverse()) {
    const n = readJson(join(WEEKS_DIR, f)).items.filter((i) => i.store === id).length;
    if (n) return n;
  }
  return 0;
}
function priorKeyPrices(wk, ids) {
  const out = {};
  for (const f of weekFiles().filter((f) => f <= `${wk}.json`)) {
    for (const i of readJson(join(WEEKS_DIR, f)).items) {
      if (f === `${wk}.json` && ids.includes(i.store)) continue;
      if (i.item_key && i.unit_price) out[`${i.item_key}|${i.unit_price.per}`] = { value: i.unit_price.value, store: i.store };
    }
  }
  return out;
}
function fail(msg) { console.error(msg); process.exit(1); }
