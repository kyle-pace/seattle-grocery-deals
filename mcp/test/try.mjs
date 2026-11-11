// Talk to a running server the way an assistant would, with the official MCP client:
// connect, list the tools, call each one, and print short results.
//
//   npm run dev                      (in another terminal)
//   npm run try                      (uses http://localhost:8787/mcp)
//   npm run try -- https://<worker>.workers.dev/mcp
//
// Exits non-zero if anything fails, so it works as a smoke test after a deploy.

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = process.argv[2] ?? "http://localhost:8787/mcp";
const client = new Client({ name: "try-script", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const info = client.getServerVersion();
console.log(`Connected to ${info?.title ?? info?.name} ${info?.version} at ${url}`);

const { tools } = await client.listTools();
console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);

let failures = 0;
async function call(name, args, check) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const problem = res.isError ? text : !data ? "not JSON" : check(data);
  if (problem) failures++;
  console.log(`\n${problem ? "FAIL" : "ok  "} ${name}(${JSON.stringify(args)})${problem ? `: ${problem}` : ""}`);
  return data;
}

const week = await call("this_week", {}, (d) => (d.where_to_shop?.length && d.best_single_deals?.length ? null : "no stores or deals"));
if (week) {
  console.log(`     week of ${week.week_of}, ${week.deal_count} deals at ${week.store_count} stores`);
  console.log(`     best store: ${week.where_to_shop[0].name}. ${week.where_to_shop[0].this_week}`);
  console.log(`     best deal: ${week.best_single_deals[0].name}, ${week.best_single_deals[0].price} at ${week.best_single_deals[0].store}`);
}

const found = await call("search_deals", { query: "chicken, tofu, bok choy", limit: 6 }, (d) => (Array.isArray(d.deals) ? null : "no deals array"));
for (const d of found?.deals ?? []) console.log(`     ${d.name}, ${d.price} at ${d.store} (${d.rating}, ends ${d.ends})`);
for (const n of found?.notes ?? []) console.log(`     note: ${n}`);

const veg = await call("search_deals", { aisle: "produce", vegetarian: true, rating: "standout", limit: 3 }, (d) =>
  d.deals?.every((x) => x.vegetarian && x.rating === "Standout" && x.aisle === "Produce") ? null : "filters not applied",
);
for (const d of veg?.deals ?? []) console.log(`     ${d.name}, ${d.price} at ${d.store}`);

await call("search_deals", { store: "nowhere mart" }, (d) => (d.error && d.stores?.length ? null : "expected a helpful error"));

const stores = await call("list_stores", {}, (d) => (d.stores?.length ? null : "no stores"));
if (stores) console.log(`     ${stores.stores.length} stores: ${stores.stores.map((s) => s.name).join(", ")}`);

await client.close();
if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll good.");
