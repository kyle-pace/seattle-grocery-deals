// Sends "New deals are in" through Firebase Cloud Messaging. Run by the deploy workflow when
// stores' new flyers go live (scripts/new-flyers.mjs says which), or by hand for a test:
//
//   node scripts/send-push.mjs --stores lams,hmart             # the stores that just updated
//   node scripts/send-push.mjs --topic new-deals-test          # send to your debug phone
//   node scripts/send-push.mjs --stores lams --dry-run         # print the messages only
//
// Topics: the app joins store-<id> for each store someone picked ("Your stores"), or
// new-deals when they haven't picked any (they hear about every store). With --stores, one
// message goes to new-deals and one to the people who picked any of those stores (FCM allows
// five topics per condition, so more than five stores are split into several messages).
//
// Signing in, one of:
//   - FCM_ACCESS_TOKEN and FIREBASE_PROJECT_ID: what the workflow uses. GitHub gets a
//     short-lived token for the push-sender account through Workload Identity Federation,
//     so there's no stored key.
//   - FIREBASE_SERVICE_ACCOUNT: a service account's JSON key, for running from a Mac. The
//     script signs its own token with Node's crypto. Keep the key out of the repo.
// Either way the account should only have "Firebase Cloud Messaging API Admin".
//
// Sending once per flyer is the workflow's job (notified/<store>/<date> git tags); this script
// only refuses to announce a week that isn't current, unless you pass --force.

import { readdirSync, readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const topic = option("topic", "new-deals");
const storeIds = option("stores", "").split(",").map((s) => s.trim()).filter(Boolean);
const dryRun = flag("dry-run");
const force = flag("force");

if (!/^[a-zA-Z0-9-_.~%]+$/.test(topic)) fail(`Not a valid FCM topic name: ${topic}`);
for (const id of storeIds) if (!/^[a-z0-9-]+$/.test(id)) fail(`Not a store id: ${id}`);

// The newest week file is the one the site just published.
const weeksDir = join(ROOT, "data", "weeks");
const latestFile = readdirSync(weeksDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
if (!latestFile) fail("No week files in data/weeks.");
const week = JSON.parse(readFileSync(join(weeksDir, latestFile), "utf8"));

// A week is current from its Friday through the following Thursday.
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const ageDays = Math.round((Date.parse(today) - Date.parse(week.week)) / 86_400_000);
if (!force && (ageDays < 0 || ageDays > 6)) {
  console.log(`Week ${week.week} isn't current (today is ${today}); not sending. Use --force to send anyway.`);
  process.exit(0);
}

const storeNames = Object.fromEntries(JSON.parse(readFileSync(join(ROOT, "config", "stores.json"), "utf8")).stores.map((s) => [s.id, s.name]));
let body;
if (storeIds.length) {
  const names = storeIds.map((id) => storeNames[id] ?? id);
  const n = week.items.filter((i) => storeIds.includes(i.store)).length;
  const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  body = `New flyer${names.length === 1 ? "" : "s"} from ${list}: ${n} deal${n === 1 ? "" : "s"}.`;
} else {
  const deals = week.items.length;
  const stores = new Set(week.items.map((i) => i.store)).size;
  body = `This week's deals are up: ${deals} deals from ${stores} stores.`;
}
const base = {
  notification: { title: "New deals are in", body },
  // The app reads these when the notification is tapped: open This week and fetch the week.
  data: { kind: "new_deals", week: week.week, stores: storeIds.join(",") },
  apns: { payload: { aps: { sound: "default" } } },
};
// Who gets it: with --stores, everyone on new-deals plus anyone who picked one of the stores.
const targets = [];
if (storeIds.length) {
  targets.push({ topic: "new-deals" });
  for (let i = 0; i < storeIds.length; i += 5) {
    const chunk = storeIds.slice(i, i + 5);
    targets.push(chunk.length === 1 ? { topic: `store-${chunk[0]}` } : { condition: chunk.map((id) => `'store-${id}' in topics`).join(" || ") });
  }
} else targets.push({ topic });
const messages = targets.map((t) => ({ ...t, ...base }));

console.log(`Week ${week.week}: ${body}\n  to ${targets.map((t) => t.topic ?? t.condition).join("\n  to ")}`);
if (dryRun) {
  console.log(JSON.stringify({ messages }, null, 2));
  process.exit(0);
}

let token = process.env.FCM_ACCESS_TOKEN;
let projectId = process.env.FIREBASE_PROJECT_ID;
if (!token) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) fail("Set FCM_ACCESS_TOKEN and FIREBASE_PROJECT_ID, or FIREBASE_SERVICE_ACCOUNT.");
  let account;
  try {
    account = JSON.parse(raw);
  } catch {
    fail("FIREBASE_SERVICE_ACCOUNT isn't valid JSON.");
  }
  token = await accessToken(account);
  projectId ??= account.project_id;
}
if (!projectId) fail("FIREBASE_PROJECT_ID isn't set.");

for (const message of messages) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const text = await res.text();
  if (!res.ok) fail(`FCM said ${res.status}: ${text}`);
  console.log(`Sent to ${projectId} (${message.topic ?? message.condition}): ${JSON.parse(text).name}`);
}

// A short-lived OAuth token from the service account key (the JWT bearer flow).
async function accessToken({ client_email, private_key, token_uri = "https://oauth2.googleapis.com/token" }) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(private_key, "base64url");
  const r = await fetch(token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const j = await r.json();
  if (!r.ok) fail(`Google token request failed (${r.status}): ${JSON.stringify(j)}`);
  return j.access_token;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
