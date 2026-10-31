// Which stores got a new flyer in a push to main, for "New deals are in".
//
//   node scripts/new-flyers.mjs <before-sha>        # prints "lams hmart" (or nothing)
//
// Compares the latest week file now with the same stores' flyers as of <before-sha> (in that
// week's file, or the week before it if this push started a new week). A store counts when
// its flyer is read (full or partial) and its start date or links changed. The deploy
// workflow then checks the notified/<store>/<start date> tags so each flyer is announced once.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, WEEKS_DIR } from "./lib.mjs";

const before = process.argv[2];
const files = readdirSync(WEEKS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const latest = files.at(-1);
const now = JSON.parse(readFileSync(join(WEEKS_DIR, latest), "utf8"));

function atBefore(file) {
  if (!before || /^0+$/.test(before)) return null;
  try {
    return JSON.parse(execFileSync("git", ["show", `${before}:data/weeks/${file}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}
// Before this push: the same week's file, or else the newest week file that existed then.
let old = atBefore(latest);
for (let i = files.length - 2; !old && i >= 0; i--) old = atBefore(files[i]);
const oldFlyers = Object.fromEntries((old?.flyers ?? []).map((f) => [f.store, f]));

const sig = (f) => (f && (f.status === "full" || f.status === "partial") ? `${f.valid_from}|${f.links.map((l) => l.url).join(" ")}` : "");
const changed = now.flyers
  .filter((f) => (f.status === "full" || f.status === "partial") && now.items.some((i) => i.store === f.store))
  .filter((f) => sig(f) !== sig(oldFlyers[f.store]))
  .map((f) => `${f.store}@${f.valid_from ?? "undated"}`);
console.log(changed.join(" "));
