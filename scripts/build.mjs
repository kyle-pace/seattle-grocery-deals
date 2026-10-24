// Builds the static site into dist/. Usage: node scripts/build.mjs
// Set BASE_PATH=/ to build for a local server at the root.
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ROOT, loadConfig, loadWeeks, esc, fmtDate, fmtPeriod, money, priceText, unitPriceText, packText,
  unitPriceIsExtra, analyze, priorListings, peerPrices, convertPer, isVegetarian,
} from "./lib.mjs";

const cfg = loadConfig();
const BASE = process.env.BASE_PATH ?? cfg.site.base_path;
// Google Analytics loads only in the deployed build, so local previews (BASE_PATH=/) are not counted.
const GA_ID = BASE === cfg.site.base_path ? cfg.site.ga_measurement_id : null;
const GA_TAG = GA_ID ? `
<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(GA_ID)}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${esc(GA_ID)}');
</script>` : "";
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
const HOME_BEST = 6;
const HOME_STORES = 6;

const url = (p = "") => BASE + p;
// Versioned asset links, so each deploy busts browser caches.
const asset = (p) => `${url(p)}?v=${createHash("sha1").update(readFileSync(join(ROOT, "site", p))).digest("hex").slice(0, 8)}`;
const LOGO = readFileSync(join(ROOT, "site", "assets", "logo.svg"), "utf8").trim().replace("<svg ", '<svg aria-hidden="true" width="28" height="28" ');
const storeName = (id) => cfg.storeById[id]?.name ?? id;
const keyLabel = (k) => cfg.items[k]?.label ?? k;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const ext = `<span aria-hidden="true">&#8599;</span><span class="sr-only"> (opens the store's site)</span>`;

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

function amount(i, { tag = false } = {}) {
  const p = priceParts(i);
  return `<p class="amt${tag ? " amt-tag" : ""}"><span class="sr-only">${esc(p.spoken)}</span><span aria-hidden="true">${p.lead ? `<span class="amt-lead">${esc(p.lead)}</span>` : ""}${p.cur ? `<span class="amt-cur">$</span>` : ""}${esc(p.num)}${p.unit ? `<span class="amt-unit">${esc(p.unit)}</span>` : ""}</span></p>`;
}

function rowAttrs(i, rank) {
  const unit = i.unit_price ? convertPer(i.unit_price.value, i.unit_price.per, i.unit_price.per) : i.price;
  return `data-store="${esc(i.store)}" data-category="${esc(i.category)}" data-tier="${i.a.tier}" data-veg="${isVegetarian(i) ? 1 : 0}" data-rank="${rank}" data-price="${i.price}" data-off="${i.percent_off ?? 0}" data-name="${esc(i.item.toLowerCase())}" data-text="${esc(`${i.item} ${storeName(i.store)}`.toLowerCase())}" data-unit="${unit}"`;
}

// One deal. why: show the reason it's a deal. store: link the store.
function dealRow(i, rank, { why = false, store = true, ends = true } = {}) {
  const p = priceParts(i);
  const label = i.a.tier === "standout" ? `<span class="lbl">Standout</span> ` : i.a.tier === "good" ? `<span class="lbl lbl-good">Good deal</span> ` : "";
  const meta = [
    store ? `<a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a>` : "",
    ...p.detail.map(esc),
    i.regular_price != null ? `was <s>${esc(priceText(i, i.regular_price))}</s>` : "",
    i.percent_off != null ? `<span class="off">${i.percent_off}% off</span>` : "",
    i.member_price ? "member price" : "",
    ends && i.valid_through ? `through ${esc(fmtDate(i.valid_through))}` : "",
  ].filter(Boolean).join(" &middot; ");
  const reason = why ? (i.highlight?.reason ?? i.a.tags.filter((t) => t.kind !== "pct").map((t) => t.text).join(". ")) : "";
  return `<li class="deal" ${rowAttrs(i, rank)}>
  <div class="deal-main"><p class="deal-name">${label}${esc(i.item)}</p><p class="deal-meta">${meta}</p>${reason ? `<p class="deal-why">${esc(reason)}</p>` : ""}${i.notes ? `<p class="deal-note">${esc(i.notes)}</p>` : ""}</div>
  ${amount(i, { tag: i.a.tier === "standout" })}
</li>`;
}

// Deals grouped by department, each group a section that hides when filters empty it.
function grouped(items, opts = {}) {
  return CATS.filter((c) => items.some((i) => i.category === c)).map((c) => {
    const list = items.filter((i) => i.category === c);
    return `<section class="group" data-group aria-labelledby="g-${c}">
  <h2 class="group-h" id="g-${c}">${esc(CATEGORY_LABELS[c])} <span data-group-count>${list.length}</span></h2>
  <ul class="deals" data-sortable>${list.map((i) => dealRow(i, items.indexOf(i), opts)).join("\n")}</ul>
</section>`;
  }).join("\n");
}

// Search, store, sort and vegetarian controls. Rows below with [data-filterable] respond.
function controls({ search = true, store = true, sort = false, stores = [], searchLabel = "Find" } = {}) {
  return `<div class="bar" data-filters><div class="wrap bar-in">
  ${search ? `<div class="find"><label for="f-q">${esc(searchLabel)}</label><input id="f-q" type="search" data-search placeholder="tofu, persimmon, 99 Ranch" autocomplete="off"></div>` : ""}
  ${store && stores.length ? `<div class="pick"><label for="f-store">Store</label><select id="f-store" data-filter="store"><option value="">All stores</option>${stores.map((s) => `<option value="${esc(s)}">${esc(storeName(s))}</option>`).join("")}</select></div>` : ""}
  ${sort ? `<div class="pick"><label for="f-sort">Sort</label><select id="f-sort" data-sort><option value="rank">Best deals first</option><option value="off">Biggest % off</option><option value="price">Lowest price</option><option value="name">A to Z</option></select></div>` : ""}
  <button type="button" class="switch" role="switch" aria-checked="false" data-veg-toggle><span class="track" aria-hidden="true"></span>Vegetarian only<span class="switch-state" aria-hidden="true" data-when-all>Off</span><span class="switch-state" aria-hidden="true" data-when-veg>On</span></button>
</div></div>`;
}

const countLine = () => `<p class="count" data-count role="status"></p>`;
const emptyLine = (text) => `<p class="empty" data-empty hidden>${esc(text)}</p>`;
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

const chips = (s) => {
  const c = [];
  if (s.delivery) c.push(`<span class="chip">Delivers</span>`);
  return c.length ? `<span class="chips">${c.join("")}</span>` : "";
};

// A store tile: name, counts and its top deal, linking to the store page.
function storeTile(s, items, { about = false } = {}) {
  const f = latest.flyers.find((x) => x.store === s.id);
  const mine = items.filter((i) => i.store === s.id);
  const veg = mine.filter(isVegetarian);
  const st = (l) => l.filter((i) => i.a.tier === "standout").length;
  const counts = (l) => `${plural(l.length, "deal")}${st(l) ? `, ${plural(st(l), "standout")}` : ""}`;
  const top = (l) => l[0] ? `Top: <b>${esc(l[0].item)}</b> ${esc(priceText(l[0]))}` : "";
  const status = s.no_online_flyer ? "No online flyer" : !f ? "Not checked this week" : f.status === "unreadable" ? "Flyer couldn't be read this week" : f.status === "stale" ? "Flyer not updated this week" : f.valid_through ? `Sale through ${fmtDate(f.valid_through)}` : "";
  return `<li${s.delivery ? " data-delivers" : ""}><a class="tile" href="${url(`stores/${s.id}/`)}">
  <span class="tile-t">${esc(s.name)}</span>${chips(s)}
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
  const counts = (x) => `${plural(x.length, "deal")}${st(x) ? `, ${plural(st(x), "standout")}` : ""}`;
  const top = (x) => x[0] ? `Top: <b>${esc(x[0].item)}</b> ${esc(priceText(x[0]))} at ${esc(storeName(x[0].store))}` : "No vegetarian deals";
  return `<li${veg.length ? "" : " data-meat-only"}><a class="tile" href="${url(`${base}${c}/`)}">
  <span class="tile-t">${esc(CATEGORY_LABELS[c])}</span>
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
function page({ title, path, section = path, body, wrap = true, description, map = false, extraScript = null, bodyClass = "", image = null, imageAlt = "", ogTitle = null }) {
  const full = title ? `${title} | ${cfg.site.title}` : cfg.site.title;
  const cur = (p) => (p === section ? ' aria-current="page"' : "");
  const top = [...MAIN_NAV, ["about/", "About"]].map(([p, label]) => `<a href="${url(p)}"${cur(p)}>${label}</a>`).join("")
    + (PERSIMMON_SEASON ? `<a class="nav-persim" href="${url("persimmons/")}" aria-label="Persimmons" title="Persimmons"${cur("persimmons/")}>${PERSIMMON_SVG}</a>` : "");
  const tabs = MAIN_NAV.map(([p, label]) => `<a href="${url(p)}"${cur(p)}>${ICONS[p]}<span>${label}</span></a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${GA_TAG}
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
<meta name="theme-color" content="#1d4d33">
<link rel="icon" href="${url("assets/logo.svg")}" type="image/svg+xml">
<link rel="preload" href="${url("assets/fonts/atkinson-hyperlegible-next.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${url("assets/fonts/barlow-condensed-700.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset("assets/style.css")}">
<script>try{if(JSON.parse(localStorage.getItem("sgd.vegOnly")))document.documentElement.classList.add("veg-on")}catch(e){}</script>
<script src="${asset("assets/app.js")}" defer></script>${extraScript ? `
<script src="${asset(extraScript)}" defer></script>` : ""}${map ? `
<link rel="stylesheet" href="${asset("assets/leaflet/leaflet.css")}">
<script src="${asset("assets/leaflet/leaflet.js")}" defer></script>
<script src="${asset("assets/map.js")}" defer></script>` : ""}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
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
const storesIn = (items) => [...new Set(items.map((i) => i.store))].sort((a, b) => storeName(a).localeCompare(storeName(b)));

// ---------- home ----------

function homePage() {
  const items = analyzed.get(latest.week);
  const end = weekEnd(latest);
  const standouts = items.filter((i) => i.a.tier === "standout");
  // The best few for everyone, plus the best vegetarian ones, so the section stays
  // full when "Vegetarian only" is on. data-hl says which list a row belongs to.
  const hlAll = standouts.slice(0, HOME_BEST);
  const hlVeg = standouts.filter(isVegetarian).slice(0, HOME_BEST);
  const best = standouts.filter((i) => hlAll.includes(i) || hlVeg.includes(i));
  const read = latest.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
  const persim = PERSIMMON_SEASON ? items.filter((i) => isPersimmon(i) && isFuyu(i) && i.unit_price).sort(byPerLb) : [];
  const persimStores = new Set(items.filter(isPersimmon).map((i) => i.store)).size;
  const lastEnd = items.map((i) => i.valid_through).filter(Boolean).sort().pop();
  const soonPool = items.filter((i) => i.valid_through).slice(0, 60);
  const shops = [...new Set(items.map((i) => i.store))]
    .map((id) => ({ s: cfg.storeById[id], n: items.filter((i) => i.store === id && i.a.tier === "standout").length, w: items.filter((i) => i.store === id).slice(0, 5).reduce((t, i) => t + i.a.score, 0) }))
    .sort((a, b) => b.n - a.n || b.w - a.w).map((x) => x.s);

  const body = `<div class="hero"><div class="wrap">
  <h1>This week's deals</h1>
  <p>${esc(fmtDate(latest.week, { weekday: false }))}${end ? ` to ${esc(fmtDate(end, { weekday: false }))}` : ""} &middot; ${plural(items.length, "deal")} from ${plural(read, "store")} &middot; New every Friday</p>
</div></div>
${controls({ stores: storesIn(items) })}
<div class="wrap" data-filterable>
${lastEnd ? `<p class="notice" data-expired-after="${lastEnd}" hidden>These sales have ended. New flyers come in on Friday, so check back then.</p>` : ""}
<div data-home>
<section class="block" aria-labelledby="h-best">
  <div class="sec-h"><h2 id="h-best">Best this week</h2><p>${vegText(`${standouts.length} standouts`, `${standouts.filter(isVegetarian).length} vegetarian standouts`)}: big drops, low prices, or the cheapest in town</p></div>
  <ul class="deals deals-2">${best.map((i) => dealRow(i, items.indexOf(i), { why: true }).replace('<li class="deal" ', `<li class="deal" data-hl="${(hlAll.includes(i) ? "a" : "") + (hlVeg.includes(i) ? "v" : "")}" `)).join("\n")}</ul>
  <a class="go" href="${url("standouts/")}">See all ${vegText(`${standouts.length} standouts`, `${standouts.filter(isVegetarian).length} vegetarian standouts`)}</a>
</section>
${soonPool.length ? `<section class="block ending" data-ending hidden aria-labelledby="h-end">
  <div class="sec-h"><h2 id="h-end">Ending soon</h2><p>Last chance, within the next two days</p></div>
  <ul class="mini">${soonPool.map((i) => `<li data-ends="${i.valid_through}" data-veg="${isVegetarian(i) ? 1 : 0}" data-store="${esc(i.store)}" hidden><span>${esc(i.item)} <a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a></span> <span class="mini-price">${esc(priceText(i))} <span class="ends-when" data-ends-label></span></span></li>`).join("")}</ul>
</section>` : ""}
${persim.length ? `<section class="story" aria-labelledby="h-story">
  <p class="kicker">In season</p>
  <h2 id="h-story">Persimmon season</h2>
  <p>Fuyu persimmons are at their best now, and ${plural(persimStores, "store")} ${persimStores === 1 ? "has" : "have"} them on sale. The cheapest is ${esc(storeName(persim[0].store))} at ${esc(priceText(persim[0]))}. Eat them crisp like an apple, skin and all.</p>
  <p><a href="${url("persimmons/")}">Where to buy persimmons this week</a></p>
</section>` : ""}
<section class="block" aria-labelledby="h-dep">
  <div class="sec-h"><h2 id="h-dep">Shop by department</h2></div>
  <ul class="tiles">${CATS.filter((c) => items.some((i) => i.category === c)).map((c) => deptTile(c, items)).join("\n")}</ul>
</section>
<section class="block" aria-labelledby="h-where">
  <div class="sec-h"><h2 id="h-where">Where to shop</h2><p>Stores with the most standouts first</p></div>
  <ul class="tiles">${shops.slice(0, HOME_STORES).map((s) => storeTile(s, items)).join("\n")}</ul>
  <a class="go" href="${url("stores/")}">All stores, flyers and the map</a>
</section>
</div>
<div data-results hidden>
  ${countLine()}
  ${grouped(items)}
  ${emptyLine("Nothing matches. Try a shorter word or a store name.")}
</div>
</div>`;
  write("", page({ title: "", path: "", body, wrap: false }));
}

// ---------- list pages ----------

function listPage({ path, section, title, h1, sub, items, crumbsHtml = "", group = true, why = true, empty }) {
  const body = `<div class="wrap">${crumbsHtml}${pageHead(h1, sub)}</div>
${controls({ stores: storesIn(items), sort: true, searchLabel: "Find" })}
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
      empty: veg ? "Nothing matches these filters." : "No vegetarian deals here this week. Turn off Vegetarian only to see them all.",
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
<div class="tools"><button type="button" class="switch" role="switch" aria-checked="false" data-deliv-toggle><span class="track" aria-hidden="true"></span>Only stores that deliver</button></div>
<ul class="tiles" data-store-tiles>${tracked.map((s) => storeTile(s, items, { about: true })).join("\n")}</ul>
<p class="empty" data-deliv-empty hidden>No stores match.</p>
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
      f && (f.status === "full" || f.status === "partial") && f.valid_from ? `Sale runs ${esc(fmtDate(f.valid_from))} to ${esc(fmtDate(f.valid_through))}` : "",
    ].filter(Boolean).join(" &middot; ");
    const actions = `<div class="actions">
  ${adUrl && !s.no_online_flyer ? `<a class="btn btn-primary" href="${esc(adUrl)}" rel="noopener">See ${esc(s.name)}'s weekly ad ${ext}</a>` : ""}
  ${mine.length ? `<a class="btn" href="#deals">This week's ${vegText(plural(mine.length, "deal"), plural(vegN, "vegetarian deal"))} here</a>` : ""}
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
${pageHead(esc(s.name), sub, actions)}
<p class="lede">${esc(s.about)}</p>
${s.delivery ? `<div class="note-card"><b>Delivery</b><span>${esc(s.delivery)}</span></div>` : ""}
${flyerNote}
${mine.length ? `<div class="sec-h deals-h" id="deals"><h2>Deals at ${esc(s.name)} this week</h2><p>${vegText(plural(mine.length, "deal"), plural(vegN, "vegetarian deal"))}, ${plural(mine.filter((i) => i.a.tier === "standout").length, "standout")}</p></div>` : ""}
</div>
${mine.length ? `${controls({ store: false, sort: true })}
<div class="wrap list" data-filterable>
${countLine()}
${grouped(mine, { store: false })}
${emptyLine(vegN ? "Nothing matches these filters." : "No vegetarian deals here this week. Turn off Vegetarian only to see them all.")}
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

const PERSIMMON_SVG = `<svg viewBox="0 0 64 64" width="21" height="21" aria-hidden="true"><ellipse cx="32" cy="38" rx="26" ry="21" fill="#f07c1e"/><ellipse cx="32" cy="40" rx="22" ry="16" fill="#f7932f"/><ellipse cx="22" cy="33" rx="6" ry="4" fill="#ffc27a" opacity=".75"/><path d="M32 17l-11-4 5 8-10 3h11l5 7 5-7h11l-10-3 5-8z" fill="#3f7a2b"/><rect x="30.5" y="10" width="3" height="7" rx="1.5" fill="#5b3a1e"/></svg>`;

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
  <div class="persim-mascot" data-bounce>${PERSIMMON_SVG}</div>
  <p class="persim-kicker">The best Fuyu deal in this week's flyers</p>
  <h2 id="best-h" class="persim-price">${esc(priceText(best))}</h2>
  <p class="persim-where">at <a href="${url(`stores/${best.store}/`)}">${esc(storeName(best.store))}</a>${best.valid_through ? `, through ${esc(fmtDate(best.valid_through))}` : ""}</p>
  <p class="persim-item">${esc(best.item)}</p>
  ${best.valid_through ? `<p class="notice" data-expired-after="${best.valid_through}" hidden>This deal ended ${esc(fmtDate(best.valid_through))}. New flyers come in on Friday.</p>` : ""}
  ${per10 ? `<p class="persim-math">That's about <strong>${per10} persimmons for $10</strong>.<span class="muted"> Roughly, at 7 oz a persimmon.</span></p>` : ""}
  ${best.notes ? `<p class="muted">${esc(best.notes)}</p>` : ""}
</section>`
    : `<section class="persim-hero">
  <div class="persim-mascot sad" data-bounce>${PERSIMMON_SVG}</div>
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
  const body = `<h1>About</h1>
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
<h2 id="vegetarian">Vegetarian only</h2>
<p>The "Vegetarian only" switch hides meat, poultry and seafood, and anything made with them, such as fish sauce, broth or pork dumplings. Dairy and eggs stay. It works from each item's category and name, so when a name doesn't make it clear, as with many dumplings and frozen meals, the item is hidden to be safe. It doesn't check for other animal ingredients, like gelatin in a pudding or lard in a pastry, unless the name says so. Check the label if it matters to you.</p>
<h2 id="how">How deals are highlighted</h2>
<p><span class="lbl">Standout</span> deals are any of these:</p>
<ul>
  <li>At least ${c.standout.min_percent_off_priority}% off a printed regular price for produce, meat, seafood and staples, or ${c.standout.min_percent_off_other}% off for anything else.</li>
  <li>A staple priced at ${Math.round(c.standout.max_us_average_ratio * 100)}% or less of the US average price from the <a href="${esc(cfg.benchmarksFile.source_url)}">Bureau of Labor Statistics</a>. These are national averages, not Seattle prices, so the comparison is approximate.</li>
  <li>Lower than any price this site has listed before for the same item.</li>
  <li>Hand-picked, with a short note on why.</li>
</ul>
<p><span class="lbl lbl-good">Good deal</span> means at least ${c.good.min_percent_off}% off, under ${Math.round(c.good.max_us_average_ratio * 100)}% of the US average, matching the lowest price we've listed, or the cheapest of several stores this week.</p>
<p>Everything else is still on sale and still listed. Many stores print no regular price, so an unmarked item can still be a good buy.</p>
<h2>Where to shop and comparing stores</h2>
<p>"Where to shop" and the Stores page rank stores by how many standouts they have this week. "Compare" puts the same item side by side when it's on sale at more than one store, by price per unit.</p>
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
<p>The site uses Google Analytics to count visits and see which pages are used. Google Analytics sets cookies and receives your IP address and basic details about your browser and device. Google's own use of that data is described in <a href="https://policies.google.com/technologies/partner-sites">How Google uses information from sites that use its services</a>. To opt out, use a content blocker or <a href="https://tools.google.com/dlpage/gaoptout">Google's opt-out add-on</a>.</p>
<p>Your "Vegetarian only" choice is saved only in your browser and is never sent anywhere. The store map loads map tiles from OpenStreetMap, which receives your IP address the way any website does. Apart from Google Analytics and the map tiles, everything, fonts included, is served from this site.</p>
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
  writeFileSync(join(DIST, "404.html"), page({ title: "Not found", path: "", body: `<h1>Not found</h1>\n<p><a href="${url()}">Go to this week's sales</a></p>` }));
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
        delivery: s.delivery ?? null, status: f?.status ?? null, from: f?.valid_from ?? null, through: f?.valid_through ?? null,
        locations: s.locations.map((l) => ({ label: l.label, address: l.address, lat: l.lat, lon: l.lon })) };
    }),
    items: items.map((i, rank) => {
      const p = priceParts(i);
      return { id: `${i.store}-${rank}`, rank, name: i.item, store: i.store, category: i.category, key: i.item_key ?? null,
        price: i.price, text: priceText(i), lead: p.lead, amount: p.cur + p.num, unit: p.unit.trim(), spoken: p.spoken, detail: p.detail,
        regular: i.regular_price != null ? priceText(i, i.regular_price) : null, off: i.percent_off ?? null,
        unit_price: i.unit_price ? unitPriceText(i.unit_price) : null, tier: i.a.tier,
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
