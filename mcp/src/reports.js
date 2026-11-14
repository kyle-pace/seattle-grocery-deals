// "Think this is wrong?": a person on the site or in the app says a store's flyer status looks
// wrong (most often, a new flyer is up but we still say it isn't). The report lands here; the
// flyer watcher (scripts/watch-flyers.mjs) reads the open reports every 30 minutes, checks
// the store again and sends the owner an alert.
//
// What's kept, per store: how many reports, and when the first and latest came in. Nothing
// about the person: no address, no device, no account. Each entry expires after a week.
//
//   POST /report   {"store": "smith-brothers", "about": "flyer"}   -> 204
//   GET  /reports  -> {"reports": [{store, about, count, first_at, last_at}]}

const KEEP_SECONDS = 7 * 24 * 3600;
// A second report for the same store inside this window is counted but doesn't move last_at,
// so tapping twice (or a burst) doesn't look like a fresh report to the watcher.
const QUIET_MS = 10 * 60 * 1000;
const ABOUT = new Set(["flyer"]);
const ORIGINS = ["https://seattlegrocery.deals", "http://localhost:8080", "http://127.0.0.1:8080"];

export const REPORT_PATHS = new Set(["/report", "/reports"]);

function cors(request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const reply = (request, status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status,
  headers: { ...cors(request), ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" }), "cache-control": "no-store" },
});

export async function handleReports(request, env, { knownStore } = {}) {
  const path = new URL(request.url).pathname;
  if (request.method === "OPTIONS") return reply(request, 204);
  if (!env?.REPORTS) return reply(request, 503, { error: "Reports aren't set up on this server." });

  if (path === "/reports" && request.method === "GET") {
    const reports = [];
    let cursor;
    do {
      const page = await env.REPORTS.list({ prefix: "report:", cursor });
      for (const k of page.keys) {
        const v = await env.REPORTS.get(k.name, "json");
        if (v) reports.push(v);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    reports.sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
    return reply(request, 200, { reports });
  }

  if (path === "/report" && request.method === "POST") {
    let body;
    try {
      body = JSON.parse((await request.text()).slice(0, 2000));
    } catch {
      return reply(request, 400, { error: "Send JSON like {\"store\": \"hmart\"}." });
    }
    const store = String(body?.store ?? "");
    const about = String(body?.about ?? "flyer");
    if (!/^[a-z0-9-]{1,40}$/.test(store)) return reply(request, 400, { error: "Not a store id." });
    if (!ABOUT.has(about)) return reply(request, 400, { error: "Not something that can be reported." });
    if (knownStore && !(await knownStore(store))) return reply(request, 400, { error: "No store by that id." });

    const key = `report:${about}:${store}`;
    const now = new Date();
    const prev = await env.REPORTS.get(key, "json");
    const quiet = prev && now - new Date(prev.last_at) < QUIET_MS;
    const next = {
      store,
      about,
      count: (prev?.count ?? 0) + 1,
      first_at: prev?.first_at ?? now.toISOString(),
      last_at: quiet ? prev.last_at : now.toISOString(),
    };
    await env.REPORTS.put(key, JSON.stringify(next), { expirationTtl: KEEP_SECONDS });
    return reply(request, 204);
  }

  return reply(request, 405, { error: "Use POST /report or GET /reports." });
}
