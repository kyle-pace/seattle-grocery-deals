// A catalog sync must not take away an item id, or leave half a copy (scripts/sync-catalog.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
import { lostItems } from "./sync-catalog.mjs";

const catalog = (ids, also = {}) => ({ items: Object.fromEntries(ids.map((id) => [id, { name: id, aliases: [], ...(also[id] ? { also: also[id] } : {}) }])) });

test("adding items loses nothing, and a first sync is fine", () => {
  assert.deepEqual(lostItems(catalog(["tofu"]), catalog(["tofu", "basil"])), []);
  assert.deepEqual(lostItems(null, catalog(["tofu"])), []);
});

test("an id may move into another item's also, but not disappear", () => {
  assert.deepEqual(lostItems(catalog(["scallion", "tofu"]), catalog(["green-onion", "tofu"], { "green-onion": ["scallion"] })), []);
  assert.deepEqual(lostItems(catalog(["scallion", "tofu"]), catalog(["green-onion", "tofu"])), ["scallion"]);
});

test("the copy here holds together: every parent is a real item", () => {
  const { items } = JSON.parse(readFileSync(join(ROOT, "vendor", "kitchen-catalog", "catalog.json"), "utf8"));
  for (const [id, item] of Object.entries(items)) if (item.parent) assert.ok(items[item.parent], `${id} has a missing parent ${item.parent}`);
});
