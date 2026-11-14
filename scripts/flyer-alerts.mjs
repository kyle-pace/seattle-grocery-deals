// Sends the owner's flyer alerts that watch-flyers.mjs worked out (state.alerts), then marks
// them sent in the same state file. Run by .github/workflows/watch-flyers.yml after the check.
//
//   node scripts/flyer-alerts.mjs --state ../state/state.json
//   node scripts/flyer-alerts.mjs --state /tmp/s.json --dry-run     # print only
//   node scripts/flyer-alerts.mjs --test                            # one test alert
//
// Two channels, so one failing doesn't lose an alert:
// - A push to ALERT_TOPIC (default new-deals-test, which only Deals Dev on the owner's phones
//   joins; see Push.swift). Several new alerts in one run go out as one push.
// - A GitHub issue per alert, labeled flyer-alert, closed with a comment when the problem goes
//   away. The issue is the record; the push is the nudge.
//
// Needs FCM_ACCESS_TOKEN and FIREBASE_PROJECT_ID for the push (the workflow signs in through
// Workload Identity Federation, like pages.yml), and GITHUB_TOKEN and GITHUB_REPOSITORY for
// issues. Whatever is missing is skipped with a note.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const option = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const statePath = option("state", "watch-state.json");
const dryRun = flag("dry-run");
const topic = process.env.ALERT_TOPIC || "new-deals-test";
const repo = process.env.GITHUB_REPOSITORY;
const gh = process.env.GITHUB_TOKEN;
const runUrl = process.env.GITHUB_RUN_ID && repo ? `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : "";
const SITE = "https://seattlegrocery.deals";

async function push(title, body, stores) {
  const token = process.env.FCM_ACCESS_TOKEN;
  const project = process.env.FIREBASE_PROJECT_ID;
  if (dryRun || !token || !project) {
    console.log(`Push${dryRun ? " (dry run)" : " skipped (no FCM_ACCESS_TOKEN or FIREBASE_PROJECT_ID)"} to ${topic}: ${title} / ${body}`);
    return dryRun;
  }
  const message = {
    topic,
    notification: { title, body },
    data: { kind: "flyer_alert", stores: stores.join(",") },
    apns: { payload: { aps: { sound: "default", "interruption-level": "time-sensitive" } } },
  };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) { console.error(`Push failed (${res.status}): ${(await res.text()).slice(0, 300)}`); return false; }
  console.log(`Pushed to ${topic}: ${title} / ${body}`);
  return true;
}

async function github(method, path, body) {
  if (dryRun || !gh || !repo) {
    console.log(`GitHub${dryRun ? " (dry run)" : " skipped (no GITHUB_TOKEN)"}: ${method} ${path}${body?.title ? ` "${body.title}"` : ""}`);
    return null;
  }
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { authorization: `Bearer ${gh}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "flyer-alerts" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { console.error(`GitHub ${method} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`); return null; }
  return res.status === 204 ? {} : res.json();
}

const issueBody = (a) => [
  a.body,
  "",
  `- Store page: ${SITE}/stores/${a.store}/`,
  `- Kind: \`${a.kind}\`, open since ${a.since}`,
  runUrl ? `- Found by: ${runUrl}` : "",
  "",
  "This closes itself when the problem goes away (scripts/flyer-alerts.mjs).",
].filter((l) => l !== "").join("\n").replace("\n- Store", "\n\n- Store");

if (flag("test")) {
  await push("Flyer alert (test)", "If you can read this on Deals Dev, flyer alerts reach you.", []);
  process.exit(0);
}

if (!existsSync(statePath)) { console.log(`No state at ${statePath}; nothing to send.`); process.exit(0); }
const state = JSON.parse(readFileSync(statePath, "utf8"));
state.alerts ??= {};
state.resolved ??= [];

const fresh = Object.entries(state.alerts).filter(([, a]) => !a.notified_at || a.renotify);
if (fresh.length) {
  const title = fresh.length === 1 ? "Flyer alert" : `${fresh.length} flyer alerts`;
  const body = fresh.length === 1 ? fresh[0][1].title : fresh.map(([, a]) => a.title).join("\n");
  const pushed = await push(title, body, [...new Set(fresh.map(([, a]) => a.store))]);
  for (const [key, a] of fresh) {
    let opened = false;
    if (!a.issue) {
      const issue = await github("POST", "/issues", { title: `Flyer alert: ${a.title}`, body: issueBody(a), labels: ["flyer-alert"] });
      if (issue?.number) { a.issue = issue.number; opened = true; console.log(`Opened #${issue.number}: ${a.title}`); }
    } else if (a.renotify) {
      await github("POST", `/issues/${a.issue}/comments`, { body: `Another report: ${a.body}` });
      opened = true;
    }
    if (!dryRun && (pushed || opened)) { a.notified_at = new Date().toISOString(); delete a.renotify; }
    state.alerts[key] = a;
  }
}

const stillOpen = [];
for (const r of state.resolved) {
  if (r.issue) {
    const ok = await github("POST", `/issues/${r.issue}/comments`, { body: `Looks fixed as of ${r.resolved_at}${runUrl ? ` (${runUrl})` : ""}. Closing.` });
    const closed = ok && await github("PATCH", `/issues/${r.issue}`, { state: "closed", state_reason: "completed" });
    if (!closed && !dryRun && gh) { stillOpen.push(r); continue; }
    console.log(`Closed #${r.issue}: ${r.title}`);
  }
}
if (!fresh.length && !state.resolved.length) console.log("No new or resolved alerts.");
state.resolved = dryRun ? state.resolved : stillOpen;
if (!dryRun) writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
