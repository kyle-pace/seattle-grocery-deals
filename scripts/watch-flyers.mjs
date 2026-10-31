// Watches each store's flyer page for a new flyer and starts the update routine for the
// stores that changed. Run every 30 minutes by .github/workflows/watch-flyers.yml.
//
//   node scripts/watch-flyers.mjs --state ../state/state.json            # check and fire
//   node scripts/watch-flyers.mjs --state /tmp/s.json --dry-run          # check only
//   node scripts/watch-flyers.mjs --only lams,hmart --dry-run            # some stores
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
const now = new Date();
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
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    if (click) {
      const button = page.getByRole("button", { name: click });
      const target = (await button.count()) ? button.first() : page.getByText(click, { exact: false }).first();
      await target.click({ timeout: 10_000 }).catch((e) => console.log(`  (click on "${click}" failed: ${e.message.split("\n")[0]})`));
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    const html = `${await page.content()}\n${loaded.join("\n")}`;
    return { html, text: await page.evaluate(() => document.body.innerText) };
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
  try {
    const page = w.render ? await rendered(w.url, w.click) : await fetched(w.url);
    found = matches(w, page);
    if (!found.length) throw new Error("the pattern matched nothing (page layout may have changed)");
  } catch (e) {
    state.stores[s.id] = { ...prev, error: String(e.message ?? e).slice(0, 200), error_at: nowIso };
    report.push(`${s.id}: ERROR ${e.message ?? e}`);
    continue;
  }
  const fingerprint = createHash("sha256").update(found.join("\n")).digest("hex").slice(0, 16);
  const entry = { ...prev, fingerprint, matches: found.slice(0, 20) };
  delete entry.error; delete entry.error_at;

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

if (!dryRun) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}
