// Talk to a running server the way an assistant would, with the official MCP client:
// connect, list the tools, call each one, and print short results.
//
//   npm run dev                      (in another terminal)
//   npm run try                      (uses http://localhost:8787)
//   npm run try -- https://mcp.seattlegrocery.deals
//
// Exits non-zero if anything fails, so it works as a smoke test after a deploy.

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = process.argv[2] ?? "http://localhost:8787";
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

// Your stores: pick the two with the best weeks, and check everything stays inside them.
const mine = (week?.where_to_shop ?? []).slice(0, 2).map((s) => s.id);
if (mine.length) {
  const yours = await call("this_week", { stores: mine }, (d) =>
    d.where_to_shop?.every((s) => mine.includes(s.id)) && d.best_single_deals?.every((x) => mine.includes(x.store_id)) ? null : "not limited to your stores",
  );
  if (yours) console.log(`     your stores: ${yours.your_stores?.join(", ")}${yours.elsewhere ? `; elsewhere: ${yours.elsewhere.name}` : ""}`);
  await call("search_deals", { query: "chicken, tofu", stores: mine }, (d) => (d.deals?.every((x) => mine.includes(x.store_id)) ? null : "searched outside your stores"));
  await call("this_week", { skip_stores: [mine[0]] }, (d) => (d.where_to_shop?.some((s) => s.id === mine[0]) ? "skipped store still listed" : null));
}

const trip = await call("plan_trip", { items: "chicken, tofu, bok choy, apples, salmon" }, (d) => (Array.isArray(d.stores) && "best_store" in d ? null : "no plan"));
if (trip?.best_store) console.log(`     one stop: ${trip.best_store.name}, ${trip.best_store.covers} of ${trip.best_store.of} on sale`);
for (const s of (trip?.stores ?? []).slice(0, 3)) console.log(`     ${s.name}: ${s.on_sale.map((d) => `${d.item} (${d.price})`).join(", ")}`);

// The address can carry a person's stores (?stores=a,b&skip=c): a second connection that
// names none on the call should still get only those stores.
if (mine.length) {
  const preset = new Client({ name: "try-script", version: "0.1.0" });
  const withStores = new URL(url);
  withStores.searchParams.set("stores", mine.join(","));
  await preset.connect(new StreamableHTTPClientTransport(withStores));
  const res = await preset.callTool({ name: "this_week", arguments: {} });
  const d = JSON.parse(res.content?.[0]?.text ?? "{}");
  const ok = d.where_to_shop?.length && d.where_to_shop.every((s) => mine.includes(s.id));
  if (!ok) failures++;
  console.log(`\n${ok ? "ok  " : "FAIL"} this_week at ${withStores.search}: ${d.your_stores?.join(", ") ?? "no your_stores"}`);
  await preset.close();
}

await client.close();
if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll good.");
