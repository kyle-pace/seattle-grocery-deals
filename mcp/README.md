# Seattle Grocery Deals MCP server

Lets an AI assistant (Claude, ChatGPT, or anything else that speaks MCP) look up this week's deals: "what's on sale at Uwajimaya?", "who has chicken thighs this week?", "where should I shop if I'm cooking vegetarian?".

Live at `https://seattle-grocery-deals-mcp.mail-4dd.workers.dev/mcp` (since November 11, 2026).

It is a small Cloudflare Worker with no data of its own. Every answer comes from the same public feed the iPhone app reads, `https://seattlegrocery.deals/api/week.json`, so the site stays the one source of truth and a new flyer shows up here within about five minutes of going live. Read-only, no sign-in, and nothing about the person asking is stored.

## Tools

| Tool | What it answers |
| --- | --- |
| `this_week` | The front page in one answer: stores ranked by how good their week is, the 10 best single deals, what's in season. |
| `search_deals` | Ingredients (several at once, separated by commas), or browse by store, aisle, rating or vegetarian. Ended deals are left out. |
| `list_stores` | Every store covered: what it is, addresses, flyer dates, weekly ad link, delivery. |

Prices are passed through exactly as the site shows them ("$2.99/lb", "2 for $6.00"); nothing is recomputed here.

## How it fits together

- `src/deals.js`: the answers, as plain functions over the feed. No network, no MCP.
- `src/index.js`: the Worker. Fetches the feed (kept in memory for five minutes), describes the three tools, and hands requests to `createMcpHandler` from Cloudflare's Agents SDK, which speaks MCP over Streamable HTTP at `/mcp`. Stateless: a fresh server per request, no sessions, no storage.
- `wrangler.jsonc`: the Worker's settings. `FEED_URL` is where the feed lives.
- `test/deals.test.mjs`: checks for the answers, on a small made-up feed (`npm test`, no install needed; also runs in the site's build).
- `test/try.mjs`: connects with the official MCP client and calls every tool (`npm run try`).

## Run it

```sh
cd mcp
npm install
npm test             # the logic
npm run dev          # the Worker at http://localhost:8787/mcp
npm run try          # in another terminal: call every tool
```

To try it against a local build of the site instead of the live feed: `npm run serve` in the repo root, then `npx wrangler dev --var FEED_URL:http://localhost:8080/api/week.json`.

## Deploy

Cloudflare Workers Builds deploys it from `main`, like the labs on kylepace.dev. The Worker is `seattle-grocery-deals-mcp`, set up in the Cloudflare dashboard like this:

- Repository: `kyle-pace/seattle-grocery-deals`, branch `main`
- Root directory: `mcp`
- Build command: none. Deploy command: `npx wrangler deploy`
- Build watch paths: include `mcp/*`, so flyer updates don't redeploy it
- Build token: its own, "seattle-grocery-deals-mcp build token", like the other Workers
- Preview builds off (the `flyer-watch` branch changes every 30 minutes), Cloudflare Access off (assistants need to reach it without a login)

After a deploy, check it: `npm run try -- https://seattle-grocery-deals-mcp.mail-4dd.workers.dev/mcp`.

It runs on the account's `workers.dev` address because seattlegrocery.deals keeps its DNS at Porkbun. To move it to a custom domain later (for example a kylepace.dev subdomain), add the route in `wrangler.jsonc` and set an `ALLOWED_HOSTNAMES` var to that hostname; the handler only answers hosts it knows.

## Connect an assistant

The address is `https://seattle-grocery-deals-mcp.mail-4dd.workers.dev/mcp`.

- Claude: Settings > Connectors > Add custom connector, paste the address.
- Claude Code: `claude mcp add --transport http seattle-grocery-deals https://seattle-grocery-deals-mcp.mail-4dd.workers.dev/mcp`
- Others: anywhere that takes a "remote MCP server" or "Streamable HTTP" address.
