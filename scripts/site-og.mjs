// Makes the site's default share image (site/assets/img/og.png, 1200 by 630): the persimmon
// buddy, the name, what the site is, and the stores it reads, in the site's dark colors. Every
// page without its own image (season pages have theirs) uses it, so it says nothing that goes
// stale: no dates, counts or prices. Run by hand when the art or the store list changes:
//   node scripts/site-og.mjs
// Needs Playwright with Chromium on the machine (not a dependency of the site). If Playwright's
// own Chromium isn't installed, set CHROME=/path/to/chrome.
import { createRequire } from "node:module";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { buddy } from "./buddy.mjs";
import { loadConfig } from "./lib.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "site", "assets", "img", "og.png");
// Inlined: a page made with setContent can't load file:// fonts.
const FONT = `data:font/woff2;base64,${readFileSync(join(ROOT, "site", "assets", "fonts", "atkinson-hyperlegible-next.woff2")).toString("base64")}`;
const cfg = loadConfig();
// The stores we read a flyer for, by their short names where the full one is long.
const SHORT = { "pcc": "PCC", "smith-brothers": "Smith Brothers", "met-market": "Met Market", "red-apple": "Red Apple", "tnt": "T&T", "99-ranch": "99 Ranch", "lams": "Lam's Seafood" };
const stores = cfg.stores.filter((s) => s.active && !s.no_online_flyer).map((s) => SHORT[s.id] ?? s.name);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const W = 1200, H = 630;
const html = `<!doctype html><html><head><style>
@font-face { font-family: A; src: url("${FONT}") format("woff2"); font-weight: 200 800; }
html, body { margin: 0; }
body { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; font-family: A, sans-serif; color: #eef1ee;
  background: radial-gradient(ellipse 60% 85% at 20% 45%, #2a1d15 0%, #121413 70%);
  --bd-fruit: #f08a4b; --bd-leaf: #5faf86; --bd-stem: #8a7058; --bd-face: #111412; }
.bd-fruit { fill: var(--bd-fruit); } .bd-shine { fill: #fff; opacity: .28; } .bd-stem { fill: var(--bd-stem); }
.bd-leaf { fill: var(--bd-leaf); } .bd-face { color: var(--bd-face); }
.b { position: absolute; left: 70px; top: 105px; width: 330px; height: 330px; }
.b svg { width: 100%; height: 100%; display: block; }
.shadow { position: absolute; left: 115px; top: 431px; width: 240px; height: 26px; border-radius: 50%; background: #f08a4b; opacity: .14; }
.txt { position: absolute; left: 460px; right: 64px; top: 62px; }
.kicker { font-size: 26px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #f5a06a; margin: 0 0 14px; }
h1 { font-size: 84px; line-height: .98; font-weight: 800; letter-spacing: -.02em; margin: 0 0 18px; }
p.d { font-size: 31px; line-height: 1.3; color: #c9cfcb; margin: 0 0 24px; max-width: 640px; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; max-width: 690px; }
.chip { font-size: 21px; font-weight: 600; color: #c9cfcb; background: #1d201e; border: 1.5px solid #3a3f3c; border-radius: 999px; padding: 6px 15px; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 64px 0 70px; border-top: 1.5px solid #2a2e2b; background: #0e100f; font-size: 25px; color: #a3aba6; }
.foot b { color: #f5a06a; font-weight: 700; }
</style></head><body>
<div class="shadow"></div>
<div class="b">${buddy("happy", 330)}</div>
<div class="txt">
  <p class="kicker">Seattle grocery sales, sorted</p>
  <h1>Seattle Grocery Deals</h1>
  <p class="d">This week's sales at Asian markets, seafood shops and co-ops, with the standouts first.</p>
  <div class="chips">${stores.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>
</div>
<div class="foot"><b>seattlegrocery.deals</b><span>Updated as each new flyer comes out</span></div>
</body></html>`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: "png" });
await browser.close();
console.log(`Wrote ${OUT}`);
