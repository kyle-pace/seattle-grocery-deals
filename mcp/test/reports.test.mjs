// Checks for "Think this is wrong?" reports, against an in-memory stand-in for Workers KV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleReports } from "../src/reports.js";

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const post = (body, origin = "https://seattlegrocery.deals") => new Request("https://mcp.seattlegrocery.deals/report", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const list = () => new Request("https://mcp.seattlegrocery.deals/reports");

test("a report is counted and listed, with nothing about the person", async () => {
  const env = { REPORTS: fakeKV() };
  const r = await handleReports(post({ store: "smith-brothers" }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://seattlegrocery.deals");
  const out = await (await handleReports(list(), env)).json();
  assert.equal(out.reports.length, 1);
  assert.deepEqual(Object.keys(out.reports[0]).sort(), ["about", "count", "first_at", "last_at", "store"]);
  assert.equal(out.reports[0].count, 1);
});

test("a second report soon after is counted but keeps last_at", async () => {
  const env = { REPORTS: fakeKV() };
  await handleReports(post({ store: "hmart" }), env);
  const first = (await (await handleReports(list(), env)).json()).reports[0];
  await handleReports(post({ store: "hmart" }), env);
  const second = (await (await handleReports(list(), env)).json()).reports[0];
  assert.equal(second.count, 2);
  assert.equal(second.last_at, first.last_at);
});

test("bad input is refused", async () => {
  const env = { REPORTS: fakeKV() };
  assert.equal((await handleReports(post("not json"), env)).status, 400);
  assert.equal((await handleReports(post({ store: "../etc" }), env)).status, 400);
  assert.equal((await handleReports(post({ store: "hmart", about: "prices" }), env)).status, 400);
  const knownStore = async (id) => id === "hmart";
  assert.equal((await handleReports(post({ store: "nope" }), env, { knownStore })).status, 400);
  assert.equal((await handleReports(post({ store: "hmart" }), env, { knownStore })).status, 204);
  assert.equal(env.REPORTS.m.size, 1);
});

test("other sites don't get their origin echoed back", async () => {
  const env = { REPORTS: fakeKV() };
  const r = await handleReports(post({ store: "hmart" }, "https://evil.example"), env);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://seattlegrocery.deals");
});

test("without the KV binding it says so instead of failing", async () => {
  assert.equal((await handleReports(post({ store: "hmart" }), {})).status, 503);
});
