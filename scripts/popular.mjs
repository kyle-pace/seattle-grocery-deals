// What people are adding this week, from Amplitude: writes dist/api/popular.json for the app's
// "Popular this week". Run by the build (scripts/build.mjs calls writePopular) and on its own:
//   AMPLITUDE_API_KEY=... AMPLITUDE_SECRET_KEY=... node scripts/popular.mjs
//
// Privacy: only counts of "Added Deal to List" by deal (public deal data). Typed list items are
// never sent to Amplitude, and only people who said yes in onboarding are counted. A deal shows
// up only once at least MIN_PEOPLE different people added it, so no one's list can be read off
// the feed. Without the keys (forks, local builds) it writes an empty list and the app falls
// back to the week's top picks.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_PEOPLE = 3;
const EVENT = "Added Deal to List";

const ymd = (iso) => iso.replaceAll("-", "");

/** Unique people per deal_id for this week's deals, from Amplitude's Event Segmentation API. */
async function fetchCounts({ apiKey, secretKey, start, end }) {
  const e = JSON.stringify({ event_type: EVENT, group_by: [{ type: "event", value: "deal_id" }] });
  const url = `https://amplitude.com/api/2/events/segmentation?e=${encodeURIComponent(e)}&m=uniques&i=30&start=${ymd(start)}&end=${ymd(end)}&limit=200`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}` } });
  if (!res.ok) throw new Error(`Amplitude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { data } = await res.json();
  // seriesLabels: [[0, "tnt-10"], ...]; seriesCollapsed: [[{ value: 4 }], ...] (totals over the range)
  const counts = new Map();
  (data.seriesLabels ?? []).forEach((label, i) => {
    const id = Array.isArray(label) ? label[1] : label;
    const total = data.seriesCollapsed?.[i]?.[0]?.value ?? (data.series?.[i] ?? []).reduce((a, b) => a + b, 0);
    if (id && id !== "(none)") counts.set(id, total);
  });
  return counts;
}

/**
 * Builds the popular list for a feed (the object appFeed() writes as /api/week.json).
 * `today` is a YYYY-MM-DD date in Pacific time.
 */
export async function popularFor(feed, { env = process.env, today } = {}) {
  const base = { week: feed.week, updated: new Date().toISOString(), min_people: MIN_PEOPLE, items: [] };
  const apiKey = env.AMPLITUDE_API_KEY, secretKey = env.AMPLITUDE_SECRET_KEY;
  if (!apiKey || !secretKey) return { ...base, note: "No Amplitude keys in this build." };
  const end = today && today < (feed.end ?? today) ? today : (feed.end ?? today ?? feed.week);
  try {
    const counts = await fetchCounts({ apiKey, secretKey, start: feed.week, end });
    const byId = new Map(feed.items.map((d) => [d.id, d]));
    const items = [...counts.entries()]
      .filter(([id, n]) => n >= MIN_PEOPLE && byId.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, n]) => {
        const d = byId.get(id);
        return { deal_id: id, key: d.key, name: d.name, store: d.store, people: n };
      });
    return { ...base, items };
  } catch (err) {
    // Never fail the build over analytics: keep the site going with an empty list.
    console.warn(`popular: ${err.message}`);
    return { ...base, note: "Amplitude couldn't be read for this build." };
  }
}

export async function writePopular(feed, distDir) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const popular = await popularFor(feed, { today });
  mkdirSync(join(distDir, "api"), { recursive: true });
  writeFileSync(join(distDir, "api", "popular.json"), JSON.stringify(popular));
  console.log(`popular.json: ${popular.items.length} deals added by ${MIN_PEOPLE}+ people${popular.note ? ` (${popular.note})` : ""}`);
  return popular;
}

// Run on its own against the built feed.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { readFileSync } = await import("node:fs");
  const feed = JSON.parse(readFileSync(join(root, "dist", "api", "week.json"), "utf8"));
  await writePopular(feed, join(root, "dist"));
}
