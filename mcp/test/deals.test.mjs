// Checks for the tool logic, on a small made-up feed in the shape of /api/week.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findStore, listStores, searchDeals, thisWeek, words } from "../src/deals.js";

const item = (id, rank, name, store, category, extra = {}) => ({
  id, rank, name, store, category, key: null, text: "$1.99/lb", tier: "sale", veg: true, ends: "2026-11-12", why: "", ...extra,
});

const feed = {
  week: "2026-11-06",
  updated: "2026-11-11",
  categories: [
    { id: "produce", label: "Produce" },
    { id: "meat", label: "Meat" },
    { id: "dairy-eggs", label: "Dairy and eggs" },
  ],
  stores: [
    { id: "hmart", name: "H Mart", about: "Korean grocery.", locations: [{ label: "Lynnwood", address: "1 Main St" }], through: "2026-11-12" },
    { id: "99-ranch", name: "99 Ranch Market", about: "Asian grocery.", locations: [], through: "2026-11-12" },
  ],
  items: [
    item("hmart-0", 0, "Chicken Thighs, bone-in", "hmart", "meat", { tier: "standout", veg: false, key: "chicken-thighs" }),
    item("99-ranch-1", 1, "Whole Chicken", "99-ranch", "meat", { tier: "good", veg: false }),
    item("hmart-2", 2, "Chicken Drumsticks", "hmart", "meat", { veg: false }),
    item("99-ranch-3", 3, "Roma Tomatoes", "99-ranch", "produce", { tier: "good" }),
    item("hmart-4", 4, "Firm Tofu", "hmart", "dairy-eggs", { ends: "2026-11-09" }),
    item("99-ranch-5", 5, "House Foods Tofu, firm / soft", "99-ranch", "dairy-eggs"),
  ],
  seasons: [{ name: "Persimmon season", best: "99-ranch-3", stores: 2, url: "https://seattlegrocery.deals/persimmons/" }],
  store_ranks: {
    hmart: { score: 10, standouts: 1, good: 0, deals: 3, reason: "A good week for meat.", top: ["hmart-0"], veg: { score: 1, standouts: 0, good: 0, deals: 1, reason: "A quiet week.", top: [] } },
    "99-ranch": { score: 5, standouts: 0, good: 2, deals: 3, reason: "A quiet week, best for produce.", top: ["99-ranch-1"], veg: { score: 4, standouts: 0, good: 1, deals: 2, reason: "A quiet week, best for produce.", top: ["99-ranch-3"] } },
  },
};
const TODAY = "2026-11-10";

test("words trims plurals and punctuation", () => {
  assert.deepEqual(words("Roma Tomatoes"), ["roma", "tomato"]);
  assert.deepEqual(words("Chicken Thighs, bone-in"), ["chicken", "thigh", "bone", "in"]);
  assert.deepEqual(words("Jalapeño berries"), ["jalapeno", "berry"]);
});

test("stores are found by id, name or a loose spelling", () => {
  assert.equal(findStore(feed, "hmart").id, "hmart");
  assert.equal(findStore(feed, "H-Mart").id, "hmart");
  assert.equal(findStore(feed, "ranch 99").id, "99-ranch");
  assert.equal(findStore(feed, "safeway"), null);
});

test("a search matches every word, singular or plural", () => {
  const r = searchDeals(feed, { query: "tomato" }, TODAY);
  assert.deepEqual(r.deals.map((d) => d.name), ["Roma Tomatoes"]);
  assert.equal(searchDeals(feed, { query: "chicken thigh" }, TODAY).total_matching, 1);
});

test("several ingredients take turns, and misses are named", () => {
  const r = searchDeals(feed, { query: "chicken, tofu, saffron", limit: 2 }, TODAY);
  assert.deepEqual(r.deals.map((d) => d.name), ["Chicken Thighs, bone-in", "House Foods Tofu, firm / soft"]);
  assert.equal(r.total_matching, 4);
  assert.match(r.notes.join(" "), /saffron/);
});

test("ended deals are left out unless asked for", () => {
  assert.equal(searchDeals(feed, { query: "tofu" }, TODAY).total_matching, 1);
  assert.equal(searchDeals(feed, { query: "tofu", include_ended: true }, TODAY).total_matching, 2);
});

test("filters: store, aisle, rating, vegetarian", () => {
  assert.equal(searchDeals(feed, { store: "H Mart" }, TODAY).total_matching, 2);
  assert.equal(searchDeals(feed, { aisle: "Meat", rating: "good" }, TODAY).total_matching, 2);
  assert.equal(searchDeals(feed, { rating: "standout" }, TODAY).total_matching, 1);
  assert.ok(searchDeals(feed, { vegetarian: true }, TODAY).deals.every((d) => d.vegetarian));
});

test("an unknown store answers with the stores that exist", () => {
  const r = searchDeals(feed, { store: "safeway" }, TODAY);
  assert.match(r.error, /safeway/);
  assert.equal(r.stores.length, 2);
});

test("this_week ranks stores and skips ended top deals", () => {
  const r = thisWeek(feed, {}, TODAY);
  assert.deepEqual(r.where_to_shop.map((s) => s.id), ["hmart", "99-ranch"]);
  assert.equal(r.deal_count, 5);
  assert.equal(r.in_season[0].best_price, "Roma Tomatoes, $1.99/lb at 99 Ranch Market");
  assert.deepEqual(thisWeek(feed, { vegetarian: true }, TODAY).where_to_shop.map((s) => s.id), ["99-ranch", "hmart"]);
});

test("list_stores gives each store's page and addresses", () => {
  const r = listStores(feed);
  assert.equal(r.stores[0].page, "https://seattlegrocery.deals/stores/hmart/");
  assert.deepEqual(r.stores[0].locations, ["Lynnwood: 1 Main St"]);
});
