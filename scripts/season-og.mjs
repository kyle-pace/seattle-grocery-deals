// Makes a season page's share image: the item's buddy hopping while its fruit falls, as a looping
// 1200 by 630 GIF at the season's og_image in config/seasons.json (site/assets/img/<id>-og.gif if
// unset). The first frame is a good still on its own, since most apps (X, Facebook, LinkedIn) only
// show that one; Slack, Discord and a few others play it. Run by hand when the art changes, not in
// the weekly build:
//   node scripts/season-og.mjs persimmons
// Only items with a character can have one (scripts/buddy.mjs FRUIT_SVG); others use the site's
// default image. Was scripts/persimmon-og.mjs until 2026-10-31.
// Needs Playwright with Chromium and ffmpeg on the machine. Neither is a dependency of the site.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buddy, FRUIT_SVG } from "./buddy.mjs";
import { loadSeasons } from "./seasons.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = new URL("..", import.meta.url).pathname;
const id = process.argv[2] ?? "persimmons";
const season = loadSeasons(ROOT).find((s) => s.id === id);
if (!season) { console.error(`No season "${id}" in vendor/kitchen-catalog/seasons.json.`); process.exit(1); }
if (!FRUIT_SVG[season.buddy]) { console.error(`${id} has no character to draw yet (add it to scripts/buddy.mjs).`); process.exit(1); }
const OUT = join(ROOT, "site", season.og_image ?? `assets/img/${id}-og.gif`);
const C = season.colors.light;
const FONT = pathToFileURL(join(ROOT, "site", "assets", "fonts", "atkinson-hyperlegible-next.woff2")).href;

const W = 1200, H = 630, FPS = 20, LOOP = 3; // seconds; everything below repeats exactly every LOOP
const FRAMES = FPS * LOOP;

// Falling persimmons. Each one falls the whole height a whole number of times per loop and spins
// a whole number of turns, so the loop has no seam. Seeded so the art is the same every run.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// They stay out of the middle so none peek out from behind the buddy.
const fallers = Array.from({ length: 16 }, (_, i) => ({
  x: (i < 8 ? 0 : W / 2 + 200) + ((i % 8 + 0.5) / 8) * (W / 2 - 200) + (rand() - 0.5) * 30,
  size: 34 + rand() * 46,
  falls: rand() < 0.6 ? 1 : 2,
  turns: (rand() < 0.5 ? -1 : 1) * (rand() < 0.7 ? 1 : 2),
  phase: rand(),
  sway: 10 + rand() * 22,
  rot: rand() * 360,
}));

const fruit = FRUIT_SVG[season.buddy].replace(' width="21" height="21"', "");
const html = `<!doctype html><html><head><style>
@font-face { font-family: A; src: url("${FONT}") format("woff2"); font-weight: 200 800; }
html, body { margin: 0; }
body { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; font-family: A, sans-serif;
  background: radial-gradient(ellipse 70% 90% at 50% 38%, ${C.bg[0]} 0%, ${C.bg[1]} 100%);
  --bd-fruit: #e8743b; --bd-leaf: #2f6b4f; --bd-stem: #5b4632; --bd-face: #1b1f1d; }
.bd-fruit { fill: var(--bd-fruit); } .bd-shine { fill: #fff; opacity: .28; } .bd-stem { fill: var(--bd-stem); }
.bd-leaf { fill: var(--bd-leaf); } .bd-face { color: var(--bd-face); }
.f { position: absolute; top: 0; left: 0; opacity: .8; }
.f svg, .b svg { width: 100%; height: 100%; display: block; }
.shadow { position: absolute; left: ${W / 2 - 120}px; top: 384px; width: 240px; height: 30px; border-radius: 50%; background: ${C.main}; opacity: .2; }
.b { position: absolute; left: ${W / 2 - 150}px; top: 92px; width: 300px; height: 300px; transform-origin: 50% 94%; }
.t { position: absolute; left: 0; right: 0; text-align: center; color: ${C.ink}; paint-order: stroke; stroke: #fff; }
h1 { top: 416px; margin: 0; font-size: 100px; font-weight: 800; letter-spacing: -.02em; line-height: 1;
  -webkit-text-stroke: 14px ${C.bg[0]}; paint-order: stroke fill; }
h1 span { color: ${C.text}; }
p { top: 535px; margin: 0; font-size: 38px; font-weight: 700; color: ${C.text}; -webkit-text-stroke: 10px ${C.soft}; paint-order: stroke fill; }
</style></head><body>
${fallers.map((f, i) => `<div class="f" id="f${i}" style="width:${f.size}px;height:${f.size}px">${fruit}</div>`).join("")}
<div class="shadow" id="sh"></div>
<div class="b" id="b">${buddy("happy", 300)}</div>
<h1 class="t">${season.label.toUpperCase().replace(/S$/, "")} <span>SEASON</span></h1>
<p class="t">Where to buy ${season.starLabel} in Seattle this week</p>
</body></html>`;

// One hop: crouch, spring up, hang, land with a squash, settle. u runs 0 to 1.
const ease = (x) => 0.5 - Math.cos(Math.PI * x) / 2;
function hop(u) {
  if (u < 0.12) { const k = ease(u / 0.12); return { y: 0, sx: 1 + 0.08 * k, sy: 1 - 0.1 * k }; }
  if (u < 0.62) {
    const k = (u - 0.12) / 0.5; // up and back down, a parabola
    const y = -4 * k * (1 - k) * 70;
    const s = 1 - Math.abs(k - 0.5) * 2; // stretch while fast, round at the top
    return { y, sx: 1 - 0.06 * (1 - s), sy: 1 + 0.08 * (1 - s) };
  }
  if (u < 0.74) { const k = Math.sin(Math.PI * (u - 0.62) / 0.12); return { y: 0, sx: 1 + 0.1 * k, sy: 1 - 0.12 * k }; }
  return { y: 0, sx: 1, sy: 1 };
}

const dir = mkdtempSync(join(tmpdir(), "season-og-"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  for (let n = 0; n < FRAMES; n++) {
    const t = n / FRAMES; // 0 to 1 through the loop
    // Two hops per loop, leaning one way then the other. Frame 0 is the buddy at rest.
    const h = (t * 2) % 1;
    const lean = (Math.floor(t * 2) % 2 ? -1 : 1) * 5 * Math.sin(Math.PI * Math.min(h / 0.74, 1));
    const { y, sx, sy } = hop(h);
    const air = -y / 70;
    const fall = fallers.map((f) => {
      const p = (t * f.falls + f.phase) % 1;
      return {
        x: f.x - f.size / 2 + Math.sin(2 * Math.PI * (t * f.falls + f.phase)) * f.sway,
        y: -f.size - 20 + p * (H + f.size * 2 + 40),
        r: f.rot + 360 * f.turns * t,
      };
    });
    await page.evaluate(({ y, sx, sy, lean, air, fall }) => {
      document.getElementById("b").style.transform = `translateY(${y}px) rotate(${lean}deg) scale(${sx}, ${sy})`;
      const sh = document.getElementById("sh");
      sh.style.transform = `scale(${1 - 0.35 * air})`;
      sh.style.opacity = String(0.2 - 0.1 * air);
      fall.forEach((f, i) => { document.getElementById("f" + i).style.transform = `translate(${f.x}px, ${f.y}px) rotate(${f.r}deg)`; });
    }, { y, sx, sy, lean, air, fall });
    await page.screenshot({ path: join(dir, `f${String(n).padStart(3, "0")}.png`) });
  }
} finally {
  await browser.close();
}

// One palette for the whole loop, light dithering so the background gradient stays smooth.
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%03d.png"),
  "-filter_complex", "[0:v]split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
  "-loop", "0", OUT]);
rmSync(dir, { recursive: true, force: true });
console.log(`Wrote ${OUT} (${Math.round(statSync(OUT).size / 1024)} KB, ${FRAMES} frames)`);
