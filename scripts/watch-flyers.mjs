// Watches each store's flyer page for a new flyer and starts the update routine for the
// stores that changed. Run every 30 minutes by .github/workflows/watch-flyers.yml.
//
//   node scripts/watch-flyers.mjs --state ../state/state.json            # check and fire
//   node scripts/watch-flyers.mjs --state /tmp/s.json --dry-run          # check only
//   node scripts/watch-flyers.mjs --only lams,hmart --dry-run            # some stores
//   node scripts/watch-flyers.mjs --dry-run --now 2026-11-15T20:00:00Z   # try the alerts later on
//
// How it works: each store in config/stores.json with a "watch" entry names a page and a
// pattern. "match" is a regular expression run over the page's HTML (flyer image or PDF
// addresses, which change each week); "text" is one run over the page's text (printed sale
// dates). The sorted, de-duplicated matches are the store's fingerprint. When a fingerprint
// differs from the one in the state file, the store has a new flyer.
//
// - The first time a store is seen, its fingerprint is recorded and nothing is started: the
//   live data is assumed to be current.
// - A page that fails to load, or matches nothing, is recorded as an error and never counts
//   as a change (a broken page must not start a run).
// - Stores marked "desktop" can't be read from the cloud and are skipped here.
// - After firing, the store is "pending" until the latest week file shows a newer flyer for
//   it. If that hasn't happened after RETRY_HOURS, the routine is started again, up to
//   MAX_FIRES times for the same flyer.
//
// Alerts for the owner (scripts/flyer-alerts.mjs sends them, as a push to Deals Dev and a
// GitHub issue that closes itself when the problem goes away). A store gets one when:
// - overdue: its sale in the latest week ended and, by 10am the next day in Seattle, no newer
//   flyer has been read in (desktop-only stores included: their flyer may be up but unread);
// - watch: its page has failed or matched nothing for an hour (the pattern needs fixing);
// - stuck: the routine was started MAX_FIRES times for a new flyer and it never landed;
// - reported: someone tapped "Think this is wrong?" on the site or in the app (the reports
//   live on the MCP server's /reports, see mcp/src/reports.js).
// Each problem alerts once; the issue is closed when the problem is gone.
//
// Starting the routine needs ROUTINE_FIRE_URL and ROUTINE_FIRE_TOKEN (the routine's API
// trigger, made at claude.ai/code/routines). Without them, the run only reports.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const option = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const statePath = option("state", join(ROOT, "watch-state.json"));
const dryRun = flag("dry-run");
const only = option("only", "").split(",").filter(Boolean);
const RETRY_HOURS = 3;
const MAX_FIRES = 3;
const UA = "SeattleGroceryDeals/1.0 (+https://seattlegrocery.deals; flyer change check)";

const stores = JSON.parse(readFileSync(join(ROOT, "config", "stores.json"), "utf8")).stores
  .filter((s) => s.active && s.watch && (!only.length || only.includes(s.id)));
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { stores: {} };
state.stores ??= {};
// --now 2026-11-15T20:00:00Z pretends it is later, to try the alerts in a dry run.
const now = new Date(option("now", "") || Date.now());
const nowIso = now.toISOString();

// The newest flyer start date per store in the latest week file: how we know an update landed.
const weeksDir = join(ROOT, "data", "weeks");
const latestWeekFile = readdirSync(weeksDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
const latestWeek = JSON.parse(readFileSync(join(weeksDir, latestWeekFile), "utf8"));
const liveFrom = Object.fromEntries(latestWeek.flyers.map((f) => [f.store, `${f.valid_from ?? ""}|${(f.links ?? []).map((l) => l.url).join(" ")}`]));

let browser = null;
async function rendered(url, click) {
  if (!browser) {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
  }
  const page = await browser.newPage({ userAgent: UA, viewport: { width: 1280, height: 1600 } });
  // Also keep every address the page loads (images included), so a poster that is set as a
  // background or swapped in by script still counts, whatever the page's markup looks like.
  const loaded = [];
  page.on("request", (r) => loaded.push(r.url()));
  let clicked = null;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    if (click) {
      const button = page.getByRole("button", { name: click });
      const target = (await button.count()) ? button.first() : page.getByText(click, { exact: false }).first();
      clicked = await target.click({ timeout: 10_000 }).then(() => "ok", (e) => {
        const why = e.message.split("\n")[0];
        console.log(`  (click on "${click}" failed: ${why})`);
        return `failed: ${why}`.slice(0, 120);
      });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    const html = `${await page.content()}\n${loaded.join("\n")}`;
    const text = await page.evaluate(() => document.body.innerText);
    // What the page looked like, kept in state.json only when the pattern matches nothing, so a
    // broken pattern can be fixed from what the watcher actually saw.
    const seen = [...new Set(loaded.map((u) => u.split("?")[0]))]
      .filter((u) => /\.(?:png|jpe?g|webp|gif|pdf)$|base44|\/api\/|upload|storage|media/i.test(u)).slice(0, 40);
    const debug = { final_url: page.url(), title: await page.title(), clicked, requests: loaded.length,
      text_start: text.replace(/\s+/g, " ").trim().slice(0, 300), urls: seen };
    return { html, text, debug };
  } finally {
    await page.close();
  }
}

async function fetched(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&#x2019;|&rsquo;/g, "'").replace(/\s+/g, " ");
  return { html, text };
}

function matches(w, page) {
  const out = new Set();
  if (w.match) for (const m of page.html.match(new RegExp(w.match, "gi")) ?? []) out.add(m);
  if (w.text) for (const m of page.text.match(new RegExp(w.text, "gi")) ?? []) out.add(m.replace(/\s+/g, " ").trim());
  return [...out].sort();
}

const changed = [];
const report = [];
for (const s of stores) {
  const w = s.watch;
  const prev = state.stores[s.id] ?? {};
  if (w.desktop) { report.push(`${s.id}: desktop only, skipped`); continue; }
  let found;
  let page;
  try {
    page = w.render ? await rendered(w.url, w.click) : await fetched(w.url);
    found = matches(w, page);
    if (!found.length) throw new Error("the pattern matched nothing (page layout may have changed)");
  } catch (e) {
    state.stores[s.id] = { ...prev, error: String(e.message ?? e).slice(0, 200), error_at: nowIso, error_since: prev.error_since ?? nowIso };
    if (page?.debug) state.stores[s.id].debug = page.debug;
    report.push(`${s.id}: ERROR ${e.message ?? e}`);
    continue;
  }
  const fingerprint = createHash("sha256").update(found.join("\n")).digest("hex").slice(0, 16);
  const entry = { ...prev, fingerprint, matches: found.slice(0, 20) };
  delete entry.error; delete entry.error_at; delete entry.error_since; delete entry.debug;

  if (!prev.fingerprint) {
    entry.seen_at = nowIso;
    report.push(`${s.id}: first check, recorded (${found.length} matches)`);
  } else if (prev.fingerprint !== fingerprint) {
    entry.seen_at = nowIso;
    entry.pending = { since: nowIso, live_before: liveFrom[s.id] ?? "", fires: 0 };
    changed.push(s.id);
    report.push(`${s.id}: NEW FLYER (${found.slice(0, 3).join(", ")}${found.length > 3 ? ", ..." : ""})`);
  } else if (prev.pending) {
    // Same flyer as before: has the update landed yet?
    if ((liveFrom[s.id] ?? "") !== prev.pending.live_before) {
      delete entry.pending;
      entry.updated_at = nowIso;
      report.push(`${s.id}: update landed`);
    } else if (prev.pending.unsent) {
      changed.push(s.id);
      report.push(`${s.id}: new flyer still waiting to be sent to the routine`);
    } else if (prev.pending.fires < MAX_FIRES && now - new Date(prev.pending.fired_at ?? prev.pending.since) > RETRY_HOURS * 3600_000) {
      changed.push(s.id);
      report.push(`${s.id}: still not updated after ${RETRY_HOURS}h, starting again`);
    } else {
      report.push(`${s.id}: waiting for the update (${prev.pending.fires} start${prev.pending.fires === 1 ? "" : "s"} so far)`);
    }
  } else {
    report.push(`${s.id}: no change`);
  }
  state.stores[s.id] = entry;
}
if (browser) await browser.close();

console.log(report.join("\n"));

if (changed.length) {
  const text = [
    `Stores: ${changed.join(", ")}`,
    "",
    "New flyers were spotted on these stores' pages. Run MODE: update in ROUTINE.md for them.",
    ...changed.map((id) => `- ${id}: ${state.stores[id].matches.slice(0, 5).join(" | ")}`),
  ].join("\n");
  const url = process.env.ROUTINE_FIRE_URL;
  const token = process.env.ROUTINE_FIRE_TOKEN;
  if (dryRun || !url || !token) {
    console.log(`\nWould start the update routine${dryRun ? " (dry run)" : " (no ROUTINE_FIRE_URL or ROUTINE_FIRE_TOKEN)"} with:\n${text}`);
    // Without a way to start it, don't mark the stores as fired, so a later run tries again.
    if (!dryRun) for (const id of changed) state.stores[id].pending.unsent = true;
  } else {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`Starting the routine failed (${res.status}): ${body.slice(0, 300)}`);
      for (const id of changed) state.stores[id].pending.unsent = true;
      process.exitCode = 1;
    } else {
      let session = "";
      try { session = JSON.parse(body).claude_code_session_url ?? ""; } catch {}
      console.log(`\nStarted the update routine for ${changed.join(", ")} ${session}`);
      for (const id of changed) {
        const p = state.stores[id].pending;
        p.fires = (p.fires ?? 0) + 1;
        p.fired_at = nowIso;
        p.session = session;
        delete p.unsent;
      }
    }
  }
}

// ---- Alerts for the owner (see the top of this file). Worked out after the checks and any
// routine starts, so "stuck" sees this run's fires. flyer-alerts.mjs sends what's new.
const ALERT_AFTER_ERROR_MIN = 60;
const OVERDUE_HOUR = 10; // Seattle time, the day after a sale ends
const REPORTS_URL = process.env.REPORTS_URL || "https://mcp.seattlegrocery.deals/reports";
const seattle = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
}).formatToParts(d).map((p) => [p.type, p.value]));
const nowLocal = seattle(now);
const todayLocal = `${nowLocal.year}-${nowLocal.month}-${nowLocal.day}`;
const allStores = JSON.parse(readFileSync(join(ROOT, "config", "stores.json"), "utf8")).stores
  .filter((s) => s.active && (!only.length || only.includes(s.id)));
const nameOf = Object.fromEntries(allStores.map((s) => [s.id, s.name]));
const flyerOf = Object.fromEntries(latestWeek.flyers.map((f) => [f.store, f]));
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const sees = (id) => {
  const w = state.stores[id];
  if (!w) return "The watcher doesn't check this store.";
  if (w.error) return `The watcher can't read the page: ${w.error}.`;
  return w.matches?.length ? `The page shows: ${w.matches.slice(0, 2).join(" | ")}.` : "";
};

let reports = [];
try {
  const r = await fetch(REPORTS_URL, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (r.ok) reports = (await r.json()).reports ?? [];
  else report.push(`(couldn't read reports: ${r.status})`);
} catch (e) {
  report.push(`(couldn't read reports: ${e.message ?? e})`);
}

const problems = {};
for (const s of allStores) {
  const w = state.stores[s.id] ?? {};
  const f = flyerOf[s.id];
  // Overdue: the sale ended, it's past 10am the next day, and nothing newer has landed.
  const due = f?.valid_through && (todayLocal > nextDay(f.valid_through) || (todayLocal === nextDay(f.valid_through) && Number(nowLocal.hour) >= OVERDUE_HOUR));
  if (due) {
    const waiting = w.pending && now - new Date(w.pending.since) < RETRY_HOURS * 3600_000;
    if (!waiting) {
      problems[`overdue:${s.id}:${f.valid_through}`] = {
        store: s.id, kind: "overdue",
        title: `${s.name}: sale ended ${shortDate(f.valid_through)}, no new flyer read`,
        body: [
          `The sale on the site ended ${shortDate(f.valid_through)} and no newer flyer has been read in.`,
          s.watch?.desktop ? "This store is read from a desktop browser, so its new flyer may be up and waiting." : sees(s.id),
          w.pending ? `The routine was started ${w.pending.fires ?? 0} ${(w.pending.fires ?? 0) === 1 ? "time" : "times"} for it.` : "",
        ].filter(Boolean).join(" "),
      };
    }
  }
  // Watch: the page has failed or matched nothing for a while.
  if (w.error && now - new Date(w.error_since ?? w.error_at) >= ALERT_AFTER_ERROR_MIN * 60_000) {
    problems[`watch:${s.id}`] = {
      store: s.id, kind: "watch",
      title: `${s.name}: the flyer watcher can't read its page`,
      body: `Since ${new Date(w.error_since ?? w.error_at).toISOString().slice(0, 16).replace("T", " ")} UTC: ${w.error}. Fix its "watch" entry in config/stores.json.`,
    };
  }
  // Stuck: the routine ran out of starts and the flyer still hasn't landed.
  if (w.pending && (w.pending.fires ?? 0) >= MAX_FIRES && now - new Date(w.pending.fired_at ?? w.pending.since) > RETRY_HOURS * 3600_000) {
    problems[`stuck:${s.id}:${w.fingerprint}`] = {
      store: s.id, kind: "stuck",
      title: `${s.name}: new flyer spotted, update never landed`,
      body: `The routine was started ${w.pending.fires} times since ${w.pending.since.slice(0, 10)} and the site still has the old flyer. ${w.pending.session ? `Last run: ${w.pending.session}` : ""}`.trim(),
    };
  }
}
// Reported: someone tapped "Think this is wrong?". One alert per new report (by last_at); it
// stays open until the store's flyer changes on the site or the report expires.
state.reports ??= {};
for (const r of reports) {
  if (!nameOf[r.store]) continue;
  const key = `reported:${r.store}:${r.first_at}`;
  const f = flyerOf[r.store];
  const landedSince = state.reports[key]?.live_before !== undefined && state.reports[key].live_before !== (liveFrom[r.store] ?? "");
  state.reports[key] ??= { live_before: liveFrom[r.store] ?? "" };
  if (landedSince) continue;
  problems[key] = {
    store: r.store, kind: "reported",
    title: `${nameOf[r.store]}: someone says the flyer status is wrong`,
    body: [
      `${r.count} report${r.count === 1 ? "" : "s"} from the site or app, latest ${r.last_at.slice(0, 16).replace("T", " ")} UTC.`,
      f?.valid_through ? `The site has its sale through ${shortDate(f.valid_through)}.` : "The site has no flyer for it this week.",
      sees(r.store),
    ].join(" "),
    count: r.count,
  };
}
for (const key of Object.keys(state.reports)) if (!reports.some((r) => key === `reported:${r.store}:${r.first_at}`) && !problems[key]) delete state.reports[key];

// Open new alerts, keep the open ones, and mark the gone ones resolved for flyer-alerts.mjs.
state.alerts ??= {};
state.resolved ??= [];
for (const [key, p] of Object.entries(problems)) {
  const prev = state.alerts[key];
  state.alerts[key] = { ...p, since: prev?.since ?? nowIso, notified_at: prev?.notified_at, issue: prev?.issue };
  // A new report on an already-open report alert sends one more push.
  if (prev?.notified_at && p.kind === "reported" && p.count > (prev.count ?? 0)) state.alerts[key].renotify = true;
  if (!prev) report.push(`ALERT ${p.title}`);
}
for (const key of Object.keys(state.alerts)) {
  if (problems[key]) continue;
  // Only resolve what this run looked at (with --only, the rest weren't checked).
  if (only.length && !only.includes(state.alerts[key].store)) continue;
  report.push(`resolved: ${state.alerts[key].title}`);
  state.resolved.push({ key, ...state.alerts[key], resolved_at: nowIso });
  delete state.alerts[key];
}
if (dryRun) console.log(`\nAlerts: ${JSON.stringify(state.alerts, null, 1)}`);
else if (Object.keys(problems).length || state.resolved.length) console.log(`\n${report.filter((l) => l.startsWith("ALERT") || l.startsWith("resolved")).join("\n") || `${Object.keys(problems).length} open alert(s)`}`);

function nextDay(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

if (!dryRun) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}
