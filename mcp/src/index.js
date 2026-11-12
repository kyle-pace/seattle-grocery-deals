// Seattle Grocery Deals as an MCP server: a small Cloudflare Worker that lets an AI assistant
// (Claude, ChatGPT, anything that speaks MCP over Streamable HTTP) ask what's on sale.
//
// It keeps no data of its own. Each answer comes from the same public feed the iPhone app
// reads, /api/week.json on the site, so the site stays the one source of truth. Read-only, no
// sign-in, nothing about the person asking is stored. See mcp/README.md.

import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { listStores, planTrip, searchDeals, thisWeek } from "./deals.js";

const VERSION = "0.2.0";
const DEFAULT_FEED = "https://seattlegrocery.deals/api/week.json";
const FRESH_MS = 5 * 60 * 1000; // the site rebuilds hourly, and on every new flyer

// The feed, kept in this isolate's memory for a few minutes so a burst of tool calls is one
// fetch. If the site can't be reached, the last good copy is better than an error.
let cached = { at: 0, url: "", feed: null };

async function loadFeed(env) {
  const url = env?.FEED_URL || DEFAULT_FEED;
  if (cached.feed && cached.url === url && Date.now() - cached.at < FRESH_MS) return cached.feed;
  try {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "seattle-grocery-deals-mcp" } });
    if (!res.ok) throw new Error(`The deals feed answered ${res.status}`);
    const feed = await res.json();
    if (!Array.isArray(feed.items) || !Array.isArray(feed.stores)) throw new Error("The deals feed is not in the expected shape");
    cached = { at: Date.now(), url, feed };
    return feed;
  } catch (e) {
    if (cached.feed && cached.url === url) return cached.feed;
    throw e;
  }
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const failed = (e) => ({ isError: true, content: [{ type: "text", text: `Could not read this week's deals: ${e.message}. Try again in a minute, or see https://seattlegrocery.deals/` }] });

// "Your stores" inputs, shared by the tools. Nothing is stored here: the assistant passes them
// on each call, or the connection's own address carries them (see `defaultsFrom`).
const YOUR_STORES = {
  stores: z.array(z.string()).optional().describe("The stores the person shops at, as ids or names (for example ['uwajimaya', 'PCC']). Pass it on every call once you know it: results are then ranked for those stores only."),
  skip_stores: z.array(z.string()).optional().describe("Stores the person doesn't shop at. They are left out of every result."),
};

// The address can carry a person's stores, so an assistant with no memory still gets them:
// https://mcp.seattlegrocery.deals/?stores=uwajimaya,pcc&skip=99-ranch
// It's a default only; `stores` or `skip_stores` on a call wins.
export function defaultsFrom(url) {
  const list = (name) => (url.searchParams.get(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
  return { stores: list("stores"), skip_stores: list("skip") };
}

const withDefaults = (args, defaults) => ({
  ...args,
  stores: args.stores?.length ? args.stores : defaults.stores,
  skip_stores: args.skip_stores?.length ? args.skip_stores : defaults.skip_stores,
});

function createServer(env, defaults = { stores: [], skip_stores: [] }) {
  const preset =
    defaults.stores.length || defaults.skip_stores.length
      ? ` This connection was set up with the person's stores${defaults.stores.length ? ` (shops at: ${defaults.stores.join(", ")})` : ""}${defaults.skip_stores.length ? ` (skips: ${defaults.skip_stores.join(", ")})` : ""}; they apply to every call unless you pass others.`
      : "";
  const server = new McpServer(
    { name: "seattle-grocery-deals", title: "Seattle Grocery Deals", version: VERSION, websiteUrl: "https://seattlegrocery.deals/" },
    {
      instructions:
        "This week's grocery flyer sales at Seattle-area specialty grocers (Asian markets, seafood shops, co-ops), on food for cooking. " +
        "Use this_week for an overview or 'where should I shop', plan_trip to pick the one store that covers a shopping list, search_deals to look for ingredients or browse a store or aisle, and list_stores for store details. " +
        "People shop one store per trip and only at stores they like. If you know which stores the person shops at or avoids (they said so, or you remember), pass them as `stores` and `skip_stores` on every call. If you don't know and they ask where to shop or what to buy, ask which stores they use before recommending. " +
        "Recommend one store for a trip, not one item from each of several stores, unless they ask for the cheapest of everything. " +
        "Repeat prices exactly as given and say which store each is at; they come from printed flyers and can change. " +
        "Only stores and items listed here are covered, so 'not found' means not in these flyers, not that it isn't sold." +
        preset,
    },
  );

  server.registerTool(
    "this_week",
    {
      title: "This week's deals at a glance",
      description:
        "Overview of this week's Seattle grocery sales: every store ranked by how good its week is (with a one-line reason and its top deals), the 10 best single deals, and what's in season. " +
        "Start here for open questions like 'what's on sale this week?' or 'where should I shop?'. " +
        "With `stores`, only the person's stores are ranked and the best deals come from them; another store is named under `elsewhere` only when its week is far better.",
      inputSchema: z.object({
        ...YOUR_STORES,
        vegetarian: z.boolean().optional().describe("Only count and show vegetarian deals."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        return json(thisWeek(await loadFeed(env), withDefaults(args, defaults)));
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    "search_deals",
    {
      title: "Search this week's deals",
      description:
        "Find sale items in this week's Seattle grocery flyers. Give ingredients in `query`, several at once separated by commas (for example 'chicken thighs, tofu, bok choy'), and/or narrow by store, aisle, rating or vegetarian. " +
        "With no query it lists the best deals the filters allow. Results come best first, each with its printed price, store, and when the sale ends. Deals that have ended are left out. " +
        "With `stores`, only the person's stores are searched, and `elsewhere` counts what other stores have. To choose where to shop for a list, use plan_trip instead.",
      inputSchema: z.object({
        ...YOUR_STORES,
        everywhere: z.boolean().optional().describe("Search every store even when the person's stores are known. Skipped stores stay out."),
        query: z.string().optional().describe("One or more ingredients or words, separated by commas. A deal matches if it has every word of any one of them. Leave out to browse."),
        store: z.string().optional().describe("Just this one store, by id or name, for example 'uwajimaya' or 'H Mart'. See list_stores."),
        aisle: z.string().optional().describe("One of: produce, meat, seafood, dairy-eggs, pantry, frozen, bakery, other."),
        rating: z.enum(["standout", "good", "any"]).optional().describe("'standout' for only the best deals, 'good' for good deals and standouts, 'any' (default) for everything on sale."),
        vegetarian: z.boolean().optional().describe("Only vegetarian deals."),
        limit: z.number().int().min(1).max(60).optional().describe("How many deals to return. Default 20."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        return json(searchDeals(await loadFeed(env), withDefaults(args, defaults)));
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    "plan_trip",
    {
      title: "One store for a shopping list",
      description:
        "For a list of things to buy, find the single store that has the most of them on sale this week. Each store comes back with how many of the items it covers, its best deal for each, and what isn't on sale there, best coverage first. " +
        "Use it for 'where should I shop for these?' or after choosing recipes, so the person makes one trip. With `stores`, only the person's stores are compared, and another store is named under `elsewhere` only if it covers more of the list.",
      inputSchema: z.object({
        items: z.string().describe("The things to buy, separated by commas, for example 'salmon, tofu, bok choy, apples'. Plain ingredient names work best."),
        ...YOUR_STORES,
        vegetarian: z.boolean().optional().describe("Only count vegetarian deals."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        return json(planTrip(await loadFeed(env), withDefaults(args, defaults)));
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    "list_stores",
    {
      title: "Stores covered",
      description:
        "The Seattle-area stores this covers, best week first: what each store is, its locations and addresses, this week's flyer dates, a link to its weekly ad, delivery notes, and a one-line read on its week. " +
        "Use it to answer 'which stores do you cover?', to ask the person which of them they shop at, or to get a store id. The person's stores, when known, come first and are marked.",
      inputSchema: z.object({
        ...YOUR_STORES,
        vegetarian: z.boolean().optional().describe("Rank and describe each store's week by its vegetarian deals."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        return json(listStores(await loadFeed(env), withDefaults(args, defaults)));
      } catch (e) {
        return failed(e);
      }
    },
  );

  return server;
}

// Where a person who opens the server's address in a browser is sent: the page on the site
// that explains it and has the Add to Claude button (mcpPage in scripts/build.mjs).
const PAGE = "https://seattlegrocery.deals/mcp/";

// The server answers at the bare address (https://mcp.seattlegrocery.deals) and at /mcp, the
// path it started on. A person opening the address in a browser is sent to the page about it;
// an MCP client (it POSTs, or asks for an event stream) gets the server.
const MCP_PATHS = new Set(["/", "/mcp"]);

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!MCP_PATHS.has(url.pathname)) {
      return new Response("Not found. Connect an MCP client to the bare address.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const browsing = request.method === "GET" && !(request.headers.get("accept") || "").includes("text/event-stream");
    if (browsing) return Response.redirect(PAGE, 302);
    // A fresh server per request: the handler is stateless, so no sessions or storage. A
    // person's stores, if the address carries them, are read from it each time.
    const defaults = defaultsFrom(url);
    return createMcpHandler(() => createServer(env, defaults), {
      route: url.pathname,
      ...(env?.ALLOWED_HOSTNAMES ? { allowedHostnames: String(env.ALLOWED_HOSTNAMES).split(",").map((h) => h.trim()) } : {}),
    })(request, env, ctx);
  },
};
