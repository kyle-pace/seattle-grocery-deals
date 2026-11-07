// Makes the site's default share image (site/assets/img/og.png, 1200 by 630): the crow with
// his coin, the name, what the site is, and the stores it reads, in the site's dark colors. Every
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
body { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; font-family: A, sans-serif; color: #eef3f6;
  background: #0f1a24; }
.cr-body { fill: #23272e; } .cr-sheen { fill: #3a4250; } .cr-wing { fill: #303846; } .cr-beak { fill: #6a7382; }
.cr-line { fill: none; stroke: #23272e; stroke-width: 2; opacity: .45; } .cr-wing-line { fill: none; stroke: #3a4250; stroke-width: 3; stroke-linecap: round; }
.cr-feet { fill: none; stroke: #6a7382; stroke-width: 4.5; stroke-linecap: round; }
.stage { position: absolute; left: 60px; top: 95px; width: 350px; height: 350px; border-radius: 50%; background: #345a78; }
.b { position: absolute; left: 70px; top: 100px; width: 330px; height: 330px; }
.b svg { width: 100%; height: 100%; display: block; overflow: visible; }
.coin { position: absolute; left: 106px; top: 362px; width: 56px; height: 56px; }
.txt { position: absolute; left: 460px; right: 64px; top: 62px; }
.kicker { font-size: 26px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6cc4e8; margin: 0 0 14px; }
h1 { font-size: 84px; line-height: .98; font-weight: 800; letter-spacing: -.02em; margin: 0 0 18px; }
p.d { font-size: 31px; line-height: 1.3; color: #c9d4dc; margin: 0 0 24px; max-width: 640px; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; max-width: 690px; }
.chip { font-size: 21px; font-weight: 600; color: #c9d4dc; background: #172633; border: 1.5px solid #2a3d4e; border-radius: 999px; padding: 6px 15px; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 64px 0 70px; border-top: 1.5px solid #2a3d4e; background: #0b141c; font-size: 25px; color: #a9b8c4; }
.foot b { color: #6cc4e8; font-weight: 700; }
</style></head><body>
<div class="stage"></div>
<div class="b">${buddy("happy", 330)}</div>
<svg class="coin" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="#f2c14e" stroke="#b8862a" stroke-width="3.5"/><path d="M13 13 a9 9 0 0 1 9 -3.5" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".85"/></svg>
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
