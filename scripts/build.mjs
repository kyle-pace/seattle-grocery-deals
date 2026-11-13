// Builds the static site into dist/. Usage: node scripts/build.mjs
// Set BASE_PATH=/ to build for a local server at the root.
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildSync } from "esbuild";
import { writePopular } from "./popular.mjs";
// What people are adding this week (Amplitude, counts only), read before the pages are built
// so This week can show it like the app. Set in the build steps at the bottom.
let POPULAR = { items: [] };
import { buddy, seasonBuddy, seasonIcon } from "./buddy.mjs";
import { loadSeasons, seasonOn, seasonDeals, seasonLog, seasonEnd, fill } from "./seasons.mjs";
import {
  ROOT, loadConfig, loadWeeks, esc, fmtDate, fmtPeriod, money, priceText, unitPriceText, packText,
  unitPriceIsExtra, analyze, priorListings, peerPrices, convertPer, isVegetarian, flyerKind, storeRanks,
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

// ---------- KitchenUI pieces: icons, badges and the crow ----------
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
  // the Apps page
  newspaper: `<path d="M2.5 3h9v10h-9zM11.5 6h2v6a1 1 0 0 1-2 0M4.5 5.5h3v3h-3zM9.5 5.5v3M4.5 10.5h5"/>`,
  grid: `<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>`,
  list: `<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.8" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="2.8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="2.8" cy="12" r=".9" fill="currentColor" stroke="none"/>`,
  bell: `<path d="M4 11V7.2a4 4 0 0 1 8 0V11l1.2 1.5H2.8zM6.6 14a1.5 1.5 0 0 0 2.8 0"/>`,
  plus: `<path d="M8 3.2v9.6M3.2 8h9.6"/>`,
  check: `<path d="M3.4 8.4l3 3 6.2-6.6"/>`,
  copy: `<rect x="5.5" y="5.5" width="8" height="8.5" rx="1.5"/><path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5v6.5A1.5 1.5 0 0 0 4 11.5h1.5"/>`,
  share: `<path d="M8 10V2.4M5 5.2L8 2.2l3 3M3.5 8.5v4.6c0 .5.4.9.9.9h7.2c.5 0 .9-.4.9-.9V8.5"/>`,
  trash: `<path d="M2.8 4.3h10.4M6.3 4.3V2.8h3.4v1.5M4.2 4.3l.6 9h6.4l.6-9"/>`,
  clock: `<circle cx="8" cy="8" r="6.3"/><path d="M8 4.6V8l2.4 1.6"/>`,
  people: `<circle cx="6" cy="5.2" r="2.3"/><path d="M1.8 13.4c.4-2.6 2.1-4 4.2-4s3.8 1.4 4.2 4"/><circle cx="11.4" cy="5.8" r="1.9"/><path d="M11.2 9.5c1.7.1 2.8 1.3 3.1 3.4"/>`,
  widget: `<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 6h5M5.5 8.5h3M5.5 11h4"/>`,
};
const ic = (name) => `<svg class="ic ic-${name}" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
// A shape and a word for a state, never color alone. Tones: good, warn, bad, neutral, info.
const badge = (tone, icon, text) => `<span class="badge tone-${tone}">${icon ? ic(icon) : ""}${esc(text)}</span>`;
const tierBadge = (tier) => tier === "standout" ? badge("warn", "star", "Standout") : tier === "good" ? badge("neutral", "halfStar", "Good deal") : "";

// The crow (and the persimmon for persimmon season) live in buddy.mjs, shared with the share-image scripts.

// A friendly empty screen: the buddy, a headline, a line, and at most one way forward.
const emptyState = ({ mood = "sad", title, msg = "", link = null, attrs = "" }) => `<div class="empty-state"${attrs ? " " + attrs : ""}>${buddy(mood, 88)}<p class="empty-title">${esc(title)}</p>${msg ? `<p class="empty-msg"${attrs.includes("data-empty") ? " data-empty-msg" : ""}>${esc(msg)}</p>` : ""}${link ? `<p><a class="go" href="${link[0]}">${esc(link[1])}</a></p>` : ""}</div>`;

// "Oct 23 to 29", or "Oct 30 to Nov 5" across months.
// "Fuyu Persimmon" from "Fuyu Persimmon, jumbo (8 ct)", as the app's shortName (DealViews.swift).
function shortName(name) {
  let s = name.split(/[,(]/)[0].replace(/\s*#\s*\d+\b/g, "").trim();
  const parts = s.split(" - ");
  if (parts.length === 2 && parts[1]) s = `${parts[1]} ${parts[0].toLowerCase()}`;
  return s.trim();
}
// A small picture for each aisle, the same emoji as the app (Aisles.swift AisleArt). Decorative.
const AISLE_EMOJI = { produce: "🥬", meat: "🥩", seafood: "🐟", "dairy-eggs": "🥚", pantry: "🍚", frozen: "🥟", bakery: "🥖", prepared: "🍱", "snacks-drinks": "🍵" };
const aisleEmoji = (c) => `<span class="tile-art" aria-hidden="true">${AISLE_EMOJI[c] ?? "🧺"}</span>`;
// Days left on a flyer, as the app's weekly ad card: "Ends today", "3 days left". The build
// runs at least hourly, and app.js recounts it from data-through in the browser.
const daysLeftText = (through) => {
  if (!through) return "";
  const left = Math.round((Date.parse(through) - Date.parse(TODAY)) / 86400000) + 1;
  return left === 1 ? "Ends today" : left > 1 ? `${left} days left` : "";
};

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

// When this week's deals end, by number of deals: "most" is the date the most deals still on
// sale run through (a tie goes to the later date), and "some" the earliest earlier date that at
// least a tenth of them end on. Stores start their sales on different days (Wednesday,
// Thursday, Friday) and are updated as each new flyer comes out, so there is no single end.
function endsSummary(week) {
  const through = Object.fromEntries(week.flyers.map((f) => [f.store, f.valid_through]));
  const n = {};
  let total = 0;
  for (const i of week.items) {
    const d = i.valid_through ?? through[i.store];
    if (!d || d < TODAY) continue;
    n[d] = (n[d] ?? 0) + 1;
    total++;
  }
  const dates = Object.entries(n).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]));
  const most = dates[0]?.[0] ?? null;
  const some = Object.entries(n).filter(([d, c]) => most && d < most && c >= total / 10).map(([d]) => d).sort()[0] ?? null;
  return { most, some };
}
// The latest day a store's flyer started (not in the future): when the deals last changed.
function updatedOn(week) {
  return week.flyers.filter((f) => (f.status === "full" || f.status === "partial") && f.valid_from && f.valid_from <= TODAY)
    .map((f) => f.valid_from).sort().pop() ?? week.week;
}

// The date most of this edition's sales run through, and each store's flyer end. Rows only
// say "through" when a deal ends on a different day.
const ENDS = endsSummary(latest);
// Each store's rank for "Best of your stores" (lib.mjs storeRanks), shared by the site and the app.
const LATEST_ITEMS = analyzed.get(latest.week);
const RANKS = storeRanks(LATEST_ITEMS, cfg, TODAY, (i) => `${i.store}-${LATEST_ITEMS.indexOf(i)}`);
const EDITION_END = ENDS.most;

// ---------- deal rows ----------

// When a deal ends, said the same way as the app (Deal.endsBadge, Deal.endsDetail): a badge for
// "Ends today", "Ends tomorrow" and "Ended", otherwise "Through Sat" (this week) or "Through
// Nov 14" in the details. Worked out for the build's day; app.js redoes it in the browser so a
// cached page stays right.
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function endsInfo(d) {
  if (!d) return { badge: "", detail: "" };
  const left = Math.round((Date.parse(d) - Date.parse(TODAY)) / 86400000) + 1;
  const word = left <= 0 ? "Ended" : left === 1 ? "Ends today" : left === 2 ? "Ends tomorrow" : "";
  if (word) return { badge: badge(left <= 0 ? "neutral" : "bad", "clock", word), detail: "", ended: left <= 0 };
  return { badge: "", detail: `Through ${left <= 7 ? DAY_ABBR[new Date(d + "T12:00:00Z").getUTCDay()] : fmtDate(d, { weekday: false })}` };
}

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

// One savings pill with the deal's words (under the name and details), as in the app: the US average where there is one (BLS,
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
// ends: say when it ends (every row does, since stores update on their own days).
function dealRow(i, rank, { why = false, store = true, ends = true, people = 0 } = {}) {
  const p = priceParts(i);
  const sv = savings(i);
  const low = why && i.a.tags.some((t) => t.kind === "low");
  const end = ends ? endsInfo(i.valid_through) : { badge: "", detail: "" };
  const badges = tierBadge(i.a.tier) + (i.valid_through && ends ? `<span class="ends-b" data-ends-badge${end.badge ? "" : " hidden"}>${end.badge}</span>` : "") + (low ? badge("good", "down", "Lowest we've listed") : "");
  const metaParts = [
    store ? `<a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a>` : "",
    ...p.detail.map(esc),
    i.member_price ? "member price" : "",
  ].filter(Boolean);
  // The end date carries its own separator, so hiding it (when the badge says it) leaves no stray dot.
  const sep = metaParts.length ? " · " : "";
  const meta = metaParts.join(" &middot; ") + (ends && i.valid_through ? `<span data-ends-detail${sep ? " data-sep" : ""}${end.detail ? "" : " hidden"}>${esc(end.detail ? sep + end.detail : "")}</span>` : "");
  // The pill and badges already say "% off", "under US avg" and "lowest", so the reason skips them.
  const reason = why ? (i.highlight?.reason ?? i.a.tags.filter((t) => !["pct", "us", "low", "member"].includes(t.kind)).map((t) => t.text).join(". ")) : "";
  // What the list keeps if this deal is added (app.js, sgd.list): enough to show it after the
  // week's data has moved on. The id survives rebuilds: store, name and price.
  const li = { id: `${i.store}|${i.item}|${i.price}`, name: i.item, store: i.store, storeName: storeName(i.store), price: priceText(i), ends: i.valid_through ?? null, key: i.item_key ?? null };
  return `<li class="deal${end.ended ? " deal-ended" : ""}" ${rowAttrs(i, rank)}${i.valid_through ? ` data-ends="${i.valid_through}"` : ""} data-li="${esc(JSON.stringify(li))}">
  <div class="deal-main">${badges ? `<p class="deal-badges">${badges}</p>` : ""}<p class="deal-name">${esc(i.item)}</p>${meta ? `<p class="deal-meta">${meta}</p>` : ""}${sv ? `<p class="deal-pill">${sv.html}</p>` : ""}${people ? `<p class="deal-people">${ic("people")}${plural(people, "person", "people")} added this</p>` : ""}${reason ? `<p class="deal-why">${esc(reason)}</p>` : ""}${i.notes ? `<p class="deal-note">${esc(i.notes)}</p>` : ""}</div>
  ${amount(i, { pill: false })}
  <button type="button" class="add-btn" data-add aria-pressed="false" aria-label="Add ${esc(i.item)} at ${esc(storeName(i.store))} to your list">${ic("plus")}${ic("check")}</button>
</li>`;
}

// Ended deals go to the bottom of a list (they stay, faded, until the store's next flyer).
const isEnded = (i) => Boolean(i.valid_through && i.valid_through < TODAY);
const liveFirst = (list) => [...list.filter((i) => !isEnded(i)), ...list.filter(isEnded)];

// Deals grouped by department, each group a section that hides when filters empty it.
function grouped(items, opts = {}) {
  return CATS.filter((c) => items.some((i) => i.category === c)).map((c) => {
    const list = liveFirst(items.filter((i) => i.category === c));
    return `<section class="group" data-group aria-labelledby="g-${c}">
  <h2 class="sec-label group-h" id="g-${c}"><span>${esc(CATEGORY_LABELS[c])}</span> <span class="sec-note" data-group-count>${list.length}</span></h2>
  <ul class="deals" data-sortable>${list.map((i) => dealRow(i, items.indexOf(i), opts)).join("\n")}</ul>
</section>`;
  }).join("\n");
}

// Search, then a sticky row of chips: Vegetarian (KitchenUI FilterChip), store and sort.
// Rows below with [data-filterable] respond.
function controls({ search = true, store = true, sort = false, stores = [], searchLabel = "Search these deals", placeholder = "tofu, persimmon, 99 Ranch" } = {}) {
  return `${search ? `<div class="wrap find-wrap"><div class="find">${ic("search")}<label class="sr-only" for="f-q">${esc(searchLabel)}</label><input id="f-q" type="search" data-search placeholder="${esc(placeholder)}" autocomplete="off"></div></div>` : ""}
<div class="bar" data-filters><div class="wrap chiprow" role="group" aria-label="Filters">
  <button type="button" class="fchip" aria-pressed="false" data-veg-toggle>${ic("leaf")}<span>Vegetarian</span></button>
  ${store && stores.length ? `<label class="sr-only" for="f-store">Store</label><select class="fchip fchip-select" id="f-store" data-filter="store"><option value="">All stores</option>${stores.map((s) => `<option value="${esc(s)}">${esc(storeName(s))}</option>`).join("")}</select>` : ""}
  <label class="sr-only" for="f-ends">When it ends</label><select class="fchip fchip-select" id="f-ends" data-filter="ends"><option value="0">Ends any day</option><option value="2">Not ending today</option><option value="3">3+ days left</option></select>
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

// "Seattle · Tukwila": the towns a store has locations in.
const towns = (s) => [...new Set(s.locations.map((l) => l.address.split(",").pop().trim().replace(/\s+WA.*$/, "")))];
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
  ${towns(s).length ? `<span class="tile-n">${esc(towns(s).join(" · "))}</span>` : ""}
  ${about ? `<span class="tile-about">${esc(s.about)}</span>` : ""}
  ${mine.length ? `<span class="tile-n">${vegText(counts(mine), counts(veg))}</span>` : ""}
  ${status ? `<span class="tile-n">${esc(status)}</span>` : ""}
  ${mine.length ? `<span class="tile-top">${vegText(top(mine), top(veg) || "No vegetarian deals")}</span>` : ""}
</a></li>`;
}

// One aisle as the app's AisleTile: its emoji and standouts count, the name, how many deals,
// and the best one by its short name.
function deptTile(c, items, base = "departments/") {
  const l = items.filter((i) => i.category === c);
  const veg = l.filter(isVegetarian);
  const st = (x) => x.filter((i) => i.a.tier === "standout").length;
  const stars = (x) => st(x) ? `<span class="badge tone-warn tile-stars">${st(x)}${ic("star")}<span class="sr-only"> standouts</span></span>` : "";
  const top = (x) => x[0] ? `<b>${esc(shortName(x[0].item))}</b> ${esc(priceText(x[0]))}` : "No vegetarian deals";
  return `<li${veg.length ? "" : " data-meat-only"}><a class="tile tile-aisle" href="${url(`${base}${c}/`)}">
  <span class="tile-art-row">${aisleEmoji(c)}${vegText(stars(l), stars(veg))}</span>
  <span class="tile-t">${esc(CATEGORY_LABELS[c])}${ic("chevron")}</span>
  <span class="tile-n">${vegText(plural(l.length, "deal"), plural(veg.length, "vegetarian deal"))}</span>
  <span class="tile-top">${vegText(top(l), top(veg))}</span>
</a></li>`;
}

// "★ Standouts · 61 this week, every aisle · Top: Fuyu Persimmon $1.48/lb", full width above
// the aisle tiles, like the app's StandoutsTile.
function standoutsTile(items) {
  const st = items.filter((i) => i.a.tier === "standout");
  const veg = st.filter(isVegetarian);
  const top = (x) => x[0] ? `Top: <b>${esc(shortName(x[0].item))}</b> ${esc(priceText(x[0]))}` : "";
  return `<li class="tile-wide"><a class="tile tile-standouts" href="${url("standouts/")}">
  <span class="tile-star" aria-hidden="true">${ic("star")}</span>
  <span class="tile-body"><span class="tile-t">Standouts${ic("chevron")}</span>
  <span class="tile-n">${vegText(`${st.length} this week, every aisle`, `${veg.length} vegetarian this week, every aisle`)}</span>
  <span class="tile-top">${vegText(top(st), top(veg))}</span></span>
</a></li>`;
}

// ---------- page frame ----------

const ICONS = {
  "": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>`,
  "departments/": `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  "stores/": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6"/></svg>`,
  "list/": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 5.5l1.2 1.2L7.4 4.4M4 11.5l1.2 1.2 2.2-2.3M4 17.5l1.2 1.2 2.2-2.3"/></svg>`,
  "compare/": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3"/></svg>`,
};
// The little heart in the header's corner: tips on Buy Me a Coffee (config/site.json support_url).
// Hidden until the link is set. Tracked as Tapped Support.
const HEART = cfg.site.support_url ? `
      <a class="head-heart" href="${esc(cfg.site.support_url)}" target="_blank" rel="noopener" aria-label="Support Grocery Deals: buy me a coffee (opens in a new tab)" title="Buy me a coffee" data-support><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M12 20.3s-7.5-4.5-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10.1-7.5 10.1z"/></svg></a>` : "";
const MAIN_NAV = [["", "This week"], ["departments/", "Aisles"], ["stores/", "Stores"], ["compare/", "Compare"], ["list/", "List"]];

// section: which menu item this page belongs to ("" is This week).
// Display settings panel on every page (assets/display.js, styles at the end of style.css).
// The first option in each group is the default.
const DISPLAY_SETTINGS = [
  ["theme", "Theme", [["auto", "System"], ["light", "Light"], ["dark", "Dark"]]],
  ["text", "Text size", [["default", "Default"], ["large", "Large"], ["larger", "Larger"]]],
  ["contrast", "Contrast", [["auto", "System"], ["default", "Standard"], ["more", "More"]]],
  ["font", "Font", [["default", "Hyperlegible"], ["system", "Device font"]]],
  ["spacing", "Spacing", [["default", "Default"], ["wide", "Wide"]]],
  ["motion", "Motion", [["auto", "System"], ["reduce", "Reduce"]]],
  ["links", "Links", [["default", "Default"], ["underline", "Underline all"]]],
];
const DISPLAY_PANEL = `<button class="dp-toggle" type="button" popovertarget="display-panel" aria-label="Display and accessibility settings"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><circle cx="12" cy="4.5" r="2" fill="currentColor"/><path d="M4 8.5c2.6.8 5.3 1.2 8 1.2s5.4-.4 8-1.2M12 9.7v5m0 0-3.5 6.8M12 14.7l3.5 6.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
<div id="display-panel" class="dp-panel" popover role="dialog" aria-labelledby="display-panel-title">
  <div class="dp-head"><h2 id="display-panel-title">Display settings</h2><button type="button" class="dp-close" popovertarget="display-panel" popovertargetaction="hide" aria-label="Close display settings"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>
  <form class="dp-options">${DISPLAY_SETTINGS.map(([key, label, options]) => `<fieldset><legend>${label}</legend><div class="dp-seg">${options.map(([value, text], i) => `<label><input type="radio" name="${key}" value="${value}"${i === 0 ? " checked" : ""}><span>${text}</span></label>`).join("")}</div></fieldset>`).join("")}</form>
  <div class="dp-foot"><button type="button" class="dp-reset">Reset</button></div>
  <p class="dp-note">Saved in this browser only.</p>
</div>`;

function page({ title, path, section = path, body, wrap = true, description, map = false, extraScript = null, bodyClass = "", pageId = "", image = null, imageAlt = "", ogTitle = null, head = "", noindex = false, jsonld = null }) {
  const full = title ? `${title} | ${cfg.site.title}` : cfg.site.title;
  const desc = description ?? cfg.site.tagline;
  const pageUrl = cfg.site.origin + cfg.site.base_path + path;
  // Pages without their own share image get the site's (scripts/site-og.mjs).
  const img = image ?? DEFAULT_OG;
  const imgAlt = image ? imageAlt : DEFAULT_OG_ALT;
  if (!noindex && section !== "404") SITEMAP.add(path);
  const cur = (p) => (p === section ? ' aria-current="page"' : "");
  const top = [...MAIN_NAV, ["app/", "App"], ["about/", "About"]].map(([p, label]) => `<a href="${url(p)}"${cur(p)}>${label}${p === "list/" ? `<span class="list-n" data-list-count hidden></span>` : ""}</a>`).join("")
    + SEASONS_NOW.map((s) => `<a class="nav-season" href="${url(`${s.slug}/`)}" aria-label="${esc(s.label)}" title="${esc(s.label)}"${cur(`${s.slug}/`)}>${seasonIcon(s.buddy)}</a>`).join("");
  const tabs = MAIN_NAV.map(([p, label]) => `<a href="${url(p)}"${cur(p)}>${ICONS[p]}<span>${label}</span>${p === "list/" ? `<span class="list-n" data-list-count hidden></span>` : ""}</a>`).join("");
  return `<!doctype html>
<html lang="en" data-base="${esc(url())}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:site_name" content="${esc(cfg.site.title)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(ogTitle || title || cfg.site.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(cfg.site.origin + cfg.site.base_path + img)}">
<meta property="og:image:type" content="${img.endsWith(".gif") ? "image/gif" : "image/png"}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imgAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle || title || cfg.site.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(cfg.site.origin + cfg.site.base_path + img)}">
<meta name="twitter:image:alt" content="${esc(imgAlt)}">
<meta name="theme-color" content="#eef3f6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1a24" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-title" content="Grocery Deals">${noindex ? `
<meta name="robots" content="noindex">` : ""}
<link rel="icon" href="${url("favicon.ico")}" sizes="48x48">
<link rel="icon" href="${url("assets/logo.svg")}" type="image/svg+xml">
<link rel="icon" href="${url("assets/favicon-96.png")}" type="image/png" sizes="96x96">
<link rel="manifest" href="${url("site.webmanifest")}">
<link rel="apple-touch-icon" href="${url("assets/apple-touch-icon.png")}">
<link rel="preload" href="${url("assets/fonts/atkinson-hyperlegible-next.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset("assets/style.css")}">
<script>try{if(JSON.parse(localStorage.getItem("sgd.vegOnly")))document.documentElement.classList.add("veg-on")}catch(e){}</script>
<script>try{var d=JSON.parse(localStorage.getItem("sgd.display")||"{}");for(var k in d)document.documentElement.setAttribute("data-"+k,d[k])}catch(e){}</script>
<script src="${asset("assets/app.js")}" defer></script>
<script src="${asset("assets/display.js")}" defer></script>
<script src="${asset("assets/list.js")}" defer></script>
<script type="module" src="${ANALYTICS_SRC}"></script>${extraScript ? `
<script src="${asset(extraScript)}" defer></script>` : ""}${head ? `
${head}` : ""}${map ? `
<link rel="stylesheet" href="${asset("assets/leaflet/leaflet.css")}">
<script src="${asset("assets/leaflet/leaflet.js")}" defer></script>
<script src="${asset("assets/map.js")}" defer></script>` : ""}${jsonld ? `
<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}${pageId ? ` data-page="${pageId}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="wrap head-in">
    <a class="brand" href="${url()}">${LOGO}<span>${esc(cfg.site.title)}</span></a>
    <div class="head-end">
      <nav class="topnav" aria-label="Main">${top}</nav>
      <a class="head-about" href="${url("about/")}"${cur("about/")}>About</a>${HEART}
    </div>
  </div>
</header>
<main id="main" tabindex="-1">
${wrap ? `<div class="wrap">\n${body}\n</div>` : body}
</main>
<footer class="site-foot"><div class="wrap">
  <nav aria-label="More"><a href="${url("weeks/")}">Past weeks</a><a href="${url("app/")}">iPhone app</a>${cfg.site.mcp_url ? `<a href="${url("mcp/")}">AI assistants</a>` : ""}<a href="${url("how-it-works/")}">How it works</a><a href="${url("about/")}">About and privacy</a><a href="${url("accessibility/")}">Accessibility</a>${SEASONS_NOW.map((s) => `<a href="${url(`${s.slug}/`)}">${esc(s.label)}</a>`).join("")}<a href="${esc(cfg.site.repo_url)}">Source</a></nav>
  <p>Prices come from each store's own flyer and can change. Check in store. Not affiliated with any store.</p>
</div></footer>
<nav class="tabbar" aria-label="Main">${tabs}</nav>
${DISPLAY_PANEL}
${section === "list/" ? "" : LIST_FAB()}
</body>
</html>
`;
}

const DEFAULT_OG = "assets/img/og.png";
const DEFAULT_OG_ALT = "Seattle Grocery Deals: a smiling persimmon next to the names of the Seattle stores whose sales the site lists.";
// Every indexable page, for sitemap.xml.
const SITEMAP = new Set();
// Search and share descriptions: "Persimmon, 99¢/lb at Lam's Seafood; ...". Prices are the
// printed ones from the week file, the same text the deal rows show.
// The name is cut at its first comma ("Folgers Ground Coffee, selected varieties").
const dealPhrase = (i, { store = true } = {}) => `${i.item.split(", ")[0].replace(/^Fz /, "Frozen ")} ${priceText(i)}${store ? ` at ${storeName(i.store)}` : ""}`;
// As many picks as fit in a search snippet (about 160 characters with the rest of the line),
// at least one and at most n.
const DESC_MAX = 165;
const pickList = (list, n, opts, room = DESC_MAX - 70) => {
  const out = [];
  for (const i of list.slice(0, n)) {
    const next = [...out, dealPhrase(i, opts)].join("; ");
    if (out.length && next.length > room) break;
    out.push(dealPhrase(i, opts));
  }
  return out.join("; ");
};
const storeCount = (items) => new Set(items.map((i) => i.store)).size;

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
  // A pick that has ended isn't a pick: leave it out (the build runs hourly).
  return list.filter((i) => !i.valid_through || i.valid_through >= TODAY).filter((i) => (taken[i.store] = (taken[i.store] ?? 0) + 1) <= PICKS_PER_STORE).slice(0, HOME_BEST);
}

// One store on This week as a card: a header row into the store, its best few deals that
// aren't already top picks, and a way to see the rest. Rows carry data-hl like the picks.
function storeCard(s, items, hlAll, hlVeg) {
  // Only sales still on, as on the app's This week (ended ones stay on the store's own page).
  const mine = items.filter((i) => i.store === s.id && !isEnded(i));
  const r = RANKS[s.id];
  const f = latest.flyers.find((x) => x.store === s.id);
  const veg = mine.filter(isVegetarian);
  const bestA = mine.filter((i) => !hlAll.includes(i)).slice(0, 3);
  const bestV = veg.filter((i) => !hlVeg.includes(i)).slice(0, 3);
  const rows = mine.filter((i) => bestA.includes(i) || bestV.includes(i))
    .map((i) => dealRow(i, items.indexOf(i), { store: false }).replace('<li class="deal" ', `<li class="deal" data-hl="${(bestA.includes(i) ? "a" : "") + (bestV.includes(i) ? "v" : "")}" `));
  // data-score and data-quiet (and their vegetarian twins) let app.js rank Your stores.
  return `<li class="card store-card" data-store-card="${esc(s.id)}" data-name="${esc(s.name)}" data-score="${r.score}" data-score-v="${r.veg.score}" data-standouts="${r.standouts}" data-standouts-v="${r.veg.standouts}"${r.quiet ? " data-quiet" : ""}${r.veg.quiet ? " data-quiet-v" : ""}${f?.valid_from ? ` data-from="${f.valid_from}"` : ""}${veg.length ? "" : " data-meat-only"}>
  <h3 class="store-card-h"><a href="${url(`stores/${s.id}/`)}" data-open-store>${ic("storefront")}<span class="store-card-t"><span class="store-card-badges"><span class="badge tone-accent" data-best-badge hidden>Best this week</span><span class="badge tone-info" data-new-flyer hidden>New flyer today</span></span><span class="store-card-name">${esc(s.name)}</span><span class="store-card-why">${vegText(esc(r.reason), esc(r.veg.reason))}</span><span class="store-card-n">${vegText(dealCounts(mine), dealCounts(veg))}</span></span>${ic("chevron")}</a></h3>
  <ul class="deals">${rows.join("\n")}</ul>
  <a class="see-all" href="${url(`stores/${s.id}/#deals`)}">${vegText(`See all ${mine.length} at ${esc(s.name)}`, `See all ${plural(veg.length, "vegetarian deal")} at ${esc(s.name)}`)}</a>
</li>`;
}

function homePage() {
  const items = analyzed.get(latest.week);
  const end = EDITION_END;
  const veg = items.filter(isVegetarian);
  // This week only counts and shows sales still on, as in the app (FeedStore.live): an ended
  // sale stays in the week until its store's next flyer, faded on store, aisle and search
  // pages, but it's no use at the top. `items` still gives each row its place in the week.
  const live = items.filter((i) => !isEnded(i));
  const liveVeg = live.filter(isVegetarian);
  const standouts = live.filter((i) => i.a.tier === "standout");
  const vegStandouts = standouts.filter(isVegetarian);
  // The picks for everyone, plus the vegetarian picks, so the section stays full when
  // "Vegetarian" is on. data-hl says which list a row belongs to.
  const hlAll = topPicks(standouts);
  const hlVeg = topPicks(vegStandouts);
  const best = standouts.filter((i) => hlAll.includes(i) || hlVeg.includes(i));
  const read = latest.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
  const soonPool = items.filter((i) => i.valid_through).slice(0, 60);
  // Stores with deals, best first by rank score (app.js reorders for Your stores and Vegetarian).
  // A store whose listed sales have all ended drops out until its next flyer.
  const shops = [...new Set(live.map((i) => i.store))].map((id) => cfg.storeById[id])
    .sort((a, b) => RANKS[b.id].score - RANKS[a.id].score);
  // Every store someone can pick (ones the routine reads), and the ones with no deals listed this week (their flyer
  // couldn't be read, or hasn't changed): picked ones still show, with a link to their ad.
  const pickable = cfg.stores.filter((s) => s.active && !s.no_online_flyer && latest.flyers.some((f) => f.store === s.id)).sort((a, b) => a.name.localeCompare(b.name));
  const unread = pickable.filter((s) => !RANKS[s.id]);
  const edition = fmtDate(latest.week, { weekday: false });
  // People are adding: the top three from /api/popular.json (ids are "<store>-<rank>").
  const adding = (POPULAR.items ?? []).map((p) => {
    const rank = +p.deal_id.slice(p.deal_id.lastIndexOf("-") + 1);
    return { i: items[rank], rank, store: p.deal_id.slice(0, p.deal_id.lastIndexOf("-")), people: p.people };
  }).filter((a) => a.i && a.i.store === a.store && !isEnded(a.i)).slice(0, 3);

  const body = `<div class="wrap page-h page-h-home">
  <h1>This week</h1>
  <p class="page-intro">Sales at Seattle's Asian markets, seafood shops and co-ops, the stores the big apps skip, read from each store's own flyer.</p>
  <p class="page-sub">${vegText(plural(live.length, "deal"), plural(liveVeg.length, "vegetarian deal"))} from ${plural(storeCount(live), "store")}</p>
</div>
${controls({ stores: storesIn(items), searchLabel: "Search this week's deals and stores" })}
<div class="wrap" data-filterable>
<div data-home>
<div class="edition" data-edition data-week="${latest.week}">
  <div class="card edition-card edition-fresh" data-edition-fresh hidden>
    ${buddy("happy", 64, "bd-hop")}
    <div class="edition-text"><h2 class="edition-t">Fresh off the press</h2><p class="edition-d">The ${esc(edition)} edition: ${vegText(plural(items.length, "deal"), plural(veg.length, "vegetarian deal"))} from ${plural(read, "store")}.</p></div>
    <button type="button" class="icon-btn" data-edition-dismiss aria-label="Got it, hide this note">${ic("close")}</button>
  </div>
</div>
${seasonStories()}
<section class="block yours" data-yours aria-labelledby="h-yours">
  <div class="sec-h"><h2 id="h-yours" data-yours-title>Best stores this week</h2><p data-yours-sub>Pick your stores to rank just those</p></div>
  <details class="card yours-pick" data-yours-pick>
    <summary><span class="yours-pick-t"><span class="yours-pick-h">Your stores</span><span class="yours-pick-names" data-yours-names>None picked yet</span></span><span class="badge tone-accent">Edit</span></summary>
    <fieldset class="pick-grid"><legend class="sr-only">Your stores</legend>
${pickable.map((s) => `      <label class="pick"><input type="checkbox" value="${esc(s.id)}" data-pick-store><span><span class="pick-name">${esc(s.name)}</span><span class="pick-where">${esc(s.delivery && !s.locations.length ? "Delivers" : towns(s).slice(0, 3).join(", ") + (towns(s).length > 3 ? " and more" : ""))}</span></span></label>`).join("\n")}
    </fieldset>
    <p class="small">Saved in this browser only. The iPhone app keeps its own.</p>
  </details>
  <div class="card quiet-note" data-quiet-note hidden></div>
  <ul class="store-cards" data-rank-list>${shops.map((s) => storeCard(s, items, hlAll, hlVeg)).join("\n")}</ul>
  <ul class="unread-cards" data-unread-list>${unread.map((s) => {
    const f = latest.flyers.find((x) => x.store === s.id);
    const ad = s.flyer_url ?? f?.links?.[0]?.url ?? s.website;
    return `<li class="unread-card" data-unread-card="${esc(s.id)}" hidden><span><b>${esc(s.name)}</b><span class="small">${f?.status === "stale" ? "Its new flyer isn't up yet." : "We couldn't read this week's flyer."}</span></span>${ad ? `<a href="${esc(ad)}" rel="noopener">Their ad</a>` : ""}</li>`;
  }).join("")}</ul>
  <div class="elsewhere" data-elsewhere hidden>
    <div class="sec-h"><h3 class="sec-label">Elsewhere this week</h3><p>Not one of your stores, but clearly ahead</p></div>
    <ul class="store-cards" data-elsewhere-list></ul>
  </div>
  <a class="go" href="${url("stores/")}">All stores, flyers and the map</a>
</section>
<section class="block" aria-labelledby="h-best">
  <div class="sec-h"><h2 id="h-best">Best single deals</h2><p>Any store · ${vegText(`${standouts.length} standouts in all`, `${vegStandouts.length} vegetarian standouts`)}</p></div>
  <ul class="deals deals-2">${best.map((i) => dealRow(i, items.indexOf(i), { why: true }).replace('<li class="deal" ', `<li class="deal" data-hl="${(hlAll.includes(i) ? "a" : "") + (hlVeg.includes(i) ? "v" : "")}" `)).join("\n")}</ul>
  <a class="go" href="${url("standouts/")}">See all ${vegText(`${standouts.length} standouts`, `${vegStandouts.length} vegetarian standouts`)}</a>
</section>
${adding.length ? `<section class="block" aria-labelledby="h-adding"${adding.some((a) => isVegetarian(a.i)) ? "" : " data-meat-only"}>
  <div class="sec-h"><h2 id="h-adding">People are adding</h2><p>this week</p></div>
  <ul class="deals deals-2">${adding.map((a) => dealRow(a.i, a.rank, { people: a.people })).join("\n")}</ul>
</section>` : ""}
${soonPool.length ? `<section class="block ending" data-ending hidden aria-labelledby="h-end">
  <div class="sec-h"><h2 id="h-end">Ending soon</h2><p>Last chance</p></div>
  <ul class="mini">${soonPool.map((i) => `<li data-ends="${i.valid_through}" data-veg="${isVegetarian(i) ? 1 : 0}" data-store="${esc(i.store)}" hidden><span>${esc(i.item)} <a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a></span> <span class="mini-price">${esc(priceText(i))} <span class="badge tone-warn ends-when" data-ends-label></span></span></li>`).join("")}</ul>
</section>` : ""}
<section class="block" aria-labelledby="h-dep">
  <div class="sec-h"><h2 id="h-dep">Shop by aisle</h2></div>
  <ul class="tiles">${CATS.filter((c) => items.some((i) => i.category === c)).map((c) => deptTile(c, items)).join("\n")}</ul>
</section>
</div>
<div data-results hidden>
  ${countLine()}
  ${grouped(items)}
  ${emptyLine("Try a shorter word or a store name.")}
</div>
</div>`;
  const home = cfg.site.origin + cfg.site.base_path;
  write("", page({ title: "", path: "", body, wrap: false, pageId: "home",
    ogTitle: "Seattle Grocery Deals: this week's sales, sorted",
    description: `${plural(live.length, "sale")} this week at ${storeCount(live)} Seattle Asian markets, seafood shops and co-ops. Top picks: ${pickList(hlAll, 3, {}, DESC_MAX - 100)}.`,
    jsonld: [
      { "@context": "https://schema.org", "@type": "WebSite", name: cfg.site.title, alternateName: ["SGD", "seattlegrocery.deals"], url: home, description: cfg.site.tagline, inLanguage: "en-US" },
      { "@context": "https://schema.org", "@type": "Organization", name: cfg.site.title, url: home, logo: `${home}assets/logo-512.png`, sameAs: [cfg.site.repo_url] },
    ] }));
}

// ---------- list pages ----------

function listPage({ path, section, title, h1, sub, items, crumbsHtml = "", group = true, why = true, empty, description, placeholder }) {
  const body = `<div class="wrap">${crumbsHtml}${pageHead(h1, sub)}</div>
${controls({ stores: storesIn(items), sort: true, placeholder: placeholder ?? `Search ${title.toLowerCase()}`, searchLabel: `Search ${title.toLowerCase()}` })}
<div class="wrap list" data-filterable>
${countLine()}
${group ? grouped(items, { why }) : `<ul class="deals" data-sortable>${liveFirst(items).map((i) => dealRow(i, items.indexOf(i), { why })).join("\n")}</ul>`}
${emptyLine(empty)}
</div>`;
  write(path, page({ title, path, section, body, wrap: false, description }));
}

function departmentPages() {
  const items = analyzed.get(latest.week);
  const cats = CATS.filter((c) => items.some((i) => i.category === c));
  write("departments/", page({
    title: "Aisles", path: "departments/",
    description: `This week's Seattle grocery sales by aisle: ${cats.map((c) => `${CATEGORY_LABELS[c].toLowerCase()} (${items.filter((i) => i.category === c).length})`).join(", ")}.`,
    body: `${pageHead("Aisles", vegText(`${plural(items.length, "deal")} in ${plural(cats.length, "aisle")}`, `${plural(items.filter(isVegetarian).length, "vegetarian deal")} in ${plural(cats.length, "aisle")}`))}
<ul class="tiles">${standoutsTile(items)}
${cats.map((c) => deptTile(c, items)).join("\n")}</ul>`,
  }));
  for (const c of cats) {
    const list = items.filter((i) => i.category === c);
    const veg = list.filter(isVegetarian).length;
    listPage({
      path: `departments/${c}/`, section: "departments/", title: CATEGORY_LABELS[c], h1: esc(CATEGORY_LABELS[c]), items: list, group: false,
      crumbsHtml: crumbs(["departments/", "Aisles"]),
      sub: `${vegText(plural(list.length, "deal"), plural(veg, "vegetarian deal"))} this week, best first. Prices through each store's sale end date.`,
      empty: veg ? "Nothing matches these filters." : "No vegetarian deals here this week. Turn off Vegetarian to see them all.",
      description: `${plural(list.length, `${CATEGORY_LABELS[c].toLowerCase()} sale`)} this week at ${plural(storeCount(list), "Seattle store")}, best first: ${pickList(list, 3)}.`,
    });
  }
}

function standoutsPage() {
  const items = analyzed.get(latest.week).filter((i) => i.a.tier === "standout");
  listPage({
    path: "standouts/", section: "", title: "All standouts", h1: "All standouts", items, placeholder: "Search standouts",
    crumbsHtml: crumbs(["", "This week"]),
    sub: "Big drops from the regular price, prices well under the US average, the lowest we've listed, or hand-picked. <a href=\"" + url("about/#how") + "\">How deals are chosen</a>",
    empty: "No standouts match these filters.",
    description: `${plural(items.length, "standout sale")} at Seattle grocery stores this week, best first: ${pickList(items, 3)}.`,
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
  write("compare/", page({ title: "Compare stores", path: "compare/", body,
    description: groups.length ? `The same item at different Seattle stores this week, by price per pound or each: ${groups.slice(0, 5).map((g) => keyLabel(g.k).toLowerCase()).join(", ")} and more.` : "The same item at different Seattle stores, compared by price per pound or each." }));
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
    write(`weeks/${w.week}/`, page({ title: `Week of ${fmtDate(w.week, { weekday: false, year: true })}`, path: `weeks/${w.week}/`, section: "", body, wrap: false,
      description: `Seattle grocery sales for the week of ${fmtDate(w.week, { weekday: false, year: true })}: ${plural(w.items.length, "sale")} from ${plural(storeCount(w.items), "store")}. Past prices, kept for comparison.` }));
  }
  const rows = [...weeks].reverse().map((w) => {
    const items = analyzed.get(w.week);
    const stand = items.filter((i) => i.a.tier === "standout");
    const read = w.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
    return `<li><a href="${url(`weeks/${w.week}/`)}">${esc(fmtDate(w.week, { year: true }))}</a>
  <span class="muted">${items.length} items, ${stand.length} standouts, ${read} flyers read</span>
  ${stand.length ? `<div class="small">Top: ${stand.slice(0, 3).map((i) => `${esc(i.item)} at ${esc(storeName(i.store))}`).join("; ")}</div>` : ""}</li>`;
  });
  write("weeks/", page({ title: "Past weeks", path: "weeks/", section: "", description: "Every past week of Seattle grocery sales on the site, kept so prices can be compared over time.", body: `${pageHead("Past weeks", "Every week since the site started.")}\n<ul class="weeks">${rows.join("\n")}</ul>` }));
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
    description: `The Seattle-area grocery stores we list sales for, with a map: ${tracked.slice(0, 4).map((s) => s.name).join(", ")} and ${tracked.length - 4} more.`,
    body: `${pageHead("Stores", "The Asian markets, seafood shops and co-ops we read as each new flyer comes out, with the most standouts first. Each store is tracked by one general Seattle-area flyer; other locations may have different prices.")}
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
<p><a class="go" href="${esc(cfg.site.suggest_store_url)}">Suggest a store</a></p>`,
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
    // Where the weekly ad lives, in the app's order (Store.flyerLinkURL): this week's flyer page,
    // else the store's flyer page, else the first flyer link. Web addresses only.
    const adUrl = [f?.links?.find((l) => flyerKind(l.url) === "web")?.url, s.flyer_url, f?.links?.[0]?.url].find((u) => u && /^https?:/i.test(u)) ?? null;
    const readNow = f && (f.status === "full" || f.status === "partial");
    const starts = readNow && f.valid_from > TODAY ? `Starts ${fmtDate(f.valid_from).split(",")[0]}` : "";
    const adDetail = [`On ${s.name}${s.name.endsWith("s") ? "'" : "'s"} site`, starts || (readNow ? daysLeftText(f.valid_through) : "")].filter(Boolean);
    const sub = [
      towns.length ? esc(towns.join(" · ")) : s.locations.length ? "" : "Home delivery",
      f && (f.status === "full" || f.status === "partial") && f.valid_from ? `Sale ${esc(fmtDate(f.valid_from, { weekday: false }))} to ${esc(fmtDate(f.valid_through, { weekday: false }))}` : "",
    ].filter(Boolean).join(" &middot; ");
    const actions = `<div class="actions">
  ${adUrl && !s.no_online_flyer ? `<a class="ad-card" href="${esc(adUrl)}" rel="noopener"><span class="ad-ic">${ic("newspaper")}</span><span class="ad-t"><b>Weekly ad</b><span>${esc(adDetail[0])}${adDetail[1] ? `<span${readNow && !starts ? ` data-days-left="${f.valid_through}"` : ""}> &middot; ${esc(adDetail[1])}</span>` : ""}</span></span>${ext}</a>` : ""}
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
${mine.length ? `<div class="sec-h deals-h" id="deals"><h2>Deals this week</h2><p>${vegText(dealCounts(mine), dealCounts(mine.filter(isVegetarian)))}</p></div>` : !s.no_online_flyer ? emptyState({ mood: "sleepy", title: f && f.status === "unreadable" ? "Couldn't read this week's flyer" : "No deals this week", msg: adUrl ? "The weekly ad might still have something." : "Its new deals show up here as soon as its next flyer is out.", link: adUrl ? [esc(adUrl), "Open the weekly ad"] : [url(), "See this week's deals"] }) : ""}
</div>
${mine.length ? `${controls({ store: false, sort: true, placeholder: `Search ${s.name}`, searchLabel: `Search ${s.name}'s deals` })}
<div class="wrap list" data-filterable>
${countLine()}
${grouped(mine, { store: false })}
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
    const saleDates = f && (f.status === "full" || f.status === "partial") && f.valid_from ? ` (sale ${fmtDate(f.valid_from, { weekday: false })} to ${fmtDate(f.valid_through, { weekday: false })})` : "";
    const storeDesc = s.no_online_flyer
      ? `${s.about ?? `${s.name} is a Seattle-area market.`}${/flyer/i.test(s.about ?? "") ? "" : " It has no online flyer, so its prices aren't tracked here."}`
      : mine.length
        ? `${plural(mine.length, "sale")} at ${s.name} this week${saleDates}, best first: ${pickList(mine, 3, { store: false })}.`
        : `${s.name}${s.name.endsWith("s") ? "'" : "'s"} weekly ad and this week's sales${towns.length ? `, with stores in ${towns.join(", ")}` : ""}.`;
    write(`stores/${s.id}/`, page({ title: s.no_online_flyer ? s.name : `${s.name} weekly ad and sales`, ogTitle: s.no_online_flyer ? s.name : `${s.name} sales this week`, description: storeDesc,
      path: `stores/${s.id}/`, section: "stores/", body, wrap: false, map: s.locations.length > 0 }));
  }
}

// ---------- seasonal items ----------
// What's in season comes from KitchenCatalog (vendor/kitchen-catalog/seasons.json), how it looks
// from config/seasons.json. Every season gets a page at /<slug>/ all year (shared links keep
// working); the menu icon, footer link, home story and the app's card only show while it's on.

const SEASONS = loadSeasons(ROOT);
const SEASONS_NOW = SEASONS.filter((s) => seasonOn(s, latest.week));
const seasonWeek = (s, week) => seasonDeals(s, cfg, analyzed.get(week));
// Things a season's copy can say, for fill().
function seasonVars(s, d) {
  return { label: s.label, item: s.item, star: s.starLabel, each_oz: s.each_oz ?? "",
    price: d.best ? priceText(d.best) : "", store: d.best ? storeName(d.best.store) : "", stores_have: `${plural(d.stores, "store")} ${d.stores === 1 ? "has" : "have"}` };
}
// "$3.41/lb" for a per-each price, in the season's comparison unit.
const seasonAbout = (s, i) => `${money(seasonValue(s, i))}${PER_LABEL[s.compare_per] ?? "/" + s.compare_per}`;
function seasonValue(s, i) {
  const up = i.unit_price;
  if (up.per === s.compare_per) return up.value;
  if (up.per === "each" && s.compare_per === "lb" && s.each_oz) return up.value / (s.each_oz / 16);
  if (up.per === "lb" && s.compare_per === "each" && s.each_oz) return up.value * (s.each_oz / 16);
  return Infinity;
}
// The page's colors, light and dark, as CSS custom properties on body.season.
function seasonStyle(s) {
  // light-dark() pairs, so the display settings' Light and Dark themes apply here too.
  const ld = (k, i) => {
    const l = i === undefined ? s.colors.light[k] : s.colors.light[k][i];
    const d = i === undefined ? s.colors.dark[k] : s.colors.dark[k][i];
    return `light-dark(${l}, ${d})`;
  };
  return `<style>body.season{--season:${ld("main")};--season-text:${ld("text")};--season-soft:${ld("soft")};--season-ink:${ld("ink")};background:linear-gradient(${ld("bg", 0)}, ${ld("bg", 1)}) fixed}</style>`;
}

function seasonPage(s) {
  const d = seasonWeek(s, latest.week);
  const v = seasonVars(s, d);
  const best = d.best;
  const on = seasonOn(s, latest.week);
  const log = seasonLog(s, cfg, [...weeks].reverse().map((w) => ({ week: w.week, items: analyzed.get(w.week) })));
  const maxLog = Math.max(...log.map((l) => l.value), 1);
  const unit = PER_LABEL[s.compare_per] ?? "/" + s.compare_per;

  const hero = best
    ? `<section class="season-hero" aria-labelledby="best-h">
  <div class="season-mascot" data-bounce>${seasonBuddy(s.buddy, "happy", 160)}</div>
  <p class="season-kicker">${esc(fill(s.copy.kicker, v))}</p>
  <h2 id="best-h" class="season-price">${esc(priceText(best))}</h2>
  <p class="season-where">at <a href="${url(`stores/${best.store}/`)}">${esc(storeName(best.store))}</a>${best.valid_through ? `, through ${esc(fmtDate(best.valid_through))}` : ""}</p>
  <p class="season-item">${esc(best.item)}</p>
  ${best.valid_through ? `<p class="notice" data-expired-after="${best.valid_through}" hidden>This deal ended ${esc(fmtDate(best.valid_through))}. New ones show up here as soon as stores post them.</p>` : ""}
  ${d.perTen ? `<p class="season-math">That's about <strong>${d.perTen} ${esc(s.item)} for $10</strong>.<span class="muted"> ${esc(fill(s.copy.per_10_note, v))}</span></p>` : ""}
  ${best.notes ? `<p class="muted">${esc(best.notes)}</p>` : ""}
</section>`
    : `<section class="season-hero">
  <div class="season-mascot sad" data-bounce>${seasonBuddy(s.buddy, "sad", 160)}</div>
  <h2 class="season-price">${esc(fill(s.copy.none_title, v))}</h2>
  <p class="season-where">${esc(fill(s.copy.none_line, v))}</p>
</section>`;

  const runners = d.star.slice(1);
  const row = (i, about) => `<li><span>${esc(i.item)} <a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a></span><strong>${esc(priceText(i))}${about && i.unit_price.per !== s.compare_per && isFinite(seasonValue(s, i)) ? `<span class="muted small"> (about ${esc(seasonAbout(s, i))})</span>` : ""}</strong></li>`;
  const body = `<div class="season-sky" data-season-sky aria-hidden="true"></div>
<div class="season-page">
<p class="season-eyebrow">${esc(fill(on ? s.copy.eyebrow : s.copy.eyebrow_after, v))}. Week of ${esc(fmtDate(latest.week, { weekday: false, year: true }))}.</p>
<h1 class="season-title">Where to buy <span>${esc(s.item)}</span> this week</h1>
${hero}
${runners.length ? `<section><h2>${esc(fill(s.copy.also_title, v))}</h2><ul class="season-list">${runners.map((i) => row(i, true)).join("")}</ul></section>` : ""}
${d.others.length ? `<section><h2>${esc(fill(s.copy.others_title, v))}</h2>${s.copy.others_note ? `<p class="sub">${esc(fill(s.copy.others_note, v))}</p>` : ""}<ul class="season-list">${d.others.map((i) => row(i, false)).join("")}</ul></section>` : ""}
${log.length ? `<section><h2>${esc(fill(s.copy.log_title, v))}</h2><p class="sub">${esc(fill(s.copy.log_note, v))}</p>
<ol class="season-log">${log.map((l) => `<li><span class="pl-week">${esc(fmtDate(l.week, { weekday: false }))}</span><span class="pl-bar" style="--w:${Math.round((l.value / maxLog) * 100)}%"><span>${l.about ? "about " : ""}${esc(money(l.value))}${unit}</span></span><span class="pl-store">${esc(storeName(l.deal.store))}</span></li>`).join("")}</ol></section>` : ""}
${s.facts.length ? `<section class="season-facts"><h2>${esc(fill(s.copy.facts_title, v))}</h2>
<ul>
${s.facts.map((f) => `  <li>${esc(f).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`).join("\n")}
</ul></section>` : ""}
<p class="season-foot">${esc(fill(s.copy.foot, v))} <a href="${url()}">Back to all the deals</a></p>
</div>
<template data-season-svg>${seasonIcon(s.buddy)}</template>`;
  const live = best && (!best.valid_through || best.valid_through >= TODAY);
  write(`${s.slug}/`, page({ title: `Where to buy ${s.item} this week`, path: `${s.slug}/`, body,
    description: fill(live ? s.copy.share_text : s.copy.share_text_none, v),
    ogTitle: fill(live ? s.copy.share_title : s.copy.share_title_none, v),
    image: s.og_image, imageAlt: s.og_alt ?? "", extraScript: "assets/seasons.js", bodyClass: `season season-${s.id}`, head: seasonStyle(s) }));
}

// The home page's "In season" story for each season that's on and has its star kind on sale.
function seasonStories() {
  return SEASONS_NOW.map((s) => {
    const d = seasonWeek(s, latest.week);
    // No card once its headline sale has ended; it's back when the week has another.
    if (!d.best || isEnded(d.best)) return "";
    // As the app's SeasonCard: "Fuyu $1.28/lb at T&T Supermarket", then "Through Thu · 6 stores
    // have them". The X hides it for this season (app.js, sgd.hiddenSeasons); the buddy in the
    // top bar still opens the page.
    const through = d.best.valid_through ? `Through ${fmtDate(d.best.valid_through).split(",")[0]}` : "";
    const detail = [through, d.stores > 1 ? `${d.stores} stores have them` : ""].filter(Boolean).join(" · ");
    return `<section class="card story" data-season-card="${esc(s.id)}" aria-labelledby="h-story-${s.id}">
  ${seasonBuddy(s.buddy, "happy", 72)}
  <div class="story-text">
  <p class="kicker">${esc(fill(s.copy.name, seasonVars(s, d)))}</p>
  <h2 id="h-story-${s.id}">${esc(s.starLabel ?? s.label)} ${esc(priceText(d.best))} at ${esc(storeName(d.best.store))}</h2>
  ${detail ? `<p class="story-d">${esc(detail)}</p>` : ""}
  <p><a class="go" href="${url(`${s.slug}/`)}">Where to buy ${esc(s.item)} this week</a></p>
  </div>
  <button type="button" class="icon-btn story-x" data-season-hide="${esc(s.id)}" aria-label="Hide ${esc(fill(s.copy.name, seasonVars(s, d)))} for this season">${ic("close")}</button>
</section>`;
  }).join("\n");
}

// What the app needs for each season that's on: deals by id (the app reuses its rows and sheet),
// the price log and the copy. Listed even with nothing on sale (best: null), so the app decides.
function seasonFeed(feedIds) {
  return SEASONS_NOW.map((s) => {
    const d = seasonWeek(s, latest.week);
    const v = seasonVars(s, d);
    const id = (i) => feedIds.get(i);
    const log = seasonLog(s, cfg, weeks.map((w) => ({ week: w.week, items: analyzed.get(w.week) }))).slice(-12);
    const unit = PER_LABEL[s.compare_per] ?? "/" + s.compare_per;
    const about = Object.fromEntries([...d.star, ...d.others].filter((i) => i.unit_price.per !== s.compare_per && isFinite(seasonValue(s, i))).map((i) => [id(i), seasonAbout(s, i)]));
    return {
      id: s.id, label: s.label, name: fill(s.copy.name, v), item: s.item, star: s.star?.label ?? null, buddy: s.buddy ?? null,
      url: `${cfg.site.origin}${cfg.site.base_path}${s.slug}/`, from: s.from, to: s.to, ends: seasonEnd(s, latest.week),
      tint: { light: s.colors.light.main, dark: s.colors.dark.main },
      best: d.best ? id(d.best) : null, also: d.star.slice(1).map(id), other: d.others.map(id), stores: d.stores,
      about, compare_per: s.compare_per, per_10: d.perTen, per_10_note: d.perTen ? fill(s.copy.per_10_note, v) : null,
      log: log.map((l) => ({ week: l.week, value: Math.round(l.value * 100) / 100, text: `${l.about ? "about " : ""}${money(l.value)}${unit}`, store: l.deal.store, about: l.about })),
      words: s.words, tagline: s.tagline ?? null, facts: s.facts,
      share: fill(d.best ? s.copy.share_title : s.copy.share_title_none, v),
      // The page's lines, filled in, so the app's season screen reads like the web page.
      copy: Object.fromEntries(["kicker", "none_title", "none_line", "also_title", "others_title", "others_note", "log_title", "log_note", "facts_title", "foot"]
        .map((k) => [k, s.copy[k] ? fill(s.copy[k], v) : null])),
    };
  });
}

// The list, kept in this browser (app.js draws it from localStorage). Like the app's List tab,
// with ways to get it into Reminders: copy it (pasted lines become separate reminders), send it
// to a Shortcut that adds each line, or share it.
// Copy list (works in every browser) and Share (where the browser has it), with a status line.
const listTools = () => `<div class="list-tools" data-list-tools hidden>
  <button type="button" class="btn btn-primary" data-list-copy>${ic("copy")}<span>Copy list</span></button>
  <button type="button" class="btn" data-list-share hidden>${ic("share")}<span>Share</span></button>
</div>
<p class="list-status" data-list-status role="status"></p>`;

// The floating List button, lower right on every page but the List page, and its panel: the
// same list as /list/, checkable, with Copy and Share.
const LIST_FAB = () => `<button type="button" class="list-fab" data-list-fab popovertarget="list-panel" aria-label="Your list">${ic("list")}<span class="list-fab-t">List</span><span class="list-fab-n" data-list-count hidden></span></button>
<div id="list-panel" class="list-panel" popover role="dialog" aria-labelledby="list-panel-title" data-list-view>
  <div class="dp-head"><h2 id="list-panel-title">Your list</h2><button type="button" class="dp-close" popovertarget="list-panel" popovertargetaction="hide" aria-label="Close your list"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>
  ${listTools()}
  <div data-list-body></div>
  <div data-list-empty hidden><p class="list-empty-small">Tap + on any deal to add it here. Your list stays in this browser.</p></div>
  <p class="list-panel-foot"><a class="go" href="${url("list/")}">Open the full list</a></p>
</div>`;

function yourListPage() {
  const body = `<div data-list-view>
${pageHead("Your list", "Tap + on any deal to add it. Saved in this browser only.")}
<form class="list-add" data-list-add><label class="sr-only" for="list-new">Add something not on sale</label><input id="list-new" type="text" placeholder="Add something else, like eggs" autocomplete="off" maxlength="120"><button type="submit" class="btn">${ic("plus")}<span>Add</span></button></form>
${listTools()}
<div data-list-body></div>
<div data-list-empty hidden>${emptyState({ mood: "happy", title: "Your list is empty", msg: "Tap + on a deal and it shows up here, with its price, store and when the sale ends.", link: [url(), "See this week's deals"] })}</div>
<div class="list-foot" data-list-foot hidden>
  <button type="button" class="btn" data-list-clear-done>Clear checked</button>
  <button type="button" class="btn" data-list-clear-ended hidden>Remove ended deals</button>
</div>
<p class="list-note">To put it in Reminders: <b>Copy list</b>, then paste into a list in the Reminders app. Each line becomes its own reminder, on a Mac, iPhone or iPad.</p>
</div>`;
  write("list/", page({ title: "Your list", path: "list/", body, noindex: true, bodyClass: "page-list", description: "Your grocery list from this week's Seattle sales, saved in your browser." }));
}

function aboutPage() {
  const c = cfg.criteria;
  const body = `<div class="page-h"><h1>About</h1></div>
<p>As each store posts its new flyer, this site lists what's on sale at Seattle's Asian markets, seafood shops, co-ops and specialty grocers, so you can see what's cheap where and plan where to shop. It links to every store's flyer for the week.</p>
<p>There's an iPhone app on the way, with the same deals, a list that fills itself and alerts you choose: <a href="${url("app/")}">about the app</a>.</p>${cfg.site.mcp_url ? `
<p>You can also ask an AI assistant like Claude what's on sale: <a href="${url("mcp/")}">connect it to this site</a>.</p>` : ""}
<p>Curious how a flyer gets from a store's website to this page? <a href="${url("how-it-works/")}">How it works</a>.</p>
<h2>Which stores</h2>
<p>The big chains, such as Safeway, QFC, Fred Meyer, Albertsons, Costco, Walmart and Target, are left out on purpose. Their own apps already show their deals. This site covers the stores those apps skip.</p>
<p>A store is included when it:</p>
<ul>
  <li>publishes a weekly flyer or specials page online;</li>
  <li>is not a mainstream supermarket, discount or big-box chain; and</li>
  <li>sells something that's hard to find at those chains, such as a cuisine, a specialty like seafood, or co-op produce.</li>
</ul>
<h2>What's listed</h2>
<p>Groceries for cooking: produce, meat, seafood, dairy and eggs, tofu, pantry staples and bread, from every flyer that could be read. Snacks, drinks, frozen desserts and ready-made meals like frozen pizza and instant noodles are left out. Prices are never guessed. Anything that could not be read clearly is left out, and regular prices or percent off appear only when the store printed them.</p>
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
<p>The data is public: <a href="${url("data/weeks/")}">weekly JSON files</a> and the <a href="${url("schema/week.schema.json")}">schema</a>.</p>
<h2>Accessibility</h2>
<p>The site aims for WCAG 2.2 AA and has display settings for theme, text size, contrast, font, spacing, motion and links. More on the <a href="${url("accessibility/")}">accessibility page</a>.</p>`;
  write("about/", page({ title: "About", path: "about/", body, description: "How Seattle Grocery Deals reads Seattle grocery flyers, how standouts are chosen, and what the site does and doesn't collect." }));
}

// Accessibility statement, linked from the footer and the About page.
function accessibilityPage() {
  const report = `${esc(cfg.site.repo_url)}/issues/new?title=Accessibility%3A+`;
  const body = `${pageHead("Accessibility", "Seattle Grocery Deals should work for everyone, however you read the web. What's built in, the settings you can change, and how to report a problem.")}
<h2>The goal</h2>
<p>The site aims to meet the <a href="https://www.w3.org/TR/WCAG22/">Web Content Accessibility Guidelines (WCAG) 2.2</a> at level AA. It hasn't been formally audited yet, so treat this as what it's working toward, not a certificate.</p>
<h2>What's built in</h2>
<ul>
  <li><strong>A typeface made for reading.</strong> Everything is set in <a href="https://www.brailleinstitute.org/freefont/">Atkinson Hyperlegible Next</a>, designed by the Braille Institute for readers with low vision.</li>
  <li><strong>Readable color.</strong> Text meets AA contrast in light and dark mode.</li>
  <li><strong>Color is never the only signal.</strong> Every highlight pairs its color with a word or shape: Standout, "% off" and "under US avg" are spelled out.</li>
  <li><strong>Prices that read well aloud.</strong> Screen readers hear "per pound" and "each" instead of "/lb" and "ea".</li>
  <li><strong>Keyboard first.</strong> Everything works with a keyboard, focus is always visible, and a "Skip to content" link appears on your first Tab.</li>
  <li><strong>Room to tap.</strong> Buttons and links are at least 44 pixels tall.</li>
  <li><strong>Your device's settings, followed.</strong> Light or dark mode, reduced motion and increased contrast follow your system preferences.</li>
  <li><strong>Text that scales.</strong> You can zoom to 200% or more without losing anything.</li>
</ul>
<h2>Display settings</h2>
<p>The round button in the bottom left corner of every page opens display settings. You can change:</p>
<ul>
  <li><strong>Theme:</strong> follow your device, or always light or always dark</li>
  <li><strong>Text size:</strong> default, large or larger</li>
  <li><strong>Contrast:</strong> follow your device, standard, or more</li>
  <li><strong>Font:</strong> keep Atkinson Hyperlegible, or use your device's own font</li>
  <li><strong>Spacing:</strong> wider line, letter and word spacing</li>
  <li><strong>Motion:</strong> turn off animations even if your device allows them</li>
  <li><strong>Links:</strong> underline every link</li>
</ul>
<p>Your choices are saved in this browser only. They aren't sent anywhere, and Reset puts everything back. These are extras, not fixes: the site should work well without them, and it doesn't use an accessibility overlay.</p>
<h2>Known limits</h2>
<ul>
  <li>The store map is harder to use with a screen reader or keyboard. Every store's addresses are also listed in text on its store page.</li>
  <li>Store flyers are linked, not copied. They're the stores' own pages and PDFs and may not meet the same standard.</li>
</ul>
<h2>Report a problem</h2>
<p>If something here gets in your way, <a href="mailto:hello@seattlegrocery.deals?subject=Accessibility">email hello@seattlegrocery.deals</a> with the page and what happened. You'll hear back within a week. If you'd rather, you can also <a href="${report}">open an issue on GitHub</a>.</p>`;
  write("accessibility/", page({ title: "Accessibility", path: "accessibility/", section: "about/", body, description: "How Seattle Grocery Deals is built to work for everyone, the display settings you can change, and how to report a problem." }));
}

// The iPhone app, before it's on the App Store, at /app/ (it was /apps/, which now redirects).
// Laid out like henwood.app: the buddy, the name, one line, the badge, then a few cards.
// The badge is Apple's own, unchanged and not a link (there's no store page yet); "Coming soon"
// sits beside it in plain text so nobody, sighted or not, takes it for a download.
// Screenshots are off for now; captures stay in site/assets/img/app/ for later.
function appsPage() {
  const features = [
    ["newspaper", "This week, sorted", "The same deals as this site, with the best stores to shop this week first. Browse by aisle, search across stores, or hide meat and seafood with Vegetarian."],
    ["storefront", "Best of your stores", "Pick the stores you actually shop at and This week ranks just those, so you know where to go. Each one links to its weekly ad."],
    ["list", "A list that knows the sale", "Tap + on a deal and it goes on your list with the price, the store and the day the sale ends. Keep it in the app, or in a Reminders list you already share."],
    ["bell", "Alerts you choose", "New deals, a sale about to end, or something you're watching getting cheaper. Each one is off until you turn it on."],
    ["widget", "Widget and Siri", "Best This Week on your Home Screen. Ask Siri what's on sale, or add to your list without opening the app."],
  ];
  const body = `<div class="app-landing">
  ${buddy("happy", 160, "bd-hop")}
  <h1>Seattle Grocery Deals</h1>
  <p class="app-tag">This week's grocery sales, in your pocket.</p>
  <p class="app-badge"><img src="${url("assets/img/app-store-black.svg")}" alt="Download on the App Store" width="132" height="44"><span class="badge tone-neutral app-soon">Coming soon</span><span class="sr-only">The app isn't on the App Store yet. Check back here.</span></p>
  <p class="app-platforms">For iPhone and iPad</p>
  <ul class="app-features">${features.map(([icon, title, text]) => `<li class="card app-feature">${ic(icon)}<div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></li>`).join("")}</ul>
  <p class="app-note">No account, and your list stays on your phone. More in <a href="${url("about/")}#privacy">About</a>.</p>
  <p class="app-note">Everything in the app is on this site too. <a class="go" href="${url()}">See this week's deals</a></p>
</div>`;
  write("app/", page({ title: "iPhone app", path: "app/", section: "app/", body, description: "The Seattle Grocery Deals app for iPhone and iPad: this week's deals, the best of your stores, a list that knows the sale, and alerts you choose. Coming soon." }));
  // The old address.
  const to = url("app/");
  write("apps/", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>iPhone app</title><link rel="canonical" href="${esc(cfg.site.origin + to)}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${to}"></head><body><p><a href="${to}">The iPhone app has moved here.</a></p></body></html>`);
}

// For AI assistants, at /mcp/: what the site's MCP server is (mcp/ in this repo, a Cloudflare
// Worker at config/site.json's mcp_url), a button that opens Claude's "add connector" dialog
// with the name and address filled in, and the address to copy for any other assistant. A
// browser that opens the server's own address is sent here (mcp/src/index.js).
// The Claude link is not a documented format (2026-11-11): if it stops opening the dialog,
// the address and the written steps still work.
function mcpPage() {
  const address = cfg.site.mcp_url;
  if (!address) return;
  const claude = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(cfg.site.title).replace(/%20/g, "+")}&connectorUrl=${encodeURIComponent(address)}`;
  const asks = [
    "What's on sale this week, and where should I shop?",
    "Who has chicken thighs on sale?",
    "I need salmon, tofu, bok choy and apples. Which one store has the most of that on sale?",
    "What are the best produce deals at Uwajimaya?",
    "I'm cooking vegetarian this week. Which store has the best deals?",
    "Plan three dinners around what's cheap at H Mart.",
  ];
  // The stores the server knows (the same ones the feed lists), for the "your stores" picker.
  // Picking some adds them to the address (?stores=a,b), which is how the server learns them:
  // it keeps nothing itself. app.js fills the picker from this site's own Your stores.
  const pickable = cfg.stores.filter((s) => s.active && !s.no_online_flyer).sort((a, b) => a.name.localeCompare(b.name));
  const body = `<div class="mcp-page">
<div class="mcp-top">
  ${buddy("happy", 112)}
  <div>
    <h1>Ask your AI assistant what's on sale</h1>
    <p class="lede">Connect Claude or another AI assistant to this site and it can look through this week's flyers for you: which stores have a good week, who has what you need, and when each sale ends.</p>
  </div>
</div>
<h2 id="mcp-stores-h">Where do you shop?</h2>
<p>Pick your stores and your assistant will rank the week for them, and choose one of them for a shopping list. Leave them all off to hear about every store.</p>
<fieldset class="pick-grid mcp-stores" aria-labelledby="mcp-stores-h" data-mcp-stores>
${pickable.map((s) => `  <label class="pick"><input type="checkbox" value="${esc(s.id)}"><span><span class="pick-name">${esc(s.name)}</span></span></label>`).join("\n")}
</fieldset>

<p class="mcp-add"><a class="btn btn-primary" href="${esc(claude)}" data-mcp-add data-mcp-name="${esc(cfg.site.title)}">Add to Claude</a></p>
<p class="page-sub">Opens Claude with the name and address filled in. Nothing is added until you say so there.</p>

<h2>Any other assistant</h2>
<p>It works with any assistant that can connect to a remote MCP server (MCP is the common way to give an assistant new tools). Wherever it asks for a connector or server address, paste this one:</p>
<p class="mcp-addr"><code data-mcp-address="${esc(address)}">${esc(address)}</code><button type="button" class="btn" data-copy="${esc(address)}">${ic("copy")}<span>Copy address</span></button><span class="muted" role="status" data-copy-status></span></p>
<p>If you picked stores above, they are part of the address. You can also just tell your assistant where you shop.</p>
<p>In Claude, that's Customize, then Connectors, then Add custom connector.</p>

<h2>Things to ask</h2>
<ul class="mcp-asks">${asks.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>

<h2>What it can look up</h2>
<ul>
  <li><strong>This week at a glance:</strong> every store ranked by how good its week is, the best single deals, and what's in season.</li>
  <li><strong>One store for your list:</strong> which single store has the most of what you need on sale, so it's one trip.</li>
  <li><strong>A search of the deals:</strong> by ingredient, store or aisle, standouts only, or vegetarian only. Sales that have ended are left out.</li>
  <li><strong>The stores:</strong> what each one is, where it is, its flyer dates and a link to its weekly ad.</li>
</ul>
<p>It's the same information as this site, from the same flyers. It can't order anything or change anything.</p>

<h2>Good to know</h2>
<ul>
  <li>It's free, with no account or sign-in.</li>
  <li>It keeps nothing about you or what you ask. Your stores, if you pick any, travel in the address or in what your assistant sends; they aren't saved here. Your assistant has its own privacy rules for your conversations.</li>
  <li>Prices come from store flyers and can change, sell out or differ by location. Check in store before you rely on one.</li>
  <li>It covers the Seattle-area stores on <a href="${url("stores/")}">the Stores page</a> and nothing else. This site is not affiliated with any store.</li>
</ul>
</div>`;
  write("mcp/", page({
    title: "For AI assistants", path: "mcp/", section: "mcp/", body,
    description: "Connect Claude or another AI assistant to Seattle Grocery Deals and ask what's on sale this week, who has what you need, and where to shop.",
    ogTitle: "Ask your AI assistant what's on sale in Seattle",
    image: "assets/img/og-mcp.png",
    imageAlt: "Seattle Grocery Deals for AI assistants: the crow with his coin beside the question \"Who has chicken thighs on sale this week?\"",
  }));
}

// The diagram at the top of How it works: the same parts drawn twice from one list, wide
// (three columns) for big screens and tall (one column, then two) for phones, so there is no
// sideways scrolling and the text stays readable. Colors come from the site's CSS (.how-map).
// The gold numbers match the page's steps. Both drawings are decorative to screen readers:
// the figure has one label and the steps below say the same thing in words.
function howMap() {
  const nodes = {
    flyers: ["Store flyers", "Each store's own website", 1],
    watcher: ["Flyer watcher", "GitHub Actions, every 30 min", 2],
    reader: ["Flyer reader", "Claude Code routine", 3],
    data: ["Week data file", "One file per week, on GitHub", 4],
    build: ["Build", "GitHub Actions, checks first", 5],
    pages: ["Website and feed", "GitHub Pages", 0, "Site and feed"],
    push: ["Notifications", "Firebase, then Apple", 6],
    browser: ["This site", "In your browser"],
    app: ["The app", "iPhone and iPad"],
    mcp: ["Assistant server", "Cloudflare Worker"],
    ai: ["AI assistants", "Claude and others"],
    amp: ["Counting", "Amplitude, private"],
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  const draw = (key, W, H, boxes, edges, labels, t) => {
    const b = (id) => boxes[id];
    const cx = (id, off = 0) => b(id).x + b(id).w / 2 + off;
    const pt = { cx, top: (id) => b(id).y, bot: (id) => b(id).y + b(id).h, left: (id) => b(id).x, right: (id) => b(id).x + b(id).w, cy: (id) => b(id).y + b(id).h / 2 };
    const lines = edges(pt).map(([cls, pts]) => `<polyline class="hm-e hm-${cls}" points="${pts.map((p) => p.map((n) => r2(n)).join(",")).join(" ")}" marker-end="url(#hm-${key}-${cls === "hot" ? "hot" : "plain"})"/>`).join("");
    const rects = Object.entries(boxes).map(([id, { x, y, w, h }]) => {
      const [long, sub, n, short] = nodes[id];
      const title = (key === "tall" && short) || long;
      return `<rect class="hm-box${n ? " hm-stop" : ""}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${t.rx}"/>`
        + `<text class="hm-t" x="${x + t.pad}" y="${y + t.ty}" font-size="${t.title}">${esc(title)}</text>`
        + `<text class="hm-s" x="${x + t.pad}" y="${y + t.sy}" font-size="${t.sub}">${esc(sub)}</text>`
        + (n ? `<circle class="hm-coin" cx="${x + 2}" cy="${y + 2}" r="${t.coin}"/><text class="hm-n" x="${x + 2}" y="${y + 2 + t.coin * 0.38}" font-size="${t.coin * 1.15}" text-anchor="middle">${n}</text>` : "");
    }).join("");
    const notes = labels(pt).map(([x, y, text, anchor = "start"]) => `<text class="hm-l" x="${r2(x)}" y="${r2(y)}" font-size="${t.sub}" text-anchor="${anchor}">${esc(text)}</text>`).join("");
    const head = (id, cls) => `<marker id="hm-${key}-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="${t.arrow}" markerHeight="${t.arrow}" orient="auto"><path class="${cls}" d="M0 0L10 5L0 10z"/></marker>`;
    return `<svg class="how-map-${key}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false"><defs>${head("hot", "hm-head-hot")}${head("plain", "hm-head")}</defs>${lines}${rects}${notes}</svg>`;
  };

  // Wide: three columns, five rows. The route snakes right, then left, then fans out.
  const wide = (() => {
    const w = 250, h = 64, col = (c) => 14 + c * 303, row = (r) => 16 + r * 116;
    const at = (c, r) => ({ x: col(c), y: row(r), w, h });
    const boxes = { flyers: at(0, 0), watcher: at(1, 0), reader: at(2, 0), push: at(0, 1), build: at(1, 1), data: at(2, 1), pages: at(1, 2), app: at(0, 3), browser: at(1, 3), mcp: at(2, 3), amp: at(1, 4), ai: at(2, 4) };
    const edges = (p) => {
      const bus = (p.bot("pages") + p.top("browser")) / 2, low = (p.bot("app") + p.top("amp")) / 2;
      return [
        ["plain", [[p.cx("pages"), bus], [p.cx("mcp"), bus], [p.cx("mcp"), p.top("mcp")]]],
        ["plain", [[p.cx("pages"), p.bot("pages")], [p.cx("browser"), p.top("browser")]]],
        ["plain", [[p.cx("mcp"), p.bot("mcp")], [p.cx("ai"), p.top("ai")]]],
        ["soft", [[p.cx("app"), p.bot("app")], [p.cx("app"), low], [p.cx("amp", -45), low], [p.cx("amp", -45), p.top("amp")]]],
        ["soft", [[p.cx("browser", 45), p.bot("browser")], [p.cx("amp", 45), p.top("amp")]]],
        ["hot", [[p.right("flyers"), p.cy("flyers")], [p.left("watcher"), p.cy("watcher")]]],
        ["hot", [[p.right("watcher"), p.cy("watcher")], [p.left("reader"), p.cy("reader")]]],
        ["hot", [[p.cx("reader"), p.bot("reader")], [p.cx("data"), p.top("data")]]],
        ["hot", [[p.left("data"), p.cy("data")], [p.right("build"), p.cy("build")]]],
        ["hot", [[p.left("build"), p.cy("build")], [p.right("push"), p.cy("push")]]],
        ["hot", [[p.cx("build"), p.bot("build")], [p.cx("pages"), p.top("pages")]]],
        ["hot", [[p.cx("pages"), bus], [p.cx("app", 50), bus], [p.cx("app", 50), p.top("app")]]],
        ["hot", [[p.cx("push", -50), p.bot("push")], [p.cx("app", -50), p.top("app")]]],
      ];
    };
    const labels = (p) => {
      const bus = (p.bot("pages") + p.top("browser")) / 2;
      return [[p.cx("pages") + 30, bus - 8, "week.json"], [p.cx("push", -62), p.top("app") - 34, "push", "end"], [p.cx("amp", 57), p.top("amp") - 20, "counts only"]];
    };
    return draw("wide", 14 + 2 * 303 + w + 14, 16 + 4 * 116 + h + 12, boxes, edges, labels, { rx: 14, pad: 18, ty: 28, sy: 47, title: 16, sub: 13, coin: 13, arrow: 11 });
  })();

  // Tall: the route straight down, then two columns for where it comes out.
  const tall = (() => {
    const X = 18, FW = 290, HW = 139, RX = X + FW - HW, h = 54, row = (r) => 14 + r * 84;
    const full = (r) => ({ x: X, y: row(r), w: FW, h }), L = (r) => ({ x: X, y: row(r), w: HW, h }), R = (r) => ({ x: RX, y: row(r), w: HW, h });
    const boxes = { flyers: full(0), watcher: full(1), reader: full(2), data: full(3), build: full(4), pages: L(5), push: R(5), browser: L(6), app: R(6), mcp: L(7), amp: R(7), ai: L(8) };
    const edges = (p) => {
      const g1 = (p.bot("pages") + p.top("browser")) / 2, g2 = (p.bot("browser") + p.top("mcp")) / 2, rail = 6;
      return [
        ["plain", [[p.cx("pages", -30), p.bot("pages")], [p.cx("browser", -30), p.top("browser")]]],
        ["plain", [[p.left("pages"), p.cy("pages")], [rail, p.cy("pages")], [rail, p.cy("mcp")], [p.left("mcp"), p.cy("mcp")]]],
        ["plain", [[p.cx("mcp"), p.bot("mcp")], [p.cx("ai"), p.top("ai")]]],
        ["soft", [[p.cx("app"), p.bot("app")], [p.cx("amp"), p.top("amp")]]],
        ["soft", [[p.cx("browser", 30), p.bot("browser")], [p.cx("browser", 30), g2], [p.cx("amp", -40), g2], [p.cx("amp", -40), p.top("amp")]]],
        ...["flyers", "watcher", "reader", "data"].map((id, i, a) => { const next = [...a, "build"][i + 1]; return ["hot", [[p.cx(id), p.bot(id)], [p.cx(next), p.top(next)]]]; }),
        ["hot", [[p.cx("pages"), p.bot("build")], [p.cx("pages"), p.top("pages")]]],
        ["hot", [[p.cx("push"), p.bot("build")], [p.cx("push"), p.top("push")]]],
        ["hot", [[p.cx("pages", 30), p.bot("pages")], [p.cx("pages", 30), g1], [p.cx("app", -35), g1], [p.cx("app", -35), p.top("app")]]],
        ["hot", [[p.cx("push", 35), p.bot("push")], [p.cx("app", 35), p.top("app")]]],
      ];
    };
    const labels = (p) => [[p.cx("app", -25), p.top("app") - 7, "feed"], [p.cx("app", 42), p.top("app") - 11, "push"]];
    return draw("tall", X + FW + 12, 14 + 8 * 84 + h + 10, boxes, edges, labels, { rx: 12, pad: 14, ty: 23, sy: 40, title: 14, sub: 11.5, coin: 11, arrow: 9 });
  })();

  return `<figure class="how-map" role="img" aria-label="Diagram of the whole system. A flyer watcher checks each store's flyer page and starts the flyer reader, which writes the week's data file. A build turns that file into the website and a feed on GitHub Pages. The site in your browser, the app and the assistant server all read that feed, and the build also sends notifications to the app. The site and the app send private counts to Amplitude. The steps below describe each part.">
${wide}
${tall}
<figcaption>The whole system on one page. The blue line is the route a new flyer takes, and the numbers match the steps below.</figcaption>
</figure>`;
}

// How it works, at /how-it-works/: the route one flyer takes from a store's site to a phone,
// in plain words (the same flow as docs/architecture.svg). Linked from the footer and About.
// If the flow changes (the watcher, the routine, the build, the notify job, the MCP server),
// change this page too. Share image: node scripts/how-og.mjs.
function howPage() {
  const desktop = cfg.stores.filter((s) => s.active && s.watch?.desktop).map((s) => s.name);
  const listed = (names) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
  const stops = [
    ["A store posts its new flyer", "The store's own website",
      `<p>Each store puts its weekly ad on its own site: a page, a set of images or a PDF. That is the only source. This site never uses flyer aggregators, and it links back to every flyer it reads.</p>`],
    ["The watcher notices", "GitHub Actions, every 30 minutes",
      `<p>A small script visits each store's flyer page and takes a fingerprint of it: the addresses of the flyer images or PDF, or the printed sale dates. A fingerprint that differs from the last one means a new flyer. A page that fails to load never counts as a change.</p>`],
    ["Claude reads the flyer", "A Claude Code routine, in the cloud",
      `<p>The watcher starts an AI agent and tells it which stores changed. It opens each flyer and reads every page, writing down each grocery item with the price exactly as printed. A price it can't read clearly is left out, never guessed. Snacks, drinks and ready-made meals are skipped.</p>${desktop.length ? `
<p class="how-aside">${esc(listed(desktop))} sit behind a bot check that a cloud reader can't pass. The site doesn't try to get around it. Those flyers are read from a regular desktop browser instead.</p>` : ""}`],
    ["The rows become data, and get checked", "Scripts in the site's code",
      `<p>Scripts turn those rows into the week's data file. Each item is matched to a shared catalog, so chicken thighs at one store can be compared with chicken thighs at another, and with past weeks. A validator then checks the math: unit prices, percent off, dates.</p>
<p>Anything odd gets flagged, like a price three times its last listing. The agent fixes what the flyer can settle, the update is saved to the site's public code, and whatever is left goes to the owner to check by hand.</p>`],
    ["The site rebuilds itself", "GitHub Actions and GitHub Pages",
      `<p>Every saved change starts a rebuild, and so does every hour. The build ranks the deals, picks the standouts by <a href="${url("about/")}#how">the rules on About</a>, and writes every page as plain HTML. It also writes one feed file, <a href="${url("api/week.json")}">week.json</a>, with the same deals for anything that isn't a web page. There is no database: the data files are the record.</p>`],
    ["New deals are in", "Firebase Cloud Messaging, then Apple",
      `<p>Once the new pages are live, a last job works out which stores got a new flyer in that update and sends a notification to the people who picked those stores in the app. A marker per flyer makes sure nobody hears about the same one twice.</p>`],
  ];
  const places = [
    ["newspaper", "This site", `Plain pages from GitHub Pages. Your list, your stores and your display settings are kept in your browser and nowhere else.`, url(), "See this week"],
    ["widget", "The app", `For iPhone and iPad, coming soon. It fetches the same feed when you open it, and matches your list and price watches on the phone.`, url("app/"), "About the app"],
    ...(cfg.site.mcp_url ? [["search", "AI assistants", `A small Cloudflare Worker reads the same feed and answers questions from Claude or another assistant. It keeps nothing.`, url("mcp/"), "Connect an assistant"]] : []),
  ];
  const parts = [
    ["Flyer watcher", "Spots a new flyer", "GitHub Actions"],
    ["Flyer update", "Reads the flyer and writes the data", "Claude Code routine"],
    ["Item catalog", "Matches the same item across stores and weeks", "A file in the code"],
    ["Build", "Checks, ranks, writes the pages and the feed", "GitHub Actions"],
    ["Website and feed", "Serves the pages and week.json", "GitHub Pages"],
    ["Notifications", "Tells people their store has new deals", "Firebase and Apple"],
    ...(cfg.site.mcp_url ? [["Assistant server", "Answers AI assistants from the feed", "Cloudflare Worker"]] : []),
    ["App", "The same deals on iPhone and iPad", "SwiftUI"],
    ["Counting", "Page views and taps, kept private", "Amplitude"],
  ];
  const body = `<div class="how-page">
<div class="how-top">
  ${buddy("thinking", 112)}
  <div>
    <h1>How it works</h1>
    <p class="lede">A new flyer goes from a store's website to this site, the app and your phone with nobody pressing a button. Here is the route one flyer takes.</p>
  </div>
</div>

${howMap()}

<h2 class="how-h">The route, step by step</h2>
<ol class="how-route">
${stops.map(([title, where, html], i) => `  <li class="how-stop">
    <span class="how-n" aria-hidden="true">${i + 1}</span>
    <div class="how-body">
      <h2>${esc(title)}</h2>
      <p class="how-where"><span class="sr-only">Where it runs: </span>${esc(where)}</p>
      ${html}
    </div>
  </li>`).join("\n")}
</ol>

<h2 class="how-h">Where it comes out</h2>
<p>Everything reads the same data, so the site, the app and an assistant always agree on a price.</p>
<ul class="how-places">
${places.map(([icon, title, text, href, go]) => `  <li class="card how-place">${ic(icon)}<h3>${esc(title)}</h3><p>${text}</p><a class="go" href="${esc(href)}">${esc(go)}</a></li>`).join("\n")}
</ul>

<h2 class="how-h">What isn't here, on purpose</h2>
<ul>
  <li><strong>No servers of its own.</strong> Every step runs on a service that already exists, so there is nothing to keep awake at night.</li>
  <li><strong>No database.</strong> Each week is one file in the code, and <a href="${url("data/weeks/")}">every week is public</a>.</li>
  <li><strong>No accounts.</strong> With no sign-in, there is nothing about you to store.</li>
</ul>
<p>The one thing that flows back is a count. The site and the app tally page views and taps with Amplitude, set up to be private, and "People are adding" on This week comes from how often each deal is added to a list. More in <a href="${url("about/")}">About and privacy</a>.</p>

<h2 class="how-h">The parts</h2>
<dl class="how-parts">
${parts.map(([part, job, on]) => `  <div><dt>${esc(part)}</dt><dd>${esc(job)}</dd><dd class="how-on">${esc(on)}</dd></div>`).join("\n")}
</dl>
<p>The code for all of it is public: <a href="${esc(cfg.site.repo_url)}">see the source on GitHub</a>.</p>
</div>`;
  write("how-it-works/", page({
    title: "How it works", path: "how-it-works/", section: "about/", body,
    description: "How a store's new flyer becomes a deal on Seattle Grocery Deals: a watcher, an AI reader, checks, a rebuild and a notification, with no servers of its own.",
    ogTitle: "How Seattle Grocery Deals works",
    image: "assets/img/og-how.png",
    imageAlt: "How Seattle Grocery Deals works: the crow beside a route of six stops, from a store's flyer to your phone.",
  }));
}

function dataPages() {
  mkdirSync(join(DIST, "data", "weeks"), { recursive: true });
  for (const w of weeks) writeFileSync(join(DIST, "data", "weeks", `${w.week}.json`), JSON.stringify(w, null, 2));
  const list = [...weeks].reverse().map((w) => `<li><a href="${url(`data/weeks/${w.week}.json`)}">${w.week}.json</a></li>`).join("");
  write("data/weeks/", page({ title: "Data", path: "data/weeks/", section: "", noindex: true, body: `<h1>Weekly data</h1>\n<ul>${list}</ul>` }));
  mkdirSync(join(DIST, "schema"), { recursive: true });
  cpSync(join(ROOT, "schema", "week.schema.json"), join(DIST, "schema", "week.schema.json"));
}

// What search engines and home screens read: the favicon at the root (Google looks there
// first), a web app manifest, robots.txt and a sitemap of every indexable page.
function searchFiles() {
  const origin = cfg.site.origin + cfg.site.base_path;
  cpSync(join(ROOT, "site", "assets", "favicon.ico"), join(DIST, "favicon.ico"));
  writeFileSync(join(DIST, "site.webmanifest"), JSON.stringify({
    name: cfg.site.title, short_name: "Grocery Deals", description: cfg.site.tagline, start_url: url(), scope: url(), display: "browser",
    background_color: "#eef3f6", theme_color: "#eef3f6",
    icons: [{ src: url("assets/logo-192.png"), sizes: "192x192", type: "image/png" }, { src: url("assets/logo-512.png"), sizes: "512x512", type: "image/png" }],
  }, null, 2));
  writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: ${url("data/")}\n\nSitemap: ${origin}sitemap.xml\n`);
  const home = new Set(["", "departments/", "stores/", "standouts/", "compare/"]);
  const xml = [...SITEMAP].sort().map((p) => `  <url><loc>${esc(origin + p)}</loc><lastmod>${TODAY}</lastmod>${home.has(p) || p.startsWith("stores/") || p.startsWith("departments/") ? "<changefreq>daily</changefreq>" : p.startsWith("weeks/") && p !== "weeks/" ? "<changefreq>yearly</changefreq>" : ""}</url>`);
  writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xml.join("\n")}\n</urlset>\n`);
}

function notFound() {
  writeFileSync(join(DIST, "404.html"), page({ title: "Not found", path: "", section: "404", noindex: true, body: `<div class="nf">${buddy("sad", 120)}<h1>Page not found</h1><p class="page-sub">That page isn't in this week's paper. It may have moved, or the sale it was about has ended.</p><p><a class="btn btn-primary" href="${url()}">See this week's deals</a></p></div>` }));
}


// A ready-to-use feed for the mobile app: this week's deals with the analysis done.
function appFeed() {
  const items = analyzed.get(latest.week);
  const feedIds = new Map(items.map((i, rank) => [i, `${i.store}-${rank}`]));
  const feed = {
    // end: the date most deals run through (older app versions show "Ends <day>" from it).
    // ends.some: an earlier date a good share of deals end on. updated: the latest flyer start.
    week: latest.week, end: ENDS.most, ends: ENDS, updated: updatedOn(latest), generated: TODAY,
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
    // Seasonal items on this week (persimmons first): the This week card and season screen.
    // Missing in feeds built before 2026-10-31; older apps ignore it.
    seasons: seasonFeed(feedIds),
    // "Best of your stores": each store's score, standouts, good deals, core aisles covered, a
    // reason line and its top deal ids, plus the same over vegetarian deals (veg). The app ranks
    // the stores the person picked by score; quiet says it's a quiet week there.
    // Missing in feeds built before 2026-11-07; older apps ignore it.
    store_ranks: RANKS,
  };
  mkdirSync(join(DIST, "api"), { recursive: true });
  writeFileSync(join(DIST, "api", "week.json"), JSON.stringify(feed));
  return feed;
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
// The app feed and what people are adding come first: This week shows "People are adding".
const feed = appFeed();
POPULAR = await writePopular(feed, DIST);
homePage();
standoutsPage();
departmentPages();
comparePage();
weekPages();
storePages();
aboutPage();
accessibilityPage();
yourListPage();
appsPage();
mcpPage();
howPage();
for (const s of SEASONS) seasonPage(s);
dataPages();
notFound();
searchFiles();
console.log(`Built ${weeks.length} week(s), latest ${latest.week}, into dist/ with base ${BASE}`);
