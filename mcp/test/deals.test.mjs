// Checks for the tool logic, on a small made-up feed in the shape of /api/week.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findStore, listStores, planTrip, searchDeals, storeList, thisWeek, words } from "../src/deals.js";

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

// Your stores: a third store with a big week, to check what shows under "elsewhere".
const big = {
  ...feed,
  stores: [...feed.stores, { id: "uwajimaya", name: "Uwajimaya", about: "Japanese grocery.", locations: [], through: "2026-11-17", flyer_url: "https://example.com/ad" }, { id: "pcc", name: "PCC Community Markets", about: "Co-op.", locations: [], flyer_url: "https://example.com/pcc" }],
  items: [
    ...feed.items,
    item("uwajimaya-6", 6, "Salmon Fillet", "uwajimaya", "meat", { tier: "standout", veg: false }),
    item("uwajimaya-7", 7, "Firm Tofu", "uwajimaya", "dairy-eggs", { tier: "good" }),
    item("uwajimaya-8", 8, "Baby Bok Choy", "uwajimaya", "produce"),
  ],
  store_ranks: { ...feed.store_ranks, uwajimaya: { score: 40, standouts: 6, good: 1, deals: 3, reason: "A good week for seafood.", top: ["uwajimaya-6"] } },
};

test("a list of stores takes ids, names and commas, and names what it can't find", () => {
  const r = storeList(big, ["H-Mart", "ranch 99", "safeway"]);
  assert.deepEqual(r.found.map((s) => s.id), ["hmart", "99-ranch"]);
  assert.deepEqual(r.unknown, ["safeway"]);
  assert.deepEqual(storeList(big, "uwajimaya, pcc").found.map((s) => s.id), ["uwajimaya", "pcc"]);
});

test("this_week with your stores ranks only them and names one far better store", () => {
  const r = thisWeek(big, { stores: ["99 Ranch", "H Mart"] }, TODAY);
  assert.deepEqual(r.where_to_shop.map((s) => s.id), ["hmart", "99-ranch"]);
  assert.deepEqual(r.your_stores, ["99 Ranch Market", "H Mart"]);
  assert.equal(r.elsewhere.id, "uwajimaya"); // 6 standouts, and your best is having a quiet week
  assert.ok(r.best_single_deals.every((d) => d.store_id !== "uwajimaya"));
  // Uwajimaya picked: nothing left to point at elsewhere.
  assert.equal(thisWeek(big, { stores: ["uwajimaya", "hmart"] }, TODAY).elsewhere, undefined);
  // No stores picked ranks every store, as before.
  assert.deepEqual(thisWeek(big, {}, TODAY).where_to_shop.map((s) => s.id), ["uwajimaya", "hmart", "99-ranch"]);
});

test("a picked store with nothing listed stays, with its ad", () => {
  const r = thisWeek(big, { stores: ["pcc", "hmart"] }, TODAY);
  const pcc = r.where_to_shop.find((s) => s.id === "pcc");
  assert.equal(pcc.deals, 0);
  assert.equal(pcc.weekly_ad, "https://example.com/pcc");
});

test("skipped stores are left out of everything", () => {
  const week = thisWeek(big, { skip_stores: ["uwajimaya"] }, TODAY);
  assert.ok(!week.where_to_shop.some((s) => s.id === "uwajimaya"));
  assert.ok(week.best_single_deals.every((d) => d.store_id !== "uwajimaya"));
  assert.ok(searchDeals(big, { query: "tofu, salmon", skip_stores: ["uwajimaya"] }, TODAY).deals.every((d) => d.store_id !== "uwajimaya"));
  assert.ok(!planTrip(big, { items: "salmon, tofu", skip_stores: ["uwajimaya"] }, TODAY).stores.some((s) => s.id === "uwajimaya"));
  assert.match(thisWeek(big, { stores: ["safeway"] }, TODAY).notes.join(" "), /safeway/);
});

test("a search stays in your stores and counts the rest", () => {
  const r = searchDeals(big, { query: "tofu, salmon", stores: ["99-ranch"] }, TODAY);
  assert.deepEqual(r.deals.map((d) => d.store_id), ["99-ranch"]);
  assert.deepEqual(r.elsewhere, [{ store: "Uwajimaya", store_id: "uwajimaya", matching_deals: 2 }]);
  assert.match(r.notes.join(" "), /at your stores matching: salmon/);
  assert.equal(searchDeals(big, { query: "tofu, salmon", stores: ["99-ranch"], everywhere: true }, TODAY).total_matching, 3);
  // Naming one store wins over your stores.
  assert.deepEqual(searchDeals(big, { query: "salmon", stores: ["99-ranch"], store: "uwajimaya" }, TODAY).deals.map((d) => d.name), ["Salmon Fillet"]);
});

test("plan_trip picks the one store that covers the most of a list", () => {
  const r = planTrip(big, { items: "salmon, tofu, bok choy, chicken, saffron" }, TODAY);
  assert.equal(r.best_store.id, "uwajimaya");
  assert.equal(r.best_store.covers, 3);
  assert.equal(r.best_store.of, 5);
  assert.deepEqual(r.stores[0].not_on_sale_here, ["chicken", "saffron"]);
  assert.deepEqual(r.stores[0].on_sale.map((d) => d.item), ["salmon", "tofu", "bok choy"]);
  assert.match(r.notes.join(" "), /any store compared this week: saffron/);
  assert.ok(r.stores.every((s) => s.covers > 0));
});

test("plan_trip compares your stores, and names another only if it covers more", () => {
  const r = planTrip(big, { items: "salmon, tofu, bok choy, chicken", stores: ["hmart", "99-ranch"] }, TODAY);
  assert.deepEqual(r.stores.map((s) => s.id), ["99-ranch", "hmart"]); // 99 Ranch: chicken and tofu; H Mart: chicken (its tofu ended)
  assert.equal(r.best_store.id, "99-ranch");
  assert.equal(r.elsewhere.id, "uwajimaya");
  assert.equal(planTrip(big, { items: "chicken", stores: ["hmart"] }, TODAY).elsewhere, undefined);
  assert.match(planTrip(big, {}, TODAY).error, /items/);
});

test("list_stores puts your stores first and marks them", () => {
  const r = listStores(big, { stores: ["99-ranch"], skip_stores: ["hmart"] });
  assert.equal(r.stores[0].id, "99-ranch");
  assert.equal(r.stores[0].yours, true);
  assert.equal(r.stores.find((s) => s.id === "hmart").skipped, true);
  assert.equal(r.stores.length, 4);
});

test("plan_trip matches the item's name, not its aisle", () => {
  // Tofu sits in "Dairy and eggs": a list's "eggs" isn't tofu, at any store.
  const r = planTrip(big, { items: "eggs, tofu" }, TODAY);
  assert.ok(r.stores.every((s) => s.on_sale.every((d) => d.item !== "eggs")));
  assert.match(r.notes.join(" "), /any store compared this week: eggs/);
  // Search still finds an aisle by its name.
  assert.ok(searchDeals(big, { query: "eggs" }, TODAY).deals.length > 0);
});
