// Checks for config/places.json and the open-days logic: the real file must pass, a broken
// one must be caught, and the week ahead must come out right. Run: node --test scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPlaces, checkPlaces, daysAhead, regularOn, upcomingSpecials, placesFeed, weekday, runningNow } from "./places.mjs";

const real = loadPlaces();

test("the real config/places.json passes its checks", () => {
  assert.deepEqual(checkPlaces(real), []);
});

test("a broken file is caught, one problem per line", () => {
  const broken = {
    checked: "Nov 14",
    places: [
      { id: "Bad Id", kind: "market", name: "X", neighborhood: "Y", address: "Z", about: "too short", source: "http://not-https.example" },
      { id: "dup", kind: "shop", type: "bakery", name: "A", neighborhood: "B", address: "C", about: "A long enough description of a shop.", source: "https://example.com", hub: "nowhere" },
      { id: "dup", kind: "shop", type: "butcher", name: "A", neighborhood: "B", address: "C", about: "A long enough description of a shop.", source: "https://example.com", hours: ["Daily"] },
      { id: "m", kind: "market", name: "M", neighborhood: "N", address: "A", about: "A long enough description of a market.", source: "https://example.com", hours: ["Sat"], now: { days: ["saturday"], time: "", from: "2026-12-01", through: "2026-11-01" }, programs: ["coupons"] },
    ],
  };
  const errors = checkPlaces(broken).join("\n");
  for (const bit of ["checked must be", "Bad Id: id must be", "Bad Id: about must be", "Bad Id: source must be", "Bad Id: hours must be",
    "dup: id used twice", "dup: type must be", "dup: hub nowhere", "dup: only markets have", "m: now.days", "m: now.time", "m: now.from is after", "m: unknown program coupons"]) {
    assert.ok(errors.includes(bit), `expected "${bit}" in:\n${errors}`);
  }
  // A file that isn't the right shape at all reports that instead of throwing.
  assert.deepEqual(checkPlaces({}), ["places: checked must be a YYYY-MM-DD date", "places: places must be a list"]);
});

const market = (id, now, extra = {}) => ({ id, kind: "market", name: id, hours: ["x"], now, ...extra });

test("weekdays and runs with start and end dates", () => {
  assert.equal(weekday("2026-11-14"), "sat");
  const lakeCity = market("lc", { days: ["sat"], time: "10am to 2pm", from: "2026-10-03", through: "2026-12-19" });
  assert.equal(regularOn(lakeCity, "2026-11-14"), true);
  assert.equal(regularOn(lakeCity, "2026-11-15"), false); // a Sunday
  assert.equal(regularOn(lakeCity, "2026-12-26"), false); // past the run
  assert.equal(regularOn(lakeCity, "2026-09-26"), false); // before it
  assert.equal(runningNow(lakeCity, "2026-11-14"), true);
  assert.equal(runningNow(lakeCity, "2026-12-20"), false);
  const burien = market("b", { days: ["thu"], time: "10am to 4pm" }, { closed: [{ date: "2026-12-31", note: "Closed" }] });
  assert.equal(regularOn(burien, "2026-12-24"), true);
  assert.equal(regularOn(burien, "2026-12-31"), false);
});

test("the week ahead lists regular days and special markets, not every-day ones", () => {
  const places = [
    market("sun", { days: ["sun"], time: "9am to 2pm" }),
    market("daily", undefined, { every_day: true }),
    market("summer", undefined, { special: [{ date: "2026-11-20", name: "Harvest Market" }] }),
  ];
  const days = daysAhead(places, "2026-11-14", 7);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.date), ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  assert.deepEqual(days[1].open.map((o) => o.place.id), ["sun"]);
  assert.deepEqual(days[6].open.map((o) => [o.place.id, o.name]), [["summer", "Harvest Market"]]);
  assert.ok(days.every((d) => !d.open.some((o) => o.place.id === "daily")));
  assert.deepEqual(upcomingSpecials(places, "2026-11-21").length, 0);
  assert.deepEqual(upcomingSpecials(places, "2026-11-01").map((s) => s.date), ["2026-11-20"]);
});

test("the feed drops sources, adds page links, and keeps only dates still to come", () => {
  const feed = placesFeed(real, "2026-11-14", (p) => `https://seattlegrocery.deals/${p}`);
  assert.equal(feed.places.length, real.places.length);
  assert.ok(feed.places.every((p) => !("source" in p) && p.url.startsWith("https://seattlegrocery.deals/")));
  const ballard = feed.places.find((p) => p.id === "ballard");
  assert.deepEqual(ballard.open_next_7_days, [{ date: "2026-11-15", time: "9am to 2pm" }]);
  const pike = feed.places.find((p) => p.id === "pike-place");
  assert.equal(pike.open_next_7_days.length, 7);
  const phinney = feed.places.find((p) => p.id === "phinney");
  assert.deepEqual(phinney.open_next_7_days, [{ date: "2026-11-20", time: null, event: "Harvest Market" }]);
  assert.equal(placesFeed(real, "2027-01-01", (p) => p).places.find((p) => p.id === "phinney").special.length, 0);
});
