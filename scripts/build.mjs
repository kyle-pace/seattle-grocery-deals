// Builds the static site into dist/. Usage: node scripts/build.mjs
// Set BASE_PATH=/ to build for a local server at the root.
import { mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, loadConfig, loadWeeks, esc, fmtDate, fmtPeriod, money, priceText, unitPriceText,
  unitPriceIsExtra, analyze, priorListings, peerPrices, convertPer,
} from "./lib.mjs";

const cfg = loadConfig();
const BASE = process.env.BASE_PATH ?? cfg.site.base_path;
const DIST = join(ROOT, "dist");
const weeks = loadWeeks().map((w) => w.data); // oldest first
if (!weeks.length) throw new Error("No week files in data/weeks");
const latest = weeks[weeks.length - 1];
const H = cfg.criteria.home;

const CATEGORY_LABELS = {
  produce: "Produce", meat: "Meat", seafood: "Seafood", "dairy-eggs": "Dairy and eggs", pantry: "Pantry",
  frozen: "Frozen", bakery: "Bakery", prepared: "Prepared", "snacks-drinks": "Snacks and drinks", other: "Other",
};
const STATUS_LABELS = { full: "Read in full", partial: "Partly read", stale: "Stale", unreadable: "Unreadable" };
const FORMAT_LABELS = { "web-page": "Web page", images: "Flyer images", pdf: "PDF", "catalogue-viewer": "Catalogue viewer" };
const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const TIER_LABELS = { standout: "Standout", good: "Good deal", sale: "On sale" };
const PER_LABEL = { lb: "/lb", each: " each", dozen: "/dozen", l: "/L", gal: "/gal" };

const url = (p = "") => BASE + p;
const LOGO = readFileSync(join(ROOT, "site", "assets", "logo.svg"), "utf8").trim().replace("<svg ", '<svg aria-hidden="true" ');
const storeName = (id) => cfg.storeById[id]?.name ?? id;
const keyLabel = (k) => cfg.items[k]?.label ?? k;

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

// ---------- pieces ----------

function tagChips(i) {
  return i.a.tags.map((t) => `<span class="tag tag-${t.kind}">${esc(t.text)}</span>`).join("");
}

function compareLine(i) {
  const parts = [];
  if (i.regular_price != null) parts.push(`Regular ${priceText(i, i.regular_price)}`);
  if (i.a.us) parts.push(`US average ${money(i.a.us.price)}${PER_LABEL[i.a.us.per]} (BLS ${fmtPeriod(i.a.us.period)}, approximate)`);
  if (i.a.low) parts.push(`Lowest listed before ${money(i.a.low.price)}${PER_LABEL[i.a.low.per]} at ${storeName(i.a.low.store)}, ${fmtDate(i.a.low.week, { weekday: false })}`);
  return parts.join(". ");
}

function attrs(i) {
  return `data-store="${esc(i.store)}" data-category="${esc(i.category)}" data-tier="${i.a.tier}"`;
}

function priceBlock(i) {
  const extra = unitPriceIsExtra(i) ? ` <span class="unit">${esc(unitPriceText(i.unit_price))}</span>` : "";
  return `<span class="price">${esc(priceText(i))}</span>${extra}`;
}

function card(i, { showStore = true } = {}) {
  const meta = [
    showStore ? `<a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a>` : "",
    esc(CATEGORY_LABELS[i.category]),
    i.valid_through ? `through ${esc(fmtDate(i.valid_through))}` : "",
  ].filter(Boolean).join(` <span aria-hidden="true">&middot;</span> `);
  const cmp = compareLine(i);
  return `<li class="card tier-${i.a.tier}" ${attrs(i)}>
  <div class="card-head"><h3>${esc(i.item)}</h3><p>${priceBlock(i)}</p></div>
  <p class="meta">${meta}</p>
  ${i.highlight ? `<p class="reason">${esc(i.highlight.reason)}</p>` : ""}
  ${i.a.tags.length ? `<p class="tags">${tagChips(i)}</p>` : ""}
  ${cmp ? `<p class="cmp">${esc(cmp)}.</p>` : ""}
  ${i.notes ? `<p class="notes">${esc(i.notes)}</p>` : ""}
</li>`;
}

function row(i, { showStore = true } = {}) {
  return `<li class="row tier-${i.a.tier}" ${attrs(i)}>
  <span class="r-item">${i.a.tier === "standout" ? `<span class="dot" title="Standout"></span>` : i.a.tier === "good" ? `<span class="dot dot-good" title="Good deal"></span>` : ""}${esc(i.item)}${showStore ? ` <a class="r-store" href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a>` : ""}${i.notes ? ` <span class="r-note">${esc(i.notes)}</span>` : ""}</span>
  <span class="r-price">${priceBlock(i)}</span>
  ${i.a.tags.length ? `<span class="r-tags">${tagChips(i)}</span>` : ""}
</li>`;
}

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
        return `<li class="flyer status-none" data-store="${esc(s.id)}">
  <div><a class="store" href="${url(`stores/${s.id}/`)}">${esc(s.name)}</a> <span class="status">Not checked</span></div>
  <div class="links">${s.flyer_url ? `<a href="${esc(s.flyer_url)}" rel="noopener">Store flyer page</a>` : `<span class="muted">No link</span>`}</div>
</li>`;
      }
      return `<li class="flyer status-${f.status}" data-store="${esc(s.id)}">
  <div><a class="store" href="${url(`stores/${s.id}/`)}">${esc(s.name)}</a> <span class="status">${STATUS_LABELS[f.status]}</span></div>
  <div class="dates">${datesText(f)}</div>
  <div class="links">${flyerLinks(f, s)}</div>
  ${f.note ? `<div class="note">${esc(f.note)}</div>` : ""}
</li>`;
    });
  return `<ul class="flyers">${rows.join("\n")}</ul>`;
}

// Stores ranked by how much is worth buying there this week.
function whereToShop(week, items) {
  const stores = [...new Set(items.map((i) => i.store))].map((id) => {
    const mine = items.filter((i) => i.store === id);
    const standouts = mine.filter((i) => i.a.tier === "standout").length;
    const good = mine.filter((i) => i.a.tier === "good").length;
    const cats = cfg.criteria.categories
      .map((c) => [c, mine.filter((i) => i.category === c && i.a.tier !== "sale").length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const weight = mine.slice(0, H.where_to_shop_items).reduce((s, i) => s + i.a.score, 0);
    return { id, mine, standouts, good, cats, weight };
  }).sort((a, b) => b.standouts - a.standouts || b.weight - a.weight);

  const f = Object.fromEntries(week.flyers.map((x) => [x.store, x]));
  return `<ol class="stores-grid">${stores.map((s) => `<li class="store-card" data-store="${esc(s.id)}">
  <h3><a href="${url(`stores/${s.id}/`)}">${esc(storeName(s.id))}</a></h3>
  <p class="meta">${s.mine.length} item${s.mine.length === 1 ? "" : "s"} on sale${s.standouts ? `, <strong>${s.standouts} standout${s.standouts > 1 ? "s" : ""}</strong>` : ""}${s.good ? `, ${s.good} good` : ""}${f[s.id]?.valid_through ? ` <span aria-hidden="true">&middot;</span> through ${esc(fmtDate(f[s.id].valid_through))}` : ""}</p>
  ${s.cats.length ? `<p class="strong-in">Strong in: ${s.cats.slice(0, 3).map(([c]) => esc(CATEGORY_LABELS[c].toLowerCase())).join(", ")}</p>` : ""}
  <ul class="mini">${s.mine.slice(0, H.where_to_shop_items).map((i) => `<li><span>${esc(i.item)}</span> <span class="mini-price">${esc(priceText(i))}</span></li>`).join("")}</ul>
  <p class="more"><a href="#all" data-jump-store="${esc(s.id)}">See all ${s.mine.length}</a></p>
</li>`).join("\n")}</ol>`;
}

function bestByCategory(items) {
  const cats = cfg.criteria.categories.filter((c) => items.some((i) => i.category === c && i.a.tier !== "sale"));
  return `<div class="cat-grid">${cats.map((c) => {
    const top = items.filter((i) => i.category === c && i.a.tier !== "sale").slice(0, H.best_by_category_items);
    return `<section class="cat-box">
  <h3>${esc(CATEGORY_LABELS[c])}</h3>
  <ul class="mini">${top.map((i) => `<li ${attrs(i)}><span>${esc(i.item)} <span class="muted">${esc(storeName(i.store))}</span></span> <span class="mini-price">${esc(priceText(i))}</span></li>`).join("")}</ul>
</section>`;
  }).join("\n")}</div>`;
}

// Items with the same key at two or more stores, side by side.
function compareTable(items) {
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
  if (!groups.length) return `<p class="muted">No item is on sale at more than one store this week.</p>`;
  return `<div class="compare">${groups.map((g) => `<details class="cmp-group" ${g.stores >= 3 ? "open" : ""}>
  <summary><strong>${esc(keyLabel(g.k))}</strong> <span class="muted">${g.stores} stores, from ${esc(money(g.rows[0].v))}${PER_LABEL[g.per]}</span></summary>
  <ul class="mini">${g.rows.map((r, n) => `<li ${attrs(r.i)}${n === 0 ? ' class="best"' : ""}><span>${esc(storeName(r.i.store))} <span class="muted">${esc(r.i.item)}</span></span> <span class="mini-price">${esc(money(r.v))}${PER_LABEL[g.per]}</span></li>`).join("")}</ul>
</details>`).join("\n")}</div>`;
}

function filterBar(items) {
  const stores = [...new Set(items.map((i) => i.store))];
  const cats = cfg.criteria.categories.filter((c) => items.some((i) => i.category === c));
  return `<div class="filters" data-filters>
  <label>Store <select data-filter="store"><option value="">All stores</option>${stores.map((s) => `<option value="${esc(s)}">${esc(storeName(s))}</option>`).join("")}</select></label>
  <label>Category <select data-filter="category"><option value="">All categories</option>${cats.map((c) => `<option value="${c}">${CATEGORY_LABELS[c]}</option>`).join("")}</select></label>
  <label>Show <select data-filter="tier"><option value="">Everything on sale</option><option value="good">Good deals and up</option><option value="standout">Standouts only</option></select></label>
  <label class="check"><input type="checkbox" data-filter="mine"> Only my stores</label>
  <button type="button" class="linkish" data-mystores-open>Choose my stores</button>
</div>`;
}

function allItems(items) {
  const cats = cfg.criteria.categories.filter((c) => items.some((i) => i.category === c));
  return `<p class="count" data-count aria-live="polite"></p>
${cats.map((c) => {
    const list = items.filter((i) => i.category === c);
    return `<details class="cat" data-cat-section open>
  <summary><h3>${esc(CATEGORY_LABELS[c])} <span class="muted" data-cat-count>${list.length}</span></h3></summary>
  <ul class="rows">${list.map((i) => row(i)).join("\n")}</ul>
</details>`;
  }).join("\n")}
<p class="empty" data-empty hidden>Nothing matches these filters.</p>`;
}

function myStoresDialog() {
  const boxes = cfg.stores
    .filter((s) => s.active && !s.no_online_flyer)
    .map((s) => `<label class="check"><input type="checkbox" value="${esc(s.id)}" data-mystore> ${esc(s.name)}</label>`)
    .join("");
  return `<dialog data-mystores>
  <form method="dialog">
    <h2>My stores</h2>
    <p class="muted">Saved in this browser only.</p>
    <div class="grid">${boxes}</div>
    <p><button value="done">Done</button></p>
  </form>
</dialog>`;
}

function weekBody(week, { current }) {
  const items = analyzed.get(week.week);
  const highlights = items.filter((i) => i.a.tier === "standout").slice(0, H.highlights);
  const counts = { standout: 0, good: 0, sale: 0 };
  for (const i of items) counts[i.a.tier]++;
  const read = week.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
  const notice = current ? "" : `<p class="notice">This is a past week. These prices have ended, and flyer links may now show a newer flyer.</p>`;
  if (!items.length) {
    return `${notice}<p>No sale items were recorded this week.</p>
<section id="flyers"><h2>Flyers</h2>${flyerList(week)}</section>`;
  }
  return `${notice}
<p class="summary">${items.length} items on sale across ${read} flyers: <strong>${counts.standout} standouts</strong>, ${counts.good} good deals.</p>
<nav class="jump" aria-label="On this page"><a href="#highlights">Highlights</a><a href="#where">Where to shop</a><a href="#categories">By category</a><a href="#compare">Compare stores</a><a href="#all">All items</a><a href="#flyers">Flyers</a></nav>
${filterBar(items)}
<section id="highlights" aria-labelledby="h-high">
  <h2 id="h-high">Highlights</h2>
  <p class="sub">The strongest sales this week, from big discounts, prices well under the US average, and the lowest prices we've listed.</p>
  <ol class="cards" data-filterable>${highlights.map((i) => card(i)).join("\n")}</ol>
</section>
<section id="where" aria-labelledby="h-where">
  <h2 id="h-where">Where to shop</h2>
  <p class="sub">Stores with the most worth buying come first.</p>
  ${whereToShop(week, items)}
</section>
<section id="categories" aria-labelledby="h-cat">
  <h2 id="h-cat">Best by category</h2>
  ${bestByCategory(items)}
</section>
<section id="compare" aria-labelledby="h-cmp">
  <h2 id="h-cmp">Compare stores</h2>
  <p class="sub">The same item on sale at more than one store, cheapest first, by price per unit.</p>
  ${compareTable(items)}
</section>
<section id="all" aria-labelledby="h-all">
  <h2 id="h-all">All items on sale</h2>
  <p class="sub"><span class="dot"></span> standout <span class="dot dot-good"></span> good deal. Within each category, the strongest come first.</p>
  <div data-filterable>${allItems(items)}</div>
</section>
<section id="flyers" aria-labelledby="h-fly">
  <h2 id="h-fly">${current ? "This week's flyers" : "Flyers that week"}</h2>
  ${flyerList(week)}
</section>
${myStoresDialog()}`;
}

function page({ title, path, body, description, map = false, extraScript = null, bodyClass = "", image = null, imageAlt = "" }) {
  const full = title ? `${title} | ${cfg.site.title}` : cfg.site.title;
  const nav = [["", "This week"], ["weeks/", "Past weeks"], ["stores/", "Stores and map"], ...(PERSIMMON_SEASON ? [["persimmons/", "Persimmons"]] : []), ["about/", "About"]]
    .map(([p, label]) => p === "persimmons/"
      ? `<a class="nav-persim" href="${url(p)}" aria-label="Persimmons" title="Persimmons"${p === path ? ' aria-current="page"' : ""}>${PERSIMMON_SVG}</a>`
      : `<a href="${url(p)}"${p === path ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description ?? cfg.site.tagline)}">
<meta property="og:site_name" content="${esc(cfg.site.title)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title || cfg.site.title)}">
<meta property="og:description" content="${esc(description ?? cfg.site.tagline)}">
<meta property="og:url" content="${esc(cfg.site.origin + cfg.site.base_path + path)}">${image ? `
<meta property="og:image" content="${esc(cfg.site.origin + cfg.site.base_path + image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(cfg.site.origin + cfg.site.base_path + image)}">` : `
<meta name="twitter:card" content="summary">`}
<link rel="icon" href="${url("assets/logo.svg")}" type="image/svg+xml">
<link rel="preload" href="${url("assets/fonts/bricolage-grotesque.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${url("assets/style.css")}">
<script src="${url("assets/app.js")}" defer></script>${extraScript ? `
<script src="${url(extraScript)}" defer></script>` : ""}${map ? `
<link rel="stylesheet" href="${url("assets/leaflet/leaflet.css")}">
<script src="${url("assets/leaflet/leaflet.js")}" defer></script>
<script src="${url("assets/map.js")}" defer></script>` : ""}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
<header class="masthead">
  <div class="masthead-inner">
    <a class="brand" href="${url()}">${LOGO}<span>${esc(cfg.site.title)}</span><small>Seattle</small></a>
    <nav>${nav}</nav>
  </div>
</header>
<main>
${body}
</main>
<footer class="site">
  <p>Prices come from store flyers and can change. Check in store. Not affiliated with any store.</p>
  <p><a href="${url("about/")}">How deals are highlighted</a> <span aria-hidden="true">&middot;</span> <a href="${esc(cfg.site.repo_url)}">Source</a></p>
</footer>
</body>
</html>
`;
}

function write(path, html) {
  const dir = join(DIST, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

// ---------- pages ----------

function homePage() {
  const body = `<h1>Grocery sales, week of ${esc(fmtDate(latest.week, { year: true }))}</h1>
<p class="lede">${esc(cfg.site.tagline)}</p>
${weekBody(latest, { current: true })}`;
  write("", page({ title: "", path: "", body }));
}

function weekPages() {
  for (const w of weeks) {
    const body = `<p class="crumb"><a href="${url("weeks/")}">Past weeks</a></p>
<h1>Week of ${esc(fmtDate(w.week, { year: true }))}</h1>
${weekBody(w, { current: w === latest })}`;
    write(`weeks/${w.week}/`, page({ title: `Week of ${fmtDate(w.week, { weekday: false, year: true })}`, path: "weeks/", body }));
  }
  const rows = [...weeks].reverse().map((w) => {
    const items = analyzed.get(w.week);
    const stand = items.filter((i) => i.a.tier === "standout");
    const read = w.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
    return `<li><a href="${url(`weeks/${w.week}/`)}">${esc(fmtDate(w.week, { year: true }))}</a>
  <span class="muted">${items.length} items, ${stand.length} standouts, ${read} flyers read</span>
  ${stand.length ? `<div class="small">Top: ${stand.slice(0, 3).map((i) => `${esc(i.item)} at ${esc(storeName(i.store))}`).join("; ")}</div>` : ""}</li>`;
  });
  write("weeks/", page({ title: "Past weeks", path: "weeks/", body: `<h1>Past weeks</h1>\n<ul class="weeks">${rows.join("\n")}</ul>` }));
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

function storeCard(s, items) {
  const f = latest.flyers.find((x) => x.store === s.id);
  const mine = items.filter((i) => i.store === s.id);
  const stand = mine.filter((i) => i.a.tier === "standout").length;
  const where = s.locations.length ? `${s.locations.length} location${s.locations.length > 1 ? "s" : ""}` : "Home delivery";
  const status = s.no_online_flyer ? "No online flyer" : f ? `${STATUS_LABELS[f.status]} this week` : "Not checked this week";
  return `<li class="info-card" data-store="${esc(s.id)}">
  <h3><a href="${url(`stores/${s.id}/`)}">${esc(s.name)}</a></h3>
  <p>${esc(s.about)}</p>
  <p class="meta">${esc(status)}${mine.length ? ` <span aria-hidden="true">&middot;</span> ${mine.length} on sale${stand ? `, <strong>${stand} standout${stand > 1 ? "s" : ""}</strong>` : ""}` : ""} <span aria-hidden="true">&middot;</span> ${esc(where)}</p>
  <p class="card-links">${s.locations.length ? `<a href="#store-map" data-map-focus="${esc(s.id)}">Show on map</a>` : ""}${!s.no_online_flyer && s.flyer_url ? ` <a href="${esc(s.flyer_url)}" rel="noopener">Flyer</a>` : ""}</p>
</li>`;
}

function storePages() {
  const items = analyzed.get(latest.week);
  const active = cfg.stores.filter((s) => s.active);
  const tracked = active.filter((s) => !s.no_online_flyer);
  const others = active.filter((s) => s.no_online_flyer);
  const toggles = active.filter((s) => s.locations.length)
    .map((s) => `<label class="check"><input type="checkbox" value="${esc(s.id)}" data-map-store checked> ${esc(s.name)}</label>`).join("");
  write("stores/", page({
    title: "Stores and map", path: "stores/", map: true,
    body: `<h1>Stores and map</h1>
<p class="lede">Every store we follow, where it is, and what it's good for. Each store is tracked by one general Seattle-area flyer; other locations may have different prices.</p>
<div id="store-map" class="map" role="region" aria-label="Map of store locations"></div>
${MAP_LEGEND}
<details class="map-toggles"><summary>Show or hide stores on the map</summary><div class="grid">${toggles}</div></details>
${mapData(active, items)}
<h2>Stores we track</h2>
<ul class="info-grid">${tracked.map((s) => storeCard(s, items)).join("\n")}</ul>
${others.length ? `<h2>Other markets worth knowing</h2>
<p class="sub">Good local markets with no online flyer, so their prices are not tracked.</p>
<ul class="info-grid">${others.map((s) => storeCard(s, items)).join("\n")}</ul>` : ""}
<p><a href="${esc(cfg.site.suggest_store_url)}">Suggest a store</a></p>`,
  }));

  for (const s of cfg.stores) {
    const period = s.sale_period.starts === "varies" ? "Varies" : `${DAY_LABELS[s.sale_period.starts]} to ${DAY_LABELS[s.sale_period.ends]}`;
    const f = latest.flyers.find((x) => x.store === s.id);
    const mine = items.filter((i) => i.store === s.id);
    const history = [...weeks].slice(0, -1).reverse().flatMap((w) =>
      analyzed.get(w.week).filter((i) => i.store === s.id && i.a.tier !== "sale").map((i) => ({ week: w.week, i })),
    );
    const thisWeek = f
      ? `<p><span class="status-pill status-${f.status}">${STATUS_LABELS[f.status]}</span> ${datesText(f)}</p>
<p class="links">${flyerLinks(f, s)}</p>${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}`
      : `<p class="muted">Not checked this week.</p>${s.flyer_url ? `<p><a href="${esc(s.flyer_url)}" rel="noopener">Store flyer page</a></p>` : ""}`;
    const histRows = history.map(({ week, i }) => `<tr>
  <td><a href="${url(`weeks/${week}/`)}">${esc(fmtDate(week, { weekday: false }))}</a></td>
  <td>${esc(i.item)}</td>
  <td>${esc(priceText(i))}${unitPriceIsExtra(i) ? `<br><span class="muted">${esc(unitPriceText(i.unit_price))}</span>` : ""}</td>
  <td>${esc(TIER_LABELS[i.a.tier])}</td>
</tr>`);
    const locs = s.locations.length
      ? `<ul class="locations">${s.locations.map((l) => `<li><strong>${esc(l.label)}</strong> <span class="muted">${esc(l.address)}</span>${s.no_online_flyer ? "" : l.flyer ? ` <span class="tag">Flyer tracked here</span>` : ` <span class="tag tag-member">Prices may differ</span>`}</li>`).join("")}</ul>`
      : `<p class="muted">Home delivery only, no store to visit.</p>`;
    const facts = s.no_online_flyer
      ? `<dl class="facts">${s.website ? `<dt>Website</dt><dd><a href="${esc(s.website)}" rel="noopener">${esc(s.website.replace(/^https:\/\/(www\.)?/, ""))}</a></dd>` : ""}<dt>Flyer</dt><dd>${esc(s.flyer_url_note)}</dd></dl>`
      : `<dl class="facts">
  <dt>Flyer</dt><dd>${s.flyer_url ? `<a href="${esc(s.flyer_url)}" rel="noopener">${esc(s.flyer_url.replace(/^https:\/\/(www\.)?/, ""))}</a>` : "No fixed link"}${s.flyer_url_note ? `<br><span class="muted">${esc(s.flyer_url_note)}</span>` : ""}</dd>
  <dt>Sale period</dt><dd>${esc(period)}${s.sale_period.note ? `<br><span class="muted">${esc(s.sale_period.note)}</span>` : ""}</dd>
  <dt>Format</dt><dd>${FORMAT_LABELS[s.flyer_format]}</dd>
  <dt>Regular prices</dt><dd>${s.prints_regular_prices ? "Printed" : "Not printed, so staples are compared to US averages"}</dd>
  <dt>Flyer used</dt><dd>${esc(s.representative_location)}</dd>
  ${s.website ? `<dt>Website</dt><dd><a href="${esc(s.website)}" rel="noopener">${esc(s.website.replace(/^https:\/\/(www\.)?/, ""))}</a></dd>` : ""}
</dl>`;
    const body = `<p class="crumb"><a href="${url("stores/")}">Stores and map</a></p>
<h1>${esc(s.name)}</h1>
<p class="lede">${esc(s.about)}</p>
${s.locations.length ? `<div id="store-map" class="map map-small" role="region" aria-label="Map of ${esc(s.name)} locations"></div>${mapData([s], items)}` : ""}
<h2>Locations</h2>
${locs}
${facts}
${s.no_online_flyer ? "" : `<h2>This week (${esc(fmtDate(latest.week, { weekday: false }))})</h2>
${thisWeek}
${mine.length ? `<ul class="rows">${mine.map((i) => row(i, { showStore: false })).join("\n")}</ul>` : ""}
<h2>Good deals in past weeks</h2>
${histRows.length ? `<div class="table-wrap"><table><thead><tr><th>Week</th><th>Item</th><th>Price</th><th></th></tr></thead><tbody>${histRows.join("")}</tbody></table></div>` : `<p class="muted">None yet.</p>`}`}`;
    write(`stores/${s.id}/`, page({ title: s.name, path: "stores/", body, map: s.locations.length > 0 }));
  }
}

// ---------- persimmon season ----------

const PERSIMMON_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="38" rx="26" ry="21" fill="#f07c1e"/><ellipse cx="32" cy="40" rx="22" ry="16" fill="#f7932f"/><ellipse cx="22" cy="33" rx="6" ry="4" fill="#ffc27a" opacity=".75"/><path d="M32 17l-11-4 5 8-10 3h11l5 7 5-7h11l-10-3 5-8z" fill="#3f7a2b"/><rect x="30.5" y="10" width="3" height="7" rx="1.5" fill="#5b3a1e"/></svg>`;

function inPersimmonSeason(iso) {
  const md = iso.slice(5);
  const { from, to } = cfg.site.persimmon_season;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
const PERSIMMON_SEASON = inPersimmonSeason(latest.week);
const isFuyu = (i) => /fuyu/i.test(i.item);
const isPersimmon = (i) => i.item_key === "persimmons" || /persimmon/i.test(i.item);

function persimmonPage() {
  const items = analyzed.get(latest.week).filter(isPersimmon).filter((i) => i.unit_price);
  const fuyu = items.filter(isFuyu).sort((a, b) => a.unit_price.value - b.unit_price.value);
  const others = items.filter((i) => !isFuyu(i)).sort((a, b) => a.unit_price.value - b.unit_price.value);
  const best = fuyu[0];
  // A Fuyu weighs about 7 oz.
  const per10 = best && best.unit_price.per === "lb" ? Math.floor(10 / (best.unit_price.value * 7 / 16)) : null;

  const log = [...weeks].reverse().map((w) => {
    const f = analyzed.get(w.week).filter((i) => isPersimmon(i) && isFuyu(i) && i.unit_price).sort((a, b) => a.unit_price.value - b.unit_price.value)[0];
    return f ? { week: w.week, f } : null;
  }).filter(Boolean);
  const maxLog = Math.max(...log.map((l) => l.f.unit_price.value), 1);

  const hero = best
    ? `<section class="persim-hero" aria-labelledby="best-h">
  <div class="persim-mascot" data-bounce>${PERSIMMON_SVG}</div>
  <p class="persim-kicker">The best Fuyu persimmon deal in town</p>
  <h2 id="best-h" class="persim-price">${esc(priceText(best))}</h2>
  <p class="persim-where">at <a href="${url(`stores/${best.store}/`)}">${esc(storeName(best.store))}</a>${best.valid_through ? `, through ${esc(fmtDate(best.valid_through))}` : ""}</p>
  <p class="persim-item">${esc(best.item)}</p>
  ${per10 ? `<p class="persim-math">That's about <strong>${per10} persimmons for $10</strong>.<span class="muted"> Roughly, at 7 oz a persimmon. We did the math so you don't have to.</span></p>` : ""}
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
${runners.length ? `<section><h2>Also on sale</h2><ul class="persim-list">${runners.map((i) => `<li><span>${esc(i.item)} <a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a></span><strong>${esc(priceText(i))}</strong></li>`).join("")}</ul></section>` : ""}
${others.length ? `<section><h2>Other persimmons</h2><p class="sub">The flyer didn't say which kind. Could be Fuyu, could be Hachiya. Ask before you bite.</p><ul class="persim-list">${others.map((i) => `<li><span>${esc(i.item)} <a href="${url(`stores/${i.store}/`)}">${esc(storeName(i.store))}</a></span><strong>${esc(priceText(i))}</strong></li>`).join("")}</ul></section>` : ""}
${log.length ? `<section><h2>The persimmon price log</h2><p class="sub">Cheapest Fuyu we listed each week.</p>
<ol class="persim-log">${log.map((l) => `<li><span class="pl-week">${esc(fmtDate(l.week, { weekday: false }))}</span><span class="pl-bar" style="--w:${Math.round((l.f.unit_price.value / maxLog) * 100)}%"><span>${esc(money(l.f.unit_price.value))}/lb</span></span><span class="pl-store">${esc(storeName(l.f.store))}</span></li>`).join("")}</ol></section>` : ""}
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
  const desc = best ? `The best Fuyu persimmon deal in town this week: ${priceText(best)} at ${storeName(best.store)}.` : "Where to buy Fuyu persimmons in Seattle this week.";
  write("persimmons/", page({ title: "Where to buy persimmons this week", path: "persimmons/", body, description: desc,
    image: "assets/img/persimmons-og.jpg", imageAlt: "Fuyu persimmons, one cut open", extraScript: "assets/persimmons.js", bodyClass: "persimmon" }));
}

function aboutPage() {
  const c = cfg.criteria;
  const body = `<h1>About</h1>
<p>Every Friday this site lists what's on sale in Seattle-area grocery flyers, so you can see what's cheap where and plan where to shop. It links to every store's flyer for the week.</p>
<h2>What's listed</h2>
<p>Every sale item that could be read from each flyer. Prices are never guessed. Anything that could not be read clearly is left out, and regular prices or percent off appear only when the store printed them.</p>
<h2>How deals are highlighted</h2>
<p><span class="dot"></span> <strong>Standouts</strong> are any of these:</p>
<ul>
  <li>At least ${c.standout.min_percent_off_priority}% off a printed regular price for produce, meat, seafood and staples, or ${c.standout.min_percent_off_other}% off for anything else.</li>
  <li>A staple priced at ${Math.round(c.standout.max_us_average_ratio * 100)}% or less of the US average price from the <a href="${esc(cfg.benchmarksFile.source_url)}">Bureau of Labor Statistics</a>. These are national averages, not Seattle prices, so the comparison is approximate.</li>
  <li>Lower than any price this site has listed before for the same item.</li>
  <li>Hand-picked, with a short note on why.</li>
</ul>
<p><span class="dot dot-good"></span> <strong>Good deals</strong> are at least ${c.good.min_percent_off}% off, under ${Math.round(c.good.max_us_average_ratio * 100)}% of the US average, matching the lowest price we've listed, or the cheapest of several stores this week.</p>
<p>Everything else is still on sale and still listed. Many stores print no regular price, so an unmarked item can still be a good buy.</p>
<h2>Where to shop and comparing stores</h2>
<p>"Where to shop" ranks stores by how many standouts and good deals they have this week. "Compare stores" puts the same item side by side when it's on sale at more than one store, by price per unit.</p>
<h2>Flyers</h2>
<p>Each store is tracked by one general Seattle-area flyer, not by location. Flyers that could not be read, or still show last week's dates, are marked as such. This site links to the flyers and does not copy them.</p>
<h2>Check in store</h2>
<p>Prices come from store flyers and can change, sell out, or differ by location. Check in store before you rely on a price. This site is not affiliated with any store.</p>
<h2>Suggest a store</h2>
<p>Know a Seattle-area store with a public weekly flyer? <a href="${esc(cfg.site.suggest_store_url)}">Open a suggestion on GitHub</a> (needs a free GitHub account).</p>
<h2>Privacy</h2>
<p>No accounts, analytics or tracking. Your "my stores" choice is saved only in your browser. The store map loads its map tiles from OpenStreetMap.</p>
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

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, "site", "assets"), join(DIST, "assets"), { recursive: true });
writeFileSync(join(DIST, ".nojekyll"), "");
homePage();
weekPages();
storePages();
aboutPage();
persimmonPage();
dataPages();
notFound();
console.log(`Built ${weeks.length} week(s), latest ${latest.week}, into dist/ with base ${BASE}`);
