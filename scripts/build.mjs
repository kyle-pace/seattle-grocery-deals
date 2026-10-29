// Builds the static site into dist/. Usage: node scripts/build.mjs
// Set BASE_PATH=/ to build for a local server at the root.
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildSync } from "esbuild";
import {
  ROOT, loadConfig, loadWeeks, esc, fmtDate, fmtPeriod, money, priceText, unitPriceText, packText,
  unitPriceIsExtra, analyze, priorListings, peerPrices, convertPer, isVegetarian, flyerKind,
} from "./lib.mjs";

const cfg = loadConfig();
const BASE = process.env.BASE_PATH ?? cfg.site.base_path;
// Amplitude (analytics and Session Replay) is bundled from client/analytics.js at build time.
const AMPLITUDE_KEY = cfg.site.amplitude_api_key ?? "";
let ANALYTICS_SRC = "";
const DIST = join(ROOT, "dist");
const weeks = loadWeeks().map((w) => w.data); // oldest first
if (!weeks.length) throw new Error("No week files in data/weeks");
const latest = weeks[weeks.length - 1];
const H = cfg.criteria.home;
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

const CATEGORY_LABELS = {
  produce: "Produce", meat: "Meat", seafood: "Seafood", "dairy-eggs": "Dairy and eggs", pantry: "Pantry",
  frozen: "Frozen", bakery: "Bakery", prepared: "Deli and prepared", "snacks-drinks": "Snacks and drinks", other: "Other",
};
const STATUS_LABELS = { full: "Read in full", partial: "Partly read", stale: "Stale", unreadable: "Unreadable" };
const FORMAT_LABELS = { "web-page": "Web page", images: "Flyer images", pdf: "PDF", "catalogue-viewer": "Catalogue viewer" };
const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const TIER_LABELS = { standout: "Standout", good: "Good deal", sale: "On sale" };
const PER_LABEL = { lb: "/lb", each: " each", dozen: "/dozen", l: "/L", gal: "/gal" };
const CATS = cfg.criteria.categories;
// How many standouts the home page shows before "See all".
const HOME_BEST = 10;
// At most this many top picks from any one store.
const PICKS_PER_STORE = 2;

const url = (p = "") => BASE + p;
// Versioned asset links, so each deploy busts browser caches.
const asset = (p) => `${url(p)}?v=${createHash("sha1").update(readFileSync(join(ROOT, "site", p))).digest("hex").slice(0, 8)}`;
const LOGO = readFileSync(join(ROOT, "site", "assets", "logo.svg"), "utf8").trim().replace("<svg ", '<svg aria-hidden="true" width="28" height="28" ');
const storeName = (id) => cfg.storeById[id]?.name ?? id;
const keyLabel = (k) => cfg.items[k]?.label ?? k;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const ext = `<span aria-hidden="true">&#8599;</span><span class="sr-only"> (opens the store's site)</span>`;

// ---------- KitchenUI pieces: icons, badges and the persimmon buddy ----------
// Matches the Deals app's shared kit (KitchenUI): same tones, shapes and words.

const ICON_PATHS = {
  star: `<path d="M8 1.6l1.7 4.65 4.96.19-3.9 3.06 1.35 4.76L8 11.5l-4.11 2.76 1.35-4.76-3.9-3.06 4.96-.19z" fill="currentColor" stroke="none"/>`,
  halfStar: `<path d="M8 1.6l1.7 4.65 4.96.19-3.9 3.06 1.35 4.76L8 11.5l-4.11 2.76 1.35-4.76-3.9-3.06 4.96-.19z" stroke-width="1.3"/><path d="M8 1.6v9.9l-4.11 2.76 1.35-4.76-3.9-3.06 4.96-.19z" fill="currentColor" stroke="none"/>`,
  flag: `<path d="M3.5 14.5V2.4M3.5 2.9c1.9-1 3.4-1 5.1 0s3.2 1 4.9 0v6.3c-1.7 1-3.2 1-4.9 0s-3.2-1-5.1 0"/>`,
  leaf: `<path d="M3 13.2C3 7.3 6.8 3 13.2 2.8c0 6.3-4.2 10.2-10.2 10.4zM3 13.2l5.6-5.6"/>`,
  storefront: `<path d="M2.6 6.2l.9-3.7h9l.9 3.7M2.6 6.2h10.8v7.3H2.6zM6.2 13.5V9.6h3.6v3.9"/>`,
  chevron: `<path d="M6 3.2L10.8 8 6 12.8"/>`,
  down: `<circle cx="8" cy="8" r="6.3"/><path d="M8 4.6v6.6M5.3 8.6L8 11.3l2.7-2.7"/>`,
  truck: `<path d="M1.5 3.8h8v7.4h-8zM9.5 6.3h2.9l2.1 2.6v2.3h-5"/><circle cx="4.4" cy="12" r="1.4" fill="var(--icon-hole, currentColor)"/><circle cx="11.8" cy="12" r="1.4" fill="var(--icon-hole, currentColor)"/>`,
  search: `<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4l4 4"/>`,
  close: `<path d="M4 4l8 8M12 4l-8 8"/>`,
  ad: `<path d="M3 1.8h7.2l2.8 2.8v9.6H3zM10 1.8v3h3M5.5 7.5h5M5.5 10h5"/>`,
};
const ic = (name) => `<svg class="ic ic-${name}" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
// A shape and a word for a state, never color alone. Tones: good, warn, bad, neutral, info.
const badge = (tone, icon, text) => `<span class="badge tone-${tone}">${icon ? ic(icon) : ""}${esc(text)}</span>`;
const tierBadge = (tier) => tier === "standout" ? badge("warn", "star", "Standout") : tier === "good" ? badge("neutral", "halfStar", "Good deal") : "";

// The persimmon buddy from the app (KitchenUI Buddy.swift), drawn as inline SVG on a 100 by 100
// grid with the same proportions. Moods: neutral, happy, thinking, sleepy, sad, surprised.
// Decorative only. Colors come from CSS so it follows light and dark.
const r2 = (n) => Math.round(n * 100) / 100;
function buddy(mood = "neutral", size = 64, cls = "") {
  const w = 7.5, sw = 3;
  const [ew, eh] = { happy: [w * 1.5, w], sleepy: [w * 1.3, 2.2], sad: [w * 0.9, w * 1.15], surprised: [w * 1.3, w * 1.3] }[mood] ?? [w, w * 1.35];
  const [mw, mh] = { happy: [18, 7], thinking: [8, 2], sleepy: [5, 4], sad: [12, 4], surprised: [6, 7] }[mood] ?? [12, 4];
  // Eyes over mouth, 5 apart, the pair centered 12 below the middle.
  const top = 62 - (eh + 5 + mh) / 2;
  const ey = top + (mood === "thinking" ? -3 : mood === "sad" ? 1 : 0);
  const eye = (cx) => {
    const x = cx - ew / 2;
    if (mood === "happy") return `<path d="M${r2(x)} ${r2(ey + eh)}Q${r2(cx)} ${r2(ey - eh * 0.6)} ${r2(x + ew)} ${r2(ey + eh)}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (mood === "surprised") return `<circle cx="${r2(cx)}" cy="${r2(ey + eh / 2)}" r="${r2(ew / 2)}"/>`;
    return `<rect x="${r2(x)}" y="${r2(ey)}" width="${r2(ew)}" height="${r2(eh)}" rx="${r2(Math.min(ew, eh) / 2)}"/>`;
  };
  const my = top + eh + 5;
  const mx = 50 - mw / 2 + (mood === "thinking" ? 4 : 0);
  const curve = { happy: 1, neutral: 0.5, thinking: 0, sad: -0.8 }[mood];
  let mouth;
  if (curve != null) {
    const y = curve >= 0 ? my : my + mh;
    mouth = `<path d="M${r2(mx)} ${r2(y)}Q${r2(mx + mw / 2)} ${r2(y + mh * 2 * curve)} ${r2(mx + mw)} ${r2(y)}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round"/>`;
  } else if (mood === "sleepy") {
    mouth = `<ellipse cx="50" cy="${r2(my + mh / 2)}" rx="2.5" ry="2"/>`;
  } else {
    mouth = `<ellipse cx="50" cy="${r2(my + mh / 2)}" rx="3" ry="3.5" fill="none" stroke="currentColor" stroke-width="${sw}"/>`;
  }
  const blink = ["neutral", "thinking", "surprised"].includes(mood) ? " bd-blink" : "";
  const off = 8 + ew / 2;
  return `<svg class="buddy buddy-${mood}${cls ? " " + cls : ""}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    // Fruit: a soft rounded square with a shine at the upper left.
    + `<rect class="bd-fruit" x="7" y="25" width="86" height="70" rx="34"/><ellipse class="bd-shine" cx="28" cy="40" rx="8" ry="5" transform="rotate(-30 28 40)"/>`
    // Stem, then the calyx: four leaves in an X, squashed flat like a square cap.
    + `<rect class="bd-stem" x="47.75" y="17.5" width="4.5" height="9" rx="2.25"/>`
    + `<g class="bd-leaf" transform="translate(50 27) scale(1.25 .42)">${[45, 135, 225, 315].map((a) => `<ellipse cx="9" rx="10.5" ry="5.5" transform="rotate(${a})"/>`).join("")}</g>`
    + `<g class="bd-face" fill="currentColor"><g class="bd-eyes${blink}">${eye(50 - off)}${eye(50 + off)}</g>${mouth}</g></svg>`;
}

// A friendly empty screen: the buddy, a headline, a line, and at most one way forward.
const emptyState = ({ mood = "sad", title, msg = "", link = null, attrs = "" }) => `<div class="empty-state"${attrs ? " " + attrs : ""}>${buddy(mood, 88)}<p class="empty-title">${esc(title)}</p>${msg ? `<p class="empty-msg"${attrs.includes("data-empty") ? " data-empty-msg" : ""}>${esc(msg)}</p>` : ""}${link ? `<p><a class="go" href="${link[0]}">${esc(link[1])}</a></p>` : ""}</div>`;

// "Oct 23 to 29", or "Oct 30 to Nov 5" across months.
function rangeText(from, to) {
  if (!from || !to) return from ? fmtDate(from, { weekday: false }) : "";
  return from.slice(0, 7) === to.slice(0, 7) ? `${fmtDate(from, { weekday: false })} to ${Number(to.slice(8))}` : `${fmtDate(from, { weekday: false })} to ${fmtDate(to, { weekday: false })}`;
}

// ---------- analysis ----------

function analyzeWeek(week) {
  const prior = priorListings(weeks, week.week);
  const peers = peerPrices(week.items);
  const flyerThrough = Object.fromEntries(week.flyers.map((f) => [f.store, f.valid_through]));
  return week.items
    .map((i) => ({ ...i, valid_through: i.valid_through ?? flyerThrough[i.store] ?? null, a: analyze(i, { cfg, prior, peers }) }))
    .sort((x, y) => y.a.score - x.a.score || x.item.localeCompare(y.item));
}
const analyzed = new Map(weeks.map((w) => [w.week, analyzeWeek(w)]));

// The end date most of a week's flyers share, for "Oct 23 to Oct 29".
function weekEnd(week) {
  const n = {};
  for (const f of week.flyers) if (f.valid_through) n[f.valid_through] = (n[f.valid_through] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

// The date most of this edition's sales end, and each store's flyer end. Rows only say
// "through" when a deal ends on a different day.
const EDITION_END = weekEnd(latest);

// ---------- deal rows ----------

// Price split into parts so the number can be large and the unit small.
function priceParts(i) {
  const q = i.quantity;
  const m = money(i.price);
  const cents = !m.startsWith("$");
  let lead = "", unit = "", spokenUnit = "";
  if (q > 1) lead = i.unit === "lb" ? `${q} lb for` : `${q} for`;
  else if (i.unit === "lb") { unit = "/lb"; spokenUnit = " per pound"; }
  else if (i.unit === "each") { unit = " ea"; spokenUnit = " each"; }
  const detail = [];
  if (i.pack) detail.push(q > 1 ? `${packText(i.pack)} each` : packText(i.pack));
  if (unitPriceIsExtra(i)) detail.push(unitPriceText(i.unit_price));
  return { lead, cur: cents ? "" : "$", num: cents ? m : m.slice(1), unit, spoken: `${lead ? lead + " " : ""}${m}${spokenUnit}`, detail };
}

// One savings pill under the price, as in the app: the US average where there is one (BLS,
// staples only), otherwise the store's own percent off. The regular price stays off rows.
function savings(i) {
  const under = i.a.us && i.a.us.ratio < 1 ? Math.round((1 - i.a.us.ratio) * 100) : 0;
  if (under > 0) return { html: `<span class="pill tone-info">${ic("flag")}${under}% under US avg</span>`, spoken: `${under}% under the US average` };
  if (i.percent_off != null) return { html: `<span class="pill tone-good">${i.percent_off}% off</span>`, spoken: `${i.percent_off}% off` };
  return null;
}

function amount(i, { pill = true } = {}) {
  const p = priceParts(i);
  const sv = pill ? savings(i) : null;
  return `<div class="amt"><p class="sr-only">${esc(p.spoken)}${sv ? `, ${esc(sv.spoken)}` : ""}</p><p class="amt-price" aria-hidden="true">${p.lead ? `<span class="amt-lead">${esc(p.lead)}</span>` : ""}${p.cur ? `<span class="amt-cur">$</span>` : ""}<span class="amt-num">${esc(p.num)}</span>${p.unit ? `<span class="amt-unit">${esc(p.unit)}</span>` : ""}</p>${sv ? `<p class="amt-pill" aria-hidden="true">${sv.html}</p>` : ""}</div>`;
}

function rowAttrs(i, rank) {
  const unit = i.unit_price ? convertPer(i.unit_price.value, i.unit_price.per, i.unit_price.per) : i.price;
  return `data-store="${esc(i.store)}" data-category="${esc(i.category)}" data-tier="${i.a.tier}" data-veg="${isVegetarian(i) ? 1 : 0}" data-rank="${rank}" data-price="${i.price}" data-off="${i.percent_off ?? 0}" data-name="${esc(i.item.toLowerCase())}" data-text="${esc(`${i.item} ${storeName(i.store)}`.toLowerCase())}" data-unit="${unit}"`;
}

// One deal, laid out like the app's DealRow: tier badge, name, store and details, why it's a
// deal, and the price with one savings pill. why: show the reason. store: name the store.
// ends: say "through" when the deal ends on a day other than endRef.
function dealRow(i, rank, { why = false, store = true, ends = true, endRef = EDITION_END } = {}) {
  const p = priceParts(i);
  const low = why && i.a.tags.some((t) => t.kind === "low");
  const badges = tierBadge(i.a.tier) + (low ? badge("good", "down", "Lowest we've listed") : "");
  const meta = [
    store ? `<a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a>` : "",
    ...p.detail.map(esc),
    i.member_price ? "member price" : "",
    ends && i.valid_through && i.valid_through !== endRef ? `through ${esc(fmtDate(i.valid_through))}` : "",
  ].filter(Boolean).join(" &middot; ");
  // The pill and badges already say "% off", "under US avg" and "lowest", so the reason skips them.
  const reason = why ? (i.highlight?.reason ?? i.a.tags.filter((t) => !["pct", "us", "low", "member"].includes(t.kind)).map((t) => t.text).join(". ")) : "";
  return `<li class="deal" ${rowAttrs(i, rank)}>
  <div class="deal-main">${badges ? `<p class="deal-badges">${badges}</p>` : ""}<p class="deal-name">${esc(i.item)}</p>${meta ? `<p class="deal-meta">${meta}</p>` : ""}${reason ? `<p class="deal-why">${esc(reason)}</p>` : ""}${i.notes ? `<p class="deal-note">${esc(i.notes)}</p>` : ""}</div>
  ${amount(i)}
</li>`;
}

// Deals grouped by department, each group a section that hides when filters empty it.
function grouped(items, opts = {}) {
  return CATS.filter((c) => items.some((i) => i.category === c)).map((c) => {
    const list = items.filter((i) => i.category === c);
    return `<section class="group" data-group aria-labelledby="g-${c}">
  <h2 class="sec-label group-h" id="g-${c}"><span>${esc(CATEGORY_LABELS[c])}</span> <span class="sec-note" data-group-count>${list.length}</span></h2>
  <ul class="deals" data-sortable>${list.map((i) => dealRow(i, items.indexOf(i), opts)).join("\n")}</ul>
</section>`;
  }).join("\n");
}

// Search, then a sticky row of chips: Vegetarian (KitchenUI FilterChip), store and sort.
// Rows below with [data-filterable] respond.
function controls({ search = true, store = true, sort = false, stores = [], searchLabel = "Search these deals" } = {}) {
  return `${search ? `<div class="wrap find-wrap"><div class="find">${ic("search")}<label class="sr-only" for="f-q">${esc(searchLabel)}</label><input id="f-q" type="search" data-search placeholder="tofu, persimmon, 99 Ranch" autocomplete="off"></div></div>` : ""}
<div class="bar" data-filters><div class="wrap chiprow" role="group" aria-label="Filters">
  <button type="button" class="fchip" aria-pressed="false" data-veg-toggle>${ic("leaf")}<span>Vegetarian</span></button>
  ${store && stores.length ? `<label class="sr-only" for="f-store">Store</label><select class="fchip fchip-select" id="f-store" data-filter="store"><option value="">All stores</option>${stores.map((s) => `<option value="${esc(s)}">${esc(storeName(s))}</option>`).join("")}</select>` : ""}
  ${sort ? `<label class="sr-only" for="f-sort">Sort</label><select class="fchip fchip-select" id="f-sort" data-sort><option value="rank">Best deals first</option><option value="off">Biggest % off</option><option value="price">Lowest price</option><option value="name">A to Z</option></select>` : ""}
</div></div>`;
}

const countLine = () => `<p class="count" data-count role="status"></p>`;
// Shown when search or filters leave nothing. app.js swaps in the search words.
const emptyLine = (text) => emptyState({ mood: "surprised", title: "Not on sale this week", msg: text, attrs: `data-empty data-fallback="${esc(text)}" hidden` });
// Text that changes with the vegetarian switch: both versions are in the page, CSS shows one.
const vegText = (all, veg) => all === veg ? all : `<span data-when-all>${all}</span><span data-when-veg>${veg}</span>`;

function flyerLinks(f, store) {
  if (f.links.length) return f.links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join(" ");
  if (store.flyer_url) return `<a href="${esc(store.flyer_url)}" rel="noopener">Store flyer page</a>`;
  return `<span class="muted">No link recorded</span>`;
}

function datesText(f) {
  if (!f.valid_from && !f.valid_through) return `<span class="muted">Dates not recorded</span>`;
  return `${f.valid_from ? esc(fmtDate(f.valid_from)) : "?"} to ${f.valid_through ? esc(fmtDate(f.valid_through)) : "?"}`;
}

function flyerList(week) {
  const byStore = Object.fromEntries(week.flyers.map((f) => [f.store, f]));
  const rows = cfg.stores
    .filter((s) => s.active && !s.no_online_flyer && s.tracked_since <= week.week)
    .map((s) => {
      const f = byStore[s.id];
      if (!f) {
        return `<li class="flyer status-none">
  <div><a class="store" href="${url(`stores/${s.id}/`)}">${esc(s.name)}</a> <span class="status">Not checked</span></div>
  <div class="links">${s.flyer_url ? `<a href="${esc(s.flyer_url)}" rel="noopener">Store flyer page</a>` : `<span class="muted">No link</span>`}</div>
</li>`;
      }
      return `<li class="flyer status-${f.status}">
  <div><a class="store" href="${url(`stores/${s.id}/`)}">${esc(s.name)}</a> <span class="status">${STATUS_LABELS[f.status]}</span></div>
  <div class="dates">${datesText(f)}</div>
  <div class="links">${flyerLinks(f, s)}</div>
  ${f.note ? `<div class="note">${esc(f.note)}</div>` : ""}
</li>`;
    });
  return `<ul class="flyers">${rows.join("\n")}</ul>`;
}

const chips = (s) => s.delivery ? `<span class="chips">${badge("neutral", "truck", "Delivers")}</span>` : "";

// A store tile: name, counts and its top deal, linking to the store page.
function storeTile(s, items, { about = false } = {}) {
  const f = latest.flyers.find((x) => x.store === s.id);
  const mine = items.filter((i) => i.store === s.id);
  const veg = mine.filter(isVegetarian);
  const st = (l) => l.filter((i) => i.a.tier === "standout").length;
  const counts = dealCounts;
  const top = (l) => l[0] ? `Top: <b>${esc(l[0].item)}</b> ${esc(priceText(l[0]))}` : "";
  const status = s.no_online_flyer ? "No online flyer" : !f ? "Not checked this week" : f.status === "unreadable" ? "Flyer couldn't be read this week" : f.status === "stale" ? "Flyer not updated this week" : f.valid_through ? `Sale through ${fmtDate(f.valid_through)}` : "";
  return `<li${s.delivery ? " data-delivers" : ""}><a class="tile" href="${url(`stores/${s.id}/`)}">
  <span class="tile-t">${esc(s.name)}${ic("chevron")}</span>${chips(s)}
  ${about ? `<span class="tile-about">${esc(s.about)}</span>` : ""}
  ${mine.length ? `<span class="tile-n">${vegText(counts(mine), counts(veg))}</span>` : ""}
  ${status ? `<span class="tile-n">${esc(status)}</span>` : ""}
  ${mine.length ? `<span class="tile-top">${vegText(top(mine), top(veg) || "No vegetarian deals")}</span>` : ""}
</a></li>`;
}

function deptTile(c, items, base = "departments/") {
  const l = items.filter((i) => i.category === c);
  const veg = l.filter(isVegetarian);
  const st = (x) => x.filter((i) => i.a.tier === "standout").length;
  const counts = dealCounts;
  const top = (x) => x[0] ? `Top: <b>${esc(x[0].item)}</b> ${esc(priceText(x[0]))} at ${esc(storeName(x[0].store))}` : "No vegetarian deals";
  return `<li${veg.length ? "" : " data-meat-only"}><a class="tile" href="${url(`${base}${c}/`)}">
  <span class="tile-t">${esc(CATEGORY_LABELS[c])}${ic("chevron")}</span>
  <span class="tile-n">${vegText(counts(l), counts(veg))}</span>
  <span class="tile-top">${vegText(top(l), top(veg))}</span>
</a></li>`;
}

// ---------- page frame ----------

const ICONS = {
  "": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>`,
  "departments/": `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  "stores/": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6"/></svg>`,
  "compare/": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3"/></svg>`,
};
const MAIN_NAV = [["", "This week"], ["departments/", "Departments"], ["stores/", "Stores"], ["compare/", "Compare"]];

// section: which menu item this page belongs to ("" is This week).
function page({ title, path, section = path, body, wrap = true, description, map = false, extraScript = null, bodyClass = "", pageId = "", image = null, imageAlt = "", ogTitle = null }) {
  const full = title ? `${title} | ${cfg.site.title}` : cfg.site.title;
  const cur = (p) => (p === section ? ' aria-current="page"' : "");
  const top = [...MAIN_NAV, ["about/", "About"]].map(([p, label]) => `<a href="${url(p)}"${cur(p)}>${label}</a>`).join("")
    + (PERSIMMON_SEASON ? `<a class="nav-persim" href="${url("persimmons/")}" aria-label="Persimmons" title="Persimmons"${cur("persimmons/")}>${PERSIMMON_SVG}</a>` : "");
  const tabs = MAIN_NAV.map(([p, label]) => `<a href="${url(p)}"${cur(p)}>${ICONS[p]}<span>${label}</span></a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description ?? cfg.site.tagline)}">
<meta property="og:site_name" content="${esc(cfg.site.title)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(ogTitle || title || cfg.site.title)}">
<meta property="og:description" content="${esc(description ?? cfg.site.tagline)}">
<meta property="og:url" content="${esc(cfg.site.origin + cfg.site.base_path + path)}">${image ? `
<meta property="og:image" content="${esc(cfg.site.origin + cfg.site.base_path + image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(cfg.site.origin + cfg.site.base_path + image)}">` : `
<meta name="twitter:card" content="summary">`}
<meta name="theme-color" content="#f4f4f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121413" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${url("assets/logo.svg")}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${url("assets/apple-touch-icon.png")}">
<link rel="preload" href="${url("assets/fonts/atkinson-hyperlegible-next.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset("assets/style.css")}">
<script>try{if(JSON.parse(localStorage.getItem("sgd.vegOnly")))document.documentElement.classList.add("veg-on")}catch(e){}</script>
<script src="${asset("assets/app.js")}" defer></script>
<script type="module" src="${ANALYTICS_SRC}"></script>${extraScript ? `
<script src="${asset(extraScript)}" defer></script>` : ""}${map ? `
<link rel="stylesheet" href="${asset("assets/leaflet/leaflet.css")}">
<script src="${asset("assets/leaflet/leaflet.js")}" defer></script>
<script src="${asset("assets/map.js")}" defer></script>` : ""}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}${pageId ? ` data-page="${pageId}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="wrap head-in">
    <a class="brand" href="${url()}">${LOGO}<span>${esc(cfg.site.title)}</span></a>
    <nav class="topnav" aria-label="Main">${top}</nav>
    <a class="head-about" href="${url("about/")}"${cur("about/")}>About</a>
  </div>
</header>
<main id="main" tabindex="-1">
${wrap ? `<div class="wrap">\n${body}\n</div>` : body}
</main>
<footer class="site-foot"><div class="wrap">
  <nav aria-label="More"><a href="${url("weeks/")}">Past weeks</a><a href="${url("about/")}">About and privacy</a>${PERSIMMON_SEASON ? `<a href="${url("persimmons/")}">Persimmons</a>` : ""}<a href="${esc(cfg.site.repo_url)}">Source</a></nav>
  <p>Prices come from each store's own flyer and can change. Check in store. Not affiliated with any store.</p>
</div></footer>
<nav class="tabbar" aria-label="Main">${tabs}</nav>
</body>
</html>
`;
}

function write(path, html) {
  const dir = join(DIST, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

const crumbs = (...links) => `<p class="crumbs">${links.map(([p, t]) => `<a href="${url(p)}">${esc(t)}</a>`).join(" / ")}</p>`;
const pageHead = (title, sub, extra = "") => `<div class="page-h"><h1>${title}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ""}${extra}</div>`;
// "3 standouts, 18 deals", as on the app's store cards.
const dealCounts = (l) => { const st = l.filter((i) => i.a.tier === "standout").length; return st ? `${plural(st, "standout")}, ${plural(l.length, "deal")}` : plural(l.length, "deal"); };
const storesIn = (items) => [...new Set(items.map((i) => i.store))].sort((a, b) => storeName(a).localeCompare(storeName(b)));

// ---------- home ----------

// Top picks, as in the app: standouts, best first, at most PICKS_PER_STORE from one store.
function topPicks(list) {
  const taken = {};
  return list.filter((i) => (taken[i.store] = (taken[i.store] ?? 0) + 1) <= PICKS_PER_STORE).slice(0, HOME_BEST);
}

// One store on This week as a card: a header row into the store, its best few deals that
// aren't already top picks, and a way to see the rest. Rows carry data-hl like the picks.
function storeCard(s, items, hlAll, hlVeg) {
  const mine = items.filter((i) => i.store === s.id);
  const veg = mine.filter(isVegetarian);
  const bestA = mine.filter((i) => !hlAll.includes(i)).slice(0, 3);
  const bestV = veg.filter((i) => !hlVeg.includes(i)).slice(0, 3);
  const rows = mine.filter((i) => bestA.includes(i) || bestV.includes(i))
    .map((i) => dealRow(i, items.indexOf(i), { store: false, endRef: latest.flyers.find((f) => f.store === s.id)?.valid_through ?? EDITION_END }).replace('<li class="deal" ', `<li class="deal" data-hl="${(bestA.includes(i) ? "a" : "") + (bestV.includes(i) ? "v" : "")}" `));
  return `<li class="card store-card" data-store-card="${esc(s.id)}"${veg.length ? "" : " data-meat-only"}>
  <h3 class="store-card-h"><a href="${url(`stores/${s.id}/`)}">${ic("storefront")}<span class="store-card-t"><span class="store-card-name">${esc(s.name)}</span><span class="store-card-n">${vegText(dealCounts(mine), dealCounts(veg))}</span></span>${ic("chevron")}</a></h3>
  <ul class="deals">${rows.join("\n")}</ul>
  <a class="see-all" href="${url(`stores/${s.id}/#deals`)}">${vegText(`See all ${mine.length} at ${esc(s.name)}`, `See all ${plural(veg.length, "vegetarian deal")} at ${esc(s.name)}`)}</a>
</li>`;
}

function homePage() {
  const items = analyzed.get(latest.week);
  const end = EDITION_END;
  const veg = items.filter(isVegetarian);
  const standouts = items.filter((i) => i.a.tier === "standout");
  const vegStandouts = standouts.filter(isVegetarian);
  // The picks for everyone, plus the vegetarian picks, so the section stays full when
  // "Vegetarian" is on. data-hl says which list a row belongs to.
  const hlAll = topPicks(standouts);
  const hlVeg = topPicks(vegStandouts);
  const best = standouts.filter((i) => hlAll.includes(i) || hlVeg.includes(i));
  const read = latest.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
  const persim = PERSIMMON_SEASON ? items.filter((i) => isPersimmon(i) && isFuyu(i) && i.unit_price).sort(byPerLb) : [];
  const persimStores = new Set(items.filter(isPersimmon).map((i) => i.store)).size;
  const soonPool = items.filter((i) => i.valid_through).slice(0, 60);
  const shops = [...new Set(items.map((i) => i.store))]
    .map((id) => ({ s: cfg.storeById[id], n: items.filter((i) => i.store === id && i.a.tier === "standout").length, c: items.filter((i) => i.store === id).length }))
    .sort((a, b) => b.n - a.n || b.c - a.c).map((x) => x.s);
  const edition = fmtDate(latest.week, { weekday: false });

  const body = `<div class="wrap page-h page-h-home">
  <h1>This week</h1>
  <p class="page-sub">${esc(rangeText(latest.week, end))} &middot; ${vegText(plural(items.length, "deal"), plural(veg.length, "vegetarian deal"))}${end ? `<span data-ends-line data-end="${end}" hidden> &middot; <span data-ends-text></span></span>` : ""}</p>
</div>
${controls({ stores: storesIn(items), searchLabel: "Search this week's deals and stores" })}
<div class="wrap" data-filterable>
<div data-home>
<div class="edition" data-edition data-week="${latest.week}"${end ? ` data-end="${end}"` : ""}>
  <div class="card edition-card edition-fresh" data-edition-fresh hidden>
    ${buddy("happy", 64, "bd-hop")}
    <div class="edition-text"><h2 class="edition-t">Fresh off the press</h2><p class="edition-d">The ${esc(edition)} edition: ${vegText(plural(items.length, "deal"), plural(veg.length, "vegetarian deal"))} from ${plural(read, "store")}.</p></div>
    <button type="button" class="icon-btn" data-edition-dismiss aria-label="Got it, hide this note">${ic("close")}</button>
  </div>
  <div class="card edition-card edition-note" data-edition-next hidden>
    ${buddy("neutral", 48)}
    <div class="edition-text"><h2 class="edition-t">Next edition lands Friday</h2><p class="edition-d">Fresh flyers usually post by mid-morning.</p></div>
  </div>
  <div class="card edition-card edition-note" data-edition-ended hidden>
    ${buddy("sleepy", 48)}
    <div class="edition-text"><h2 class="edition-t">New flyers are on their way</h2><p class="edition-d">This week's sales have ended. The next edition posts Friday.</p></div>
  </div>
</div>
<section class="block" aria-labelledby="h-best">
  <div class="sec-h"><h2 id="h-best">Top picks</h2><p>${vegText(`${standouts.length} standouts in all`, `${vegStandouts.length} vegetarian standouts`)}</p></div>
  <ul class="deals deals-2">${best.map((i) => dealRow(i, items.indexOf(i), { why: true }).replace('<li class="deal" ', `<li class="deal" data-hl="${(hlAll.includes(i) ? "a" : "") + (hlVeg.includes(i) ? "v" : "")}" `)).join("\n")}</ul>
  <a class="go" href="${url("standouts/")}">See all ${vegText(`${standouts.length} standouts`, `${vegStandouts.length} vegetarian standouts`)}</a>
</section>
${soonPool.length ? `<section class="block ending" data-ending hidden aria-labelledby="h-end">
  <div class="sec-h"><h2 id="h-end">Ending soon</h2><p>Last chance</p></div>
  <ul class="mini">${soonPool.map((i) => `<li data-ends="${i.valid_through}" data-veg="${isVegetarian(i) ? 1 : 0}" data-store="${esc(i.store)}" hidden><span>${esc(i.item)} <a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a></span> <span class="mini-price">${esc(priceText(i))} <span class="badge tone-warn ends-when" data-ends-label></span></span></li>`).join("")}</ul>
</section>` : ""}
${persim.length ? `<section class="card story" aria-labelledby="h-story">
  ${buddy("happy", 72)}
  <div>
  <p class="kicker">In season</p>
  <h2 id="h-story">Persimmon season</h2>
  <p>Fuyu persimmons are at their best now, and ${plural(persimStores, "store")} ${persimStores === 1 ? "has" : "have"} them on sale. The cheapest is ${esc(storeName(persim[0].store))} at ${esc(priceText(persim[0]))}. Eat them crisp like an apple, skin and all.</p>
  <p><a class="go" href="${url("persimmons/")}">Where to buy persimmons this week</a></p>
  </div>
</section>` : ""}
<section class="block" aria-labelledby="h-where">
  <div class="sec-h"><h2 id="h-where">By store</h2><p>Each store's best</p></div>
  <ul class="store-cards">${shops.map((s) => storeCard(s, items, hlAll, hlVeg)).join("\n")}</ul>
  <a class="go" href="${url("stores/")}">All stores, flyers and the map</a>
</section>
<section class="block" aria-labelledby="h-dep">
  <div class="sec-h"><h2 id="h-dep">Shop by department</h2></div>
  <ul class="tiles">${CATS.filter((c) => items.some((i) => i.category === c)).map((c) => deptTile(c, items)).join("\n")}</ul>
</section>
</div>
<div data-results hidden>
  ${countLine()}
  ${grouped(items)}
  ${emptyLine("Try a shorter word or a store name.")}
</div>
</div>`;
  write("", page({ title: "", path: "", body, wrap: false, pageId: "home" }));
}

// ---------- list pages ----------

function listPage({ path, section, title, h1, sub, items, crumbsHtml = "", group = true, why = true, empty }) {
  const body = `<div class="wrap">${crumbsHtml}${pageHead(h1, sub)}</div>
${controls({ stores: storesIn(items), sort: true })}
<div class="wrap list" data-filterable>
${countLine()}
${group ? grouped(items, { why }) : `<ul class="deals" data-sortable>${items.map((i, n) => dealRow(i, n, { why })).join("\n")}</ul>`}
${emptyLine(empty)}
</div>`;
  write(path, page({ title, path, section, body, wrap: false }));
}

function departmentPages() {
  const items = analyzed.get(latest.week);
  const cats = CATS.filter((c) => items.some((i) => i.category === c));
  write("departments/", page({
    title: "Departments", path: "departments/", body: `${pageHead("Departments", `Every deal for the week of ${esc(fmtDate(latest.week, { weekday: false }))}, by section of the store.`)}
<ul class="tiles">${cats.map((c) => deptTile(c, items)).join("\n")}</ul>`,
  }));
  for (const c of cats) {
    const list = items.filter((i) => i.category === c);
    const veg = list.filter(isVegetarian).length;
    listPage({
      path: `departments/${c}/`, section: "departments/", title: CATEGORY_LABELS[c], h1: esc(CATEGORY_LABELS[c]), items: list, group: false,
      crumbsHtml: crumbs(["departments/", "Departments"]),
      sub: `${vegText(plural(list.length, "deal"), plural(veg, "vegetarian deal"))} this week, best first. Prices through each store's sale end date.`,
      empty: veg ? "Nothing matches these filters." : "No vegetarian deals here this week. Turn off Vegetarian to see them all.",
    });
  }
}

function standoutsPage() {
  const items = analyzed.get(latest.week).filter((i) => i.a.tier === "standout");
  listPage({
    path: "standouts/", section: "", title: "All standouts", h1: "All standouts", items,
    crumbsHtml: crumbs(["", "This week"]),
    sub: "Big drops from the regular price, prices well under the US average, the lowest we've listed, or hand-picked. <a href=\"" + url("about/#how") + "\">How deals are chosen</a>",
    empty: "No standouts match these filters.",
  });
}

function comparePage() {
  const items = analyzed.get(latest.week);
  const byKey = new Map();
  for (const i of items) {
    if (!i.item_key || !i.unit_price) continue;
    (byKey.get(i.item_key) ?? byKey.set(i.item_key, []).get(i.item_key)).push(i);
  }
  const groups = [...byKey.entries()]
    .map(([k, list]) => {
      const per = list[0].unit_price.per;
      const rows = list
        .map((i) => ({ i, v: convertPer(i.unit_price.value, i.unit_price.per, per) }))
        .filter((r) => r.v != null)
        .sort((a, b) => a.v - b.v);
      return { k, per, rows, stores: new Set(rows.map((r) => r.i.store)).size };
    })
    .filter((g) => g.stores >= 2)
    .sort((a, b) => b.stores - a.stores || keyLabel(a.k).localeCompare(keyLabel(b.k)));
  const body = `${pageHead("Compare stores", "The same item on sale at more than one store this week, cheapest first by price per unit.")}
${groups.length ? `<nav class="jump" aria-label="Items">${groups.map((g) => `<a href="#${esc(g.k)}">${esc(keyLabel(g.k))}</a>`).join("")}</nav>
${groups.map((g) => `<section class="block cmp" id="${esc(g.k)}" aria-labelledby="c-${esc(g.k)}">
  <div class="sec-h"><h2 id="c-${esc(g.k)}">${esc(keyLabel(g.k))}</h2><p>${g.stores} stores, from ${esc(money(g.rows[0].v))}${PER_LABEL[g.per]}</p></div>
  <div class="table-wrap"><table><thead><tr><th scope="col">Store</th><th scope="col">Item</th><th scope="col">Sale price</th><th scope="col">Per ${esc(PER_LABEL[g.per].replace(/^[/ ]/, ""))}</th></tr></thead>
  <tbody>${g.rows.map((r, n) => `<tr${n === 0 ? ' class="best"' : ""}><td><a href="${url(`stores/${r.i.store}/`)}">${esc(storeName(r.i.store))}</a>${n === 0 ? ` <span class="chip">Cheapest</span>` : ""}</td><td>${esc(r.i.item)}</td><td class="num">${esc(priceText(r.i))}</td><td class="num">${esc(money(r.v))}${PER_LABEL[g.per]}</td></tr>`).join("")}</tbody></table></div>
</section>`).join("\n")}` : `<p class="muted">No item is on sale at more than one store this week.</p>`}`;
  write("compare/", page({ title: "Compare stores", path: "compare/", body }));
}

// ---------- past weeks ----------

function weekPages() {
  for (const w of weeks) {
    const items = analyzed.get(w.week);
    const current = w === latest;
    const body = `<div class="wrap">${crumbs(["weeks/", "Past weeks"])}${pageHead(`Week of ${esc(fmtDate(w.week, { year: true }))}`, current ? `This is the current week. <a href="${url()}">See it on the home page</a>.` : "These prices have ended, and flyer links may now show a newer flyer.")}</div>
${items.length ? `${controls({ stores: storesIn(items), sort: true })}
<div class="wrap list" data-filterable>
${countLine()}
${grouped(items, { ends: false })}
${emptyLine("Nothing matches these filters.")}
</div>` : `<div class="wrap"><p>No sale items were recorded this week.</p></div>`}
<div class="wrap"><section class="block" aria-labelledby="h-fly"><div class="sec-h"><h2 id="h-fly">Flyers that week</h2></div>${flyerList(w)}</section></div>`;
    write(`weeks/${w.week}/`, page({ title: `Week of ${fmtDate(w.week, { weekday: false, year: true })}`, path: `weeks/${w.week}/`, section: "", body, wrap: false }));
  }
  const rows = [...weeks].reverse().map((w) => {
    const items = analyzed.get(w.week);
    const stand = items.filter((i) => i.a.tier === "standout");
    const read = w.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
    return `<li><a href="${url(`weeks/${w.week}/`)}">${esc(fmtDate(w.week, { year: true }))}</a>
  <span class="muted">${items.length} items, ${stand.length} standouts, ${read} flyers read</span>
  ${stand.length ? `<div class="small">Top: ${stand.slice(0, 3).map((i) => `${esc(i.item)} at ${esc(storeName(i.store))}`).join("; ")}</div>` : ""}</li>`;
  });
  write("weeks/", page({ title: "Past weeks", path: "weeks/", section: "", body: `${pageHead("Past weeks", "Every week since the site started.")}\n<ul class="weeks">${rows.join("\n")}</ul>` }));
}

function mapData(stores, items) {
  const locations = stores.flatMap((s) => {
    const mine = items.filter((i) => i.store === s.id);
    const stand = mine.filter((i) => i.a.tier === "standout").length;
    const summary = s.no_online_flyer ? "" : mine.length ? `${mine.length} items on sale this week${stand ? `, ${stand} standout${stand > 1 ? "s" : ""}` : ""}` : "No sale items recorded this week";
    return s.locations.map((l) => ({
      storeId: s.id, store: s.name, url: url(`stores/${s.id}/`), label: l.label, address: l.address, lat: l.lat, lon: l.lon,
      flyer: l.flyer, noFlyer: Boolean(s.no_online_flyer), highlight: l.flyer && stand > 0, summary: l.flyer ? summary : "",
    }));
  });
  return `<script type="application/json" id="map-data">${JSON.stringify({ locations }).replace(/</g, "\\u003c")}</script>`;
}

const MAP_LEGEND = `<p class="legend">
  <span><span class="pin pin-hot"></span> Flyer we track, with standouts this week</span>
  <span><span class="pin pin-flyer"></span> Flyer we track</span>
  <span><span class="pin pin-other"></span> Other location of the same store</span>
  <span><span class="pin pin-none"></span> No online flyer</span>
</p>`;

// ---------- stores ----------

function storePages() {
  const items = analyzed.get(latest.week);
  const active = cfg.stores.filter((s) => s.active);
  const tracked = active.filter((s) => !s.no_online_flyer)
    .map((s) => ({ s, n: items.filter((i) => i.store === s.id && i.a.tier === "standout").length, c: items.filter((i) => i.store === s.id).length }))
    .sort((a, b) => b.n - a.n || b.c - a.c).map((x) => x.s);
  const others = active.filter((s) => s.no_online_flyer);
  const toggles = active.filter((s) => s.locations.length)
    .map((s) => `<label class="check"><input type="checkbox" value="${esc(s.id)}" data-map-store checked> ${esc(s.name)}</label>`).join("");
  write("stores/", page({
    title: "Stores and map", path: "stores/", map: true,
    body: `${pageHead("Stores", "The Asian markets, seafood shops and co-ops we read every Friday, with the most standouts first. Each store is tracked by one general Seattle-area flyer; other locations may have different prices.")}
<div class="tools chiprow"><button type="button" class="fchip" aria-pressed="false" data-deliv-toggle>${ic("truck")}<span>Delivers</span></button></div>
<ul class="tiles" data-store-tiles>${tracked.map((s) => storeTile(s, items, { about: true })).join("\n")}</ul>
${emptyState({ mood: "surprised", title: "No stores match", msg: "None of these stores deliver. Turn off Delivers to see them all.", attrs: "data-deliv-empty hidden" })}
<section class="block" aria-labelledby="h-map">
  <div class="sec-h"><h2 id="h-map">Map</h2></div>
  <div id="store-map" class="map" role="region" aria-label="Map of store locations"></div>
  ${MAP_LEGEND}
  <details class="map-toggles"><summary>Show or hide stores on the map</summary><div class="grid">${toggles}</div></details>
  ${mapData(active, items)}
</section>
${others.length ? `<section class="block" aria-labelledby="h-other">
  <div class="sec-h"><h2 id="h-other">Other markets worth knowing</h2><p>Good local markets with no online flyer, so their prices are not tracked</p></div>
  <ul class="tiles">${others.map((s) => storeTile(s, items, { about: true })).join("\n")}</ul>
</section>` : ""}
<section class="block" aria-labelledby="h-fly">
  <div class="sec-h"><h2 id="h-fly">This week's flyers</h2></div>
  ${flyerList(latest)}
</section>
<p><a href="${esc(cfg.site.suggest_store_url)}">Suggest a store</a></p>`,
  }));

  for (const s of cfg.stores) {
    const period = s.sale_period.starts === "varies" ? "Varies" : `${DAY_LABELS[s.sale_period.starts]} to ${DAY_LABELS[s.sale_period.ends]}`;
    const f = latest.flyers.find((x) => x.store === s.id);
    const mine = items.filter((i) => i.store === s.id);
    const vegN = mine.filter(isVegetarian).length;
    const history = [...weeks].slice(0, -1).reverse().flatMap((w) =>
      analyzed.get(w.week).filter((i) => i.store === s.id && i.a.tier !== "sale").map((i) => ({ week: w.week, i })),
    );
    const towns = [...new Set(s.locations.map((l) => l.address.split(",").pop().trim().replace(/\s+WA.*$/, "")))];
    const adUrl = s.flyer_url ?? f?.links?.[0]?.url ?? null;
    const sub = [
      towns.length ? esc(towns.join(" · ")) : s.locations.length ? "" : "Home delivery",
      f && (f.status === "full" || f.status === "partial") && f.valid_from ? `Sale ${esc(fmtDate(f.valid_from, { weekday: false }))} to ${esc(fmtDate(f.valid_through, { weekday: false }))}` : "",
    ].filter(Boolean).join(" &middot; ");
    const actions = `<div class="actions">
  ${adUrl && !s.no_online_flyer ? `<a class="btn btn-primary btn-ad" href="${esc(adUrl)}" rel="noopener">${ic("ad")}See ${esc(s.name)}'s weekly ad ${ext}</a>` : ""}
  ${mine.length ? `<a class="btn" href="#deals"><span>This week's ${vegText(plural(mine.length, "deal"), plural(vegN, "vegetarian deal"))} here</span></a>` : ""}
  ${s.website ? `<a class="btn" href="${esc(s.website)}" rel="noopener">Store website ${ext}</a>` : ""}
</div>`;
    const flyerNote = !s.no_online_flyer && f && f.status !== "full"
      ? `<div class="note-card"><b>${STATUS_LABELS[f.status]} this week</b>${f.note ? `<span>${esc(f.note)}</span>` : ""}${f.links.length ? `<span class="links">${flyerLinks(f, s)}</span>` : ""}</div>`
      : !s.no_online_flyer && !f ? `<div class="note-card"><b>Not checked this week</b></div>` : "";
    const histRows = history.map(({ week, i }) => `<tr>
  <td><a href="${url(`weeks/${week}/`)}">${esc(fmtDate(week, { weekday: false }))}</a></td>
  <td>${esc(i.item)}</td>
  <td>${esc(priceText(i))}${unitPriceIsExtra(i) ? `<br><span class="muted">${esc(unitPriceText(i.unit_price))}</span>` : ""}</td>
  <td>${esc(TIER_LABELS[i.a.tier])}</td>
</tr>`);
    const locs = s.locations.length
      ? `<ul class="locations">${s.locations.map((l) => `<li><strong>${esc(l.label)}</strong> <span class="muted">${esc(l.address)}</span>${s.no_online_flyer ? "" : l.flyer ? ` <span class="chip">Flyer tracked here</span>` : ` <span class="chip chip-quiet">Prices may differ</span>`}</li>`).join("")}</ul>`
      : `<p class="muted">Home delivery only, no store to visit.</p>`;
    const facts = s.no_online_flyer
      ? `<dl class="facts">${s.website ? `<dt>Website</dt><dd><a href="${esc(s.website)}" rel="noopener">${esc(s.website.replace(/^https:\/\/(www\.)?/, ""))}</a></dd>` : ""}<dt>Flyer</dt><dd>${esc(s.flyer_url_note)}</dd></dl>`
      : `<dl class="facts">
  <dt>Flyer</dt><dd>${s.flyer_url ? `<a href="${esc(s.flyer_url)}" rel="noopener">${esc(s.flyer_url.replace(/^https:\/\/(www\.)?/, ""))}</a>` : "No fixed link"}${s.flyer_url_note ? `<br><span class="muted">${esc(s.flyer_url_note)}</span>` : ""}</dd>
  <dt>Sale period</dt><dd>${esc(period)}${s.sale_period.note ? `<br><span class="muted">${esc(s.sale_period.note)}</span>` : ""}</dd>
  <dt>Format</dt><dd>${FORMAT_LABELS[s.flyer_format]}</dd>
  <dt>Regular prices</dt><dd>${s.prints_regular_prices ? "Printed" : "Not printed, so staples are compared to US averages"}</dd>
  <dt>Flyer used</dt><dd>${esc(s.representative_location)}</dd>
</dl>`;
    const body = `<div class="wrap">
${crumbs(["stores/", "Stores"])}
${pageHead(esc(s.name), sub)}
<div class="about-store"><p class="lede clamp" id="about-${esc(s.id)}" data-clamp>${esc(s.about)}</p><button type="button" class="linkish" data-clamp-toggle aria-controls="about-${esc(s.id)}" aria-expanded="false" hidden>Read more</button></div>
${actions}
${s.delivery ? `<div class="note-card"><b>Delivery</b><span>${esc(s.delivery)}</span></div>` : ""}
${flyerNote}
${mine.length ? `<div class="sec-h deals-h" id="deals"><h2>Deals this week</h2><p>${vegText(dealCounts(mine), dealCounts(mine.filter(isVegetarian)))}</p></div>` : !s.no_online_flyer ? emptyState({ mood: "sleepy", title: "No deals from this flyer this week", msg: f && f.status === "unreadable" ? "The flyer couldn't be read this week. The weekly ad link above still works." : "Nothing was listed from this store this week. The next edition posts Friday.", link: [url(), "See this week's deals"] }) : ""}
</div>
${mine.length ? `${controls({ store: false, sort: true })}
<div class="wrap list" data-filterable>
${countLine()}
${grouped(mine, { store: false, endRef: f?.valid_through ?? EDITION_END })}
${emptyLine(vegN ? "Nothing matches these filters." : "No vegetarian deals here this week. Turn off Vegetarian to see them all.")}
</div>` : ""}
<div class="wrap">
<section class="block" aria-labelledby="h-loc">
  <div class="sec-h"><h2 id="h-loc">Locations</h2></div>
  ${s.locations.length ? `<div id="store-map" class="map map-small" role="region" aria-label="Map of ${esc(s.name)} locations"></div>${mapData([s], items)}` : ""}
  ${locs}
</section>
<section class="block" aria-labelledby="h-facts">
  <div class="sec-h"><h2 id="h-facts">About the flyer</h2></div>
  ${facts}
</section>
${s.no_online_flyer ? "" : `<section class="block" aria-labelledby="h-past">
  <div class="sec-h"><h2 id="h-past">Good deals in past weeks</h2></div>
  ${histRows.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Week</th><th scope="col">Item</th><th scope="col">Price</th><th scope="col">Deal</th></tr></thead><tbody>${histRows.join("")}</tbody></table></div>` : `<p class="muted">None yet.</p>`}
</section>`}
</div>`;
    write(`stores/${s.id}/`, page({ title: s.name, path: `stores/${s.id}/`, section: "stores/", body, wrap: false, map: s.locations.length > 0 }));
  }
}

// ---------- persimmon season ----------

// The buddy's fruit without a face, for the menu icon and the falling persimmons.
const PERSIMMON_SVG = `<svg viewBox="0 0 100 100" width="21" height="21" aria-hidden="true"><rect class="bd-fruit" x="7" y="25" width="86" height="70" rx="34"/><ellipse class="bd-shine" cx="28" cy="40" rx="8" ry="5" transform="rotate(-30 28 40)"/><rect class="bd-stem" x="47.75" y="17.5" width="4.5" height="9" rx="2.25"/><g class="bd-leaf" transform="translate(50 27) scale(1.25 .42)">${[45, 135, 225, 315].map((a) => `<ellipse cx="9" rx="10.5" ry="5.5" transform="rotate(${a})"/>`).join("")}</g></svg>`;

function inPersimmonSeason(iso) {
  const md = iso.slice(5);
  const { from, to } = cfg.site.persimmon_season;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
const PERSIMMON_SEASON = inPersimmonSeason(latest.week);
const isFuyu = (i) => /fuyu/i.test(i.item);
const isPersimmon = (i) => i.item_key === "persimmons" || /persimmon/i.test(i.item);
// A Fuyu weighs about 7 oz, so per-each prices are compared as an estimated price per pound.
const PERSIM_LB = 7 / 16;
const persimPerLb = (i) => i.unit_price.per === "lb" ? i.unit_price.value : i.unit_price.per === "each" ? i.unit_price.value / PERSIM_LB : Infinity;
const byPerLb = (a, b) => persimPerLb(a) - persimPerLb(b);

function persimmonPage() {
  const items = analyzed.get(latest.week).filter(isPersimmon).filter((i) => i.unit_price);
  const fuyu = items.filter(isFuyu).sort(byPerLb);
  const others = items.filter((i) => !isFuyu(i)).sort(byPerLb);
  const best = fuyu[0];
  const per10 = best && isFinite(persimPerLb(best)) ? Math.floor(10 / (persimPerLb(best) * PERSIM_LB)) : null;

  const log = [...weeks].reverse().map((w) => {
    const f = analyzed.get(w.week).filter((i) => isPersimmon(i) && isFuyu(i) && i.unit_price).sort(byPerLb)[0];
    return f ? { week: w.week, f } : null;
  }).filter(Boolean);
  const maxLog = Math.max(...log.map((l) => persimPerLb(l.f)), 1);

  const hero = best
    ? `<section class="persim-hero" aria-labelledby="best-h">
  <div class="persim-mascot" data-bounce>${buddy("happy", 160)}</div>
  <p class="persim-kicker">The best Fuyu deal in this week's flyers</p>
  <h2 id="best-h" class="persim-price">${esc(priceText(best))}</h2>
  <p class="persim-where">at <a href="${url(`stores/${best.store}/`)}">${esc(storeName(best.store))}</a>${best.valid_through ? `, through ${esc(fmtDate(best.valid_through))}` : ""}</p>
  <p class="persim-item">${esc(best.item)}</p>
  ${best.valid_through ? `<p class="notice" data-expired-after="${best.valid_through}" hidden>This deal ended ${esc(fmtDate(best.valid_through))}. New flyers come in on Friday.</p>` : ""}
  ${per10 ? `<p class="persim-math">That's about <strong>${per10} persimmons for $10</strong>.<span class="muted"> Roughly, at 7 oz a persimmon.</span></p>` : ""}
  ${best.notes ? `<p class="muted">${esc(best.notes)}</p>` : ""}
</section>`
    : `<section class="persim-hero">
  <div class="persim-mascot sad" data-bounce>${buddy("sad", 160)}</div>
  <h2 class="persim-price">No Fuyu on sale this week.</h2>
  <p class="persim-where">Stay strong. Check back Friday.</p>
</section>`;

  const runners = fuyu.slice(1);
  const body = `<div class="persim-sky" data-persim-sky aria-hidden="true"></div>
<div class="persim-page">
<p class="persim-eyebrow">It is persimmon season${PERSIMMON_SEASON ? "" : " (or it was)"}. Week of ${esc(fmtDate(latest.week, { weekday: false, year: true }))}.</p>
<h1 class="persim-title">Where to buy <span>persimmons</span> this week</h1>
${hero}
${runners.length ? `<section><h2>Also on sale</h2><ul class="persim-list">${runners.map((i) => `<li><span>${esc(i.item)} <a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a></span><strong>${esc(priceText(i))}${i.unit_price.per === "each" ? `<span class="muted small"> (about ${esc(money(persimPerLb(i)))}/lb)</span>` : ""}</strong></li>`).join("")}</ul></section>` : ""}
${others.length ? `<section><h2>Other persimmons</h2><p class="sub">The flyer didn't say which kind. Could be Fuyu, could be Hachiya. Ask before you bite.</p><ul class="persim-list">${others.map((i) => `<li><span>${esc(i.item)} <a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a></span><strong>${esc(priceText(i))}</strong></li>`).join("")}</ul></section>` : ""}
${log.length ? `<section><h2>The persimmon price log</h2><p class="sub">The best Fuyu deal in the flyers each week.</p>
<ol class="persim-log">${log.map((l) => `<li><span class="pl-week">${esc(fmtDate(l.week, { weekday: false }))}</span><span class="pl-bar" style="--w:${Math.round((persimPerLb(l.f) / maxLog) * 100)}%"><span>${l.f.unit_price.per === "lb" ? "" : "about "}${esc(money(persimPerLb(l.f)))}/lb</span></span><span class="pl-store">${esc(storeName(l.f.store))}</span></li>`).join("")}</ol></section>` : ""}
<section class="persim-facts"><h2>Persimmon facts, for the persimmon-curious</h2>
<ul>
  <li><strong>Fuyu</strong> are the squat, tomato-shaped ones. Eat them crisp like an apple, skin and all.</li>
  <li><strong>Hachiya</strong> are the acorn-shaped ones. Wait until they are soft as a water balloon, or they will make your whole mouth go dry.</li>
  <li>Fuyu keep for a week or two on the counter and longer in the fridge.</li>
  <li>Slice one sideways and you may find a little star in the middle.</li>
  <li>Dried persimmons are called hoshigaki in Japan and gotgam in Korea.</li>
</ul></section>
<p class="persim-foot">Click anywhere for more persimmons. <a href="${url()}">Back to all the deals</a></p>
<p class="persim-foot small">Preview photo: <a href="https://commons.wikimedia.org/wiki/File:Fuyu_persimmon_fruits,_one_cut_open.jpg">Fuyu persimmon fruits, one cut open</a> by Frank Schulenburg, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, cropped.</p>
</div>
<template data-persim-svg>${PERSIMMON_SVG}</template>`;
  const live = best && (!best.valid_through || best.valid_through >= TODAY);
  const desc = live
    ? `This is not a drill. The best Fuyu deal in this week's flyers: ${priceText(best)} at ${storeName(best.store)}. Go. Go now.`
    : "No Fuyu on sale this week. We are devastated. Check back Friday.";
  const ogTitle = live ? `PERSIMMON ALERT!!! Fuyu at ${priceText(best)} at ${storeName(best.store)}` : "BUY PERSIMMONS NOW!!! (this is not a drill)";
  write("persimmons/", page({ title: "Where to buy persimmons this week", path: "persimmons/", body, description: desc,
    image: "assets/img/persimmons-og.jpg", imageAlt: "Fuyu persimmons, one cut open", ogTitle, extraScript: "assets/persimmons.js", bodyClass: "persimmon" }));
}

function aboutPage() {
  const c = cfg.criteria;
  const body = `<div class="page-h"><h1>About</h1></div>
<p>Every Friday this site lists what's on sale at Seattle's Asian markets, seafood shops, co-ops and specialty grocers, so you can see what's cheap where and plan where to shop. It links to every store's flyer for the week.</p>
<h2>Which stores</h2>
<p>The big chains, such as Safeway, QFC, Fred Meyer, Albertsons, Costco, Walmart and Target, are left out on purpose. Their own apps already show their deals. This site covers the stores those apps skip.</p>
<p>A store is included when it:</p>
<ul>
  <li>publishes a weekly flyer or specials page online;</li>
  <li>is not a mainstream supermarket, discount or big-box chain; and</li>
  <li>sells something that's hard to find at those chains, such as a cuisine, a specialty like seafood, or co-op produce.</li>
</ul>
<h2>What's listed</h2>
<p>Every sale item that could be read from each flyer. Prices are never guessed. Anything that could not be read clearly is left out, and regular prices or percent off appear only when the store printed them.</p>
<h2 id="vegetarian">Vegetarian</h2>
<p>The "Vegetarian" filter hides meat, poultry and seafood, and anything made with them, such as fish sauce, broth or pork dumplings. Dairy and eggs stay. It works from each item's category and name, so when a name doesn't make it clear, as with many dumplings and frozen meals, the item is hidden to be safe. It doesn't check for other animal ingredients, like gelatin in a pudding or lard in a pastry, unless the name says so. Check the label if it matters to you.</p>
<h2 id="how">How deals are highlighted</h2>
<p>${tierBadge("standout")} deals are any of these:</p>
<ul>
  <li>At least ${c.standout.min_percent_off_priority}% off a printed regular price for produce, meat, seafood and staples, or ${c.standout.min_percent_off_other}% off for anything else.</li>
  <li>A staple priced at ${Math.round(c.standout.max_us_average_ratio * 100)}% or less of the US average price from the <a href="${esc(cfg.benchmarksFile.source_url)}">Bureau of Labor Statistics</a>. These are national averages, not Seattle prices, so the comparison is approximate.</li>
  <li>Lower than any price this site has listed before for the same item.</li>
  <li>Hand-picked, with a short note on why.</li>
</ul>
<p>${tierBadge("good")} means at least ${c.good.min_percent_off}% off, under ${Math.round(c.good.max_us_average_ratio * 100)}% of the US average, matching the lowest price we've listed, or the cheapest of several stores this week.</p>
<p>Each deal shows one savings pill under its price. For staples with a national price, it's how far under the US average it is, like <span class="pill tone-info">${ic("flag")}28% under US avg</span>. Otherwise it's the percent off the store printed, like <span class="pill tone-good">38% off</span>.</p>
<p>Everything else is still on sale and still listed. Many stores print no regular price, so an unmarked item can still be a good buy.</p>
<h2>Where to shop and comparing stores</h2>
<p>This week's store cards and the Stores page rank stores by how many standouts they have this week. "Compare" puts the same item side by side when it's on sale at more than one store, by price per unit.</p>
<h2>Delivery</h2>
<p>Stores marked "Delivers" deliver groceries themselves. Delivery areas, minimums and fees vary, so check with the store.</p>
<h2>Flyers</h2>
<p>Each store is tracked by one general Seattle-area flyer, not by location. Flyers that could not be read, or still show last week's dates, are marked as such. This site links to the flyers and does not copy them.</p>
<h2>Check in store</h2>
<p>Prices come from store flyers and can change, sell out, or differ by location. Check in store before you rely on a price. This site is not affiliated with any store, and store names belong to their owners.</p>
<h2>Suggest a store</h2>
<p>Know a Seattle-area store that fits and has a public weekly flyer? <a href="${esc(cfg.site.suggest_store_url)}">Open a suggestion on GitHub</a> (needs a free GitHub account).</p>
<h2>For stores</h2>
<p>If you run a store listed here and want a price corrected or the store removed, <a href="${esc(cfg.site.repo_url)}/issues/new?title=Store+request">open a request on GitHub</a>. Requests are handled within a week.</p>
<h2>Privacy</h2>
<p>There are no accounts, ads or sign-ups, and nothing you do here is sold.</p>
<p>The site uses <a href="https://amplitude.com">Amplitude</a> to count which pages are viewed and what gets clicked, so it can be improved. It's set up to be as private as possible: no IP address stored, no cookies, and no name or account. Amplitude keeps a random ID in your browser's storage so repeat visits count once, and receives basic details like browser type and screen size. About 1 in 20 visits is also recorded (Session Replay) to see where the site is confusing; in those recordings all text and everything you type is hidden, so they show only the page layout, scrolling and taps. Its handling of that data is described in <a href="https://amplitude.com/privacy">Amplitude's privacy notice</a>.</p>
<p>It doesn't run at all if your browser sends Global Privacy Control or Do Not Track, or if you turn it off here: <button type="button" class="linkish" data-analytics-toggle>Turn off analytics in this browser</button> <span class="muted" data-analytics-state></span></p>
<p>Your "Vegetarian" choice and the analytics setting are saved only in your browser and are never sent anywhere. The store map loads map tiles from OpenStreetMap, which receives your IP address the way any website does. Apart from Amplitude and the map tiles, everything, fonts included, is served from this site.</p>
<p>The data is public: <a href="${url("data/weeks/")}">weekly JSON files</a> and the <a href="${url("schema/week.schema.json")}">schema</a>.</p>`;
  write("about/", page({ title: "About", path: "about/", body }));
}

function dataPages() {
  mkdirSync(join(DIST, "data", "weeks"), { recursive: true });
  for (const w of weeks) writeFileSync(join(DIST, "data", "weeks", `${w.week}.json`), JSON.stringify(w, null, 2));
  const list = [...weeks].reverse().map((w) => `<li><a href="${url(`data/weeks/${w.week}.json`)}">${w.week}.json</a></li>`).join("");
  write("data/weeks/", page({ title: "Data", path: "", body: `<h1>Weekly data</h1>\n<ul>${list}</ul>` }));
  mkdirSync(join(DIST, "schema"), { recursive: true });
  cpSync(join(ROOT, "schema", "week.schema.json"), join(DIST, "schema", "week.schema.json"));
}

function notFound() {
  writeFileSync(join(DIST, "404.html"), page({ title: "Not found", path: "", section: "404", body: `<div class="nf">${buddy("sad", 120)}<h1>Page not found</h1><p class="page-sub">That page isn't in this week's paper. It may have moved, or the sale it was about has ended.</p><p><a class="btn btn-primary" href="${url()}">See this week's deals</a></p></div>` }));
}


// A ready-to-use feed for the mobile app: this week's deals with the analysis done.
function appFeed() {
  const items = analyzed.get(latest.week);
  const feed = {
    week: latest.week, end: weekEnd(latest), generated: TODAY,
    categories: CATS.filter((c) => items.some((i) => i.category === c)).map((c) => ({ id: c, label: CATEGORY_LABELS[c] })),
    stores: cfg.stores.filter((s) => s.active && !s.no_online_flyer).map((s) => {
      const f = latest.flyers.find((x) => x.store === s.id);
      return { id: s.id, name: s.name, about: s.about, website: s.website ?? null, flyer_url: s.flyer_url ?? f?.links?.[0]?.url ?? null,
        // The flyer itself (page images, PDFs, flyer pages), so the app can show it in its own
        // viewer instead of loading the store's home page in a web view.
        flyer_pages: s.no_online_flyer ? [] : (f?.links ?? []).map((l) => ({ label: l.label, url: l.url, kind: flyerKind(l.url) })),
        delivery: s.delivery ?? null, status: f?.status ?? null, from: f?.valid_from ?? null, through: f?.valid_through ?? null,
        locations: s.locations.map((l) => ({ label: l.label, address: l.address, lat: l.lat, lon: l.lon })) };
    }),
    items: items.map((i, rank) => {
      const p = priceParts(i);
      return { id: `${i.store}-${rank}`, rank, name: i.item, store: i.store, category: i.category, key: i.item_key ?? null,
        price: i.price, text: priceText(i), lead: p.lead, amount: p.cur + p.num, unit: p.unit.trim(), spoken: p.spoken, detail: p.detail,
        regular: i.regular_price != null ? priceText(i, i.regular_price) : null, off: i.percent_off ?? null,
        unit_price: i.unit_price ? unitPriceText(i.unit_price) : null, tier: i.a.tier,
        // The US average (BLS, staples only) and whether it's the lowest we've listed: shown
        // in the app as "28% under the US average" and "Lowest we've listed".
        us: i.a.us ? { avg: unitPriceText({ value: i.a.us.price, per: i.a.us.per }), under: Math.round((1 - i.a.us.ratio) * 100), period: i.a.us.period ?? null } : null,
        lowest: i.a.tags.some((t) => t.kind === "low"),
        why: i.highlight?.reason ?? i.a.tags.filter((t) => t.kind !== "pct").map((t) => t.text).join(". "),
        veg: isVegetarian(i), ends: i.valid_through, notes: i.notes ?? null };
    }),
  };
  mkdirSync(join(DIST, "api"), { recursive: true });
  writeFileSync(join(DIST, "api", "week.json"), JSON.stringify(feed));
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, "site", "assets"), join(DIST, "assets"), { recursive: true });
// Bundle Amplitude (npm packages) into an ES module with split chunks, so Session Replay's
// code downloads only for the visits it records. The site has no other bundler.
const analyticsOut = buildSync({
  entryPoints: { analytics: join(ROOT, "client", "analytics.js") }, bundle: true, minify: true, format: "esm", splitting: true,
  target: "es2020", outdir: join(DIST, "assets", "analytics"), chunkNames: "chunk-[hash]", legalComments: "none",
  define: { __AMPLITUDE_API_KEY__: JSON.stringify(AMPLITUDE_KEY) }, write: true, metafile: true,
});
const analyticsEntry = readFileSync(join(DIST, "assets", "analytics", "analytics.js"));
ANALYTICS_SRC = `${url("assets/analytics/analytics.js")}?v=${createHash("sha1").update(analyticsEntry).digest("hex").slice(0, 8)}`;
writeFileSync(join(DIST, ".nojekyll"), "");
homePage();
standoutsPage();
departmentPages();
comparePage();
weekPages();
storePages();
aboutPage();
persimmonPage();
dataPages();
appFeed();
notFound();
console.log(`Built ${weeks.length} week(s), latest ${latest.week}, into dist/ with base ${BASE}`);
