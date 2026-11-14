// find_places on a saved copy of the real /api/places.json (built 2026-11-14), plus a broken one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findPlaces } from "../src/deals.js";

const feed = JSON.parse(readFileSync(new URL("./places-sample.json", import.meta.url)));

test("a word search finds shops by what they're known for", () => {
  const goat = findPlaces(feed, { query: "goat" });
  assert.ok(goat.places.some((p) => p.name === "Carniceria El Paisano"));
  const halal = findPlaces(feed, { query: "halal", kind: "shop" });
  assert.ok(halal.places.length >= 2 && halal.places.every((p) => p.kind === "shop"));
});

test("markets open this week come with their days", () => {
  const open = findPlaces(feed, { open_this_week: true });
  assert.ok(open.places.length > 0);
  assert.ok(open.places.every((p) => p.kind === "market" && p.open_next_7_days.length));
  assert.ok(open.places.some((p) => p.name === "Ballard Farmers Market"));
});

test("filters for Fresh Bucks, delivery and shop type", () => {
  assert.ok(findPlaces(feed, { fresh_bucks: true }).places.every((p) => p.fresh_bucks));
  assert.ok(findPlaces(feed, { delivers: true }).places.every((p) => p.services?.delivery || p.services?.ships));
  assert.ok(findPlaces(feed, { shop_type: "seafood" }).places.every((p) => p.type === "Fish and shellfish"));
});

test("no match says so instead of returning nothing", () => {
  const r = findPlaces(feed, { query: "zzzqqq" });
  assert.equal(r.count, 0);
  assert.match(r.not_found, /hand-picked/);
});

test("a broken entry doesn't take down the rest", () => {
  const broken = { ...feed, places: [{ kind: "shop" }, null, ...feed.places.slice(0, 3)].filter(Boolean) };
  const r = findPlaces(broken, { query: "market" });
  assert.ok(Array.isArray(r.places));
});
