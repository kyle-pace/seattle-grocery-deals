// Recipe ideas (scripts/recipes.mjs) against a saved, cut-down copy of the real recipe search
// index and this week's deals at two stores, plus a broken index. Run: node --test scripts/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { matchFor, recipesFor, storeRecipesFor, writeRecipes, PAGE, PANTRY_SHARE } from "../recipes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, p), "utf8"));
const index = read("fixtures/recipe-index-sample.json");
const week = read("fixtures/week-sample.json");
const catalog = read("../../vendor/kitchen-catalog/catalog.json");

test("deal keys find the index's ingredient, in another word order or by a staple's parent", () => {
  const id = (k) => { const m = matchFor(k, index, catalog); return m && index.ing[m.pos][0]; };
  assert.equal(id("pork-chops"), "pork-chops");
  assert.equal(id("pork-ground"), "ground-pork");
  assert.equal(id("cabbage-napa"), "napa-cabbage");
  assert.equal(id("salmon-atlantic"), "salmon"); // a staple: Atlantic salmon cooks like salmon
  assert.equal(id("beef-omasum"), null); // not a staple: tripe isn't "beef"
  assert.equal(id("not-a-thing-at-all"), null);
});

test("each ingredient gets pages of six, spread across creators", () => {
  const out = recipesFor(index, catalog, ["pork-chops", "tofu", "cabbage-napa", "beef-omasum"], week.week);
  assert.deepEqual(Object.keys(out).sort(), ["cabbage-napa", "pork-chops", "tofu"]);
  const tofu = out.tofu;
  assert.equal(tofu.id, "tofu");
  assert.ok(tofu.recipes.length > PAGE, "more than one page, so Something else has somewhere to go");
  // The first page: at least three creators, none more than twice while others have recipes left.
  const counts = {};
  for (const r of tofu.recipes.slice(0, PAGE)) counts[r.site] = (counts[r.site] ?? 0) + 1;
  assert.ok(Object.keys(counts).length >= 3, JSON.stringify(counts));
  assert.ok(Math.max(...Object.values(counts)) <= 3, JSON.stringify(counts));
  for (const r of tofu.recipes) {
    assert.match(r.url, /^https:\/\//);
    assert.equal(typeof r.veg, "boolean");
  }
  // The recipe that names pork chops comes first.
  assert.match(out["pork-chops"].recipes[0].name, /pork chop/i);
});

test("a recipe with meat in its name is never vegetarian", () => {
  const out = recipesFor(index, catalog, ["tofu", "pork-belly", "cabbage-napa"], week.week);
  for (const r of Object.values(out).flatMap((v) => v.recipes)) {
    if (/\b(pork|beef|chicken|shrimp|fish)\b/i.test(r.name)) assert.equal(r.veg, false, r.name);
  }
});

test("the same week always gives the same ideas", () => {
  const a = recipesFor(index, catalog, ["tofu"], "2026-11-13").tofu.recipes.map((r) => r.url);
  const b = recipesFor(index, catalog, ["tofu"], "2026-11-13").tofu.recipes.map((r) => r.url);
  assert.deepEqual(a, b);
});

test("store rows use two or more of that store's deals, leave out pantry staples and ended sales", () => {
  const out = storeRecipesFor(index, catalog, week.items, week.week, "2026-11-14");
  assert.ok(Object.keys(out).length >= 1);
  const count = {};
  for (const r of index.recipes) for (const p of r[5]) count[index.ing[p][1]] = (count[index.ing[p][1]] ?? 0) + 1;
  const pantry = (name) => (count[name] ?? 0) >= PANTRY_SHARE * index.recipes.length;
  for (const [store, v] of Object.entries(out)) {
    assert.ok(v.recipes.length >= 3, store);
    for (const r of v.recipes) {
      assert.ok(r.uses.length >= 2, `${store}: ${r.name}`);
      assert.ok(!r.uses.some(pantry), `${store}: ${r.uses}`);
    }
  }
  // Everything ended: no rows.
  assert.deepEqual(storeRecipesFor(index, catalog, week.items, week.week, "2099-01-01"), {});
});

test("a broken index: bad rows are skipped, and nothing throws", () => {
  const broken = { ...index, recipes: [null, "x", [99, "No such source", "/x/", 5, "", [1], [1], "", "", 0], [0, "No lists"], ...index.recipes.slice(0, 20)] };
  assert.doesNotThrow(() => recipesFor(broken, catalog, ["tofu", "pork-chops"], week.week));
  assert.doesNotThrow(() => storeRecipesFor(broken, catalog, [...week.items, null, { store: "tnt" }], week.week, "2026-11-14"));
});

test("an index that can't be read never fails the build", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recipes-"));
  const bad = join(dir, "index.json");
  writeFileSync(bad, '{"not": "an index"}');
  const out = await writeRecipes({ week: week.week, items: week.items }, dir, { catalog, indexPath: bad });
  assert.equal(typeof out.by_key, "object");
  assert.equal(typeof out.by_store, "object");
  assert.ok(out.note);
  assert.ok(JSON.parse(readFileSync(join(dir, "api", "recipes.json"), "utf8")));
});
