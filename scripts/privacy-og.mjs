// Makes the share image for the Privacy page (site/assets/img/og-privacy.png, 1200 by 630):
// the crow and the page's promise, in the site's dark colors. Run by hand when it changes:
//   node scripts/privacy-og.mjs
// Needs Playwright with Chromium on the machine (not a dependency of the site). If Playwright's
// own Chromium isn't installed, set CHROME=/path/to/chrome.
import { createRequire } from "node:module";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { buddy } from "./buddy.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "site", "assets", "img", "og-privacy.png");
// Inlined: a page made with setContent can't load file:// fonts.
const FONT = `data:font/woff2;base64,${readFileSync(join(ROOT, "site", "assets", "fonts", "atkinson-hyperlegible-next.woff2")).toString("base64")}`;
const W = 1200, H = 630;
const html = `<!doctype html><html><head><style>
@font-face { font-family: A; src: url("${FONT}") format("woff2"); font-weight: 200 800; }
html, body { margin: 0; }
body { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; font-family: A, sans-serif; color: #eef3f6;
  background: #0f1a24; }
.cr-body { fill: #23272e; } .cr-sheen { fill: #3a4250; } .cr-wing { fill: #303846; } .cr-beak { fill: #6a7382; }
.cr-line { fill: none; stroke: #23272e; stroke-width: 2; opacity: .45; } .cr-wing-line { fill: none; stroke: #3a4250; stroke-width: 3; stroke-linecap: round; }
.cr-feet { fill: none; stroke: #6a7382; stroke-width: 4.5; stroke-linecap: round; }
.stage { position: absolute; left: 60px; top: 110px; width: 300px; height: 300px; border-radius: 50%; background: #345a78; }
.b { position: absolute; left: 68px; top: 114px; width: 284px; height: 284px; }
.b svg { width: 100%; height: 100%; display: block; overflow: visible; }
.coin { position: absolute; left: 98px; top: 338px; width: 50px; height: 50px; }
.txt { position: absolute; left: 420px; right: 64px; top: 74px; }
.kicker { font-size: 26px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6cc4e8; margin: 0 0 22px; }
.ask { font-size: 68px; line-height: 1.06; font-weight: 800; letter-spacing: -.02em; margin: 0; padding-left: 30px; border-left: 8px solid #f2c14e; }
p.d { font-size: 30px; line-height: 1.3; color: #c9d4dc; margin: 34px 0 0; max-width: 680px; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 64px 0 70px; border-top: 1.5px solid #2a3d4e; background: #0b141c; font-size: 25px; color: #a9b8c4; }
.foot b { color: #6cc4e8; font-weight: 700; }
</style></head><body>
<div class="stage"></div>
<div class="b">${buddy("sleepy", 284)}</div>
<svg class="coin" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="#f2c14e" stroke="#b8862a" stroke-width="3.5"/><path d="M13 13 a9 9 0 0 1 9 -3.5" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".85"/></svg>
<div class="txt">
  <p class="kicker">Privacy</p>
  <p class="ask">No accounts, no ads, nothing sold.</p>
  <p class="d">Your list and your stores stay with you. Usage counts are private, and you can turn them off.</p>
</div>
<div class="foot"><b>seattlegrocery.deals/privacy</b><span>The website and the app</span></div>
</body></html>`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: "png" });
await browser.close();
console.log(`Wrote ${OUT}`);
