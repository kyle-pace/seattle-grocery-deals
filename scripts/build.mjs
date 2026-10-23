// Builds the static site into dist/. Usage: node scripts/build.mjs
// Set BASE_PATH=/ to build for a local server at the root.
import { mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, loadConfig, loadWeeks, esc, fmtDate, fmtPeriod, money, priceText, unitPriceText,
  unitPriceIsExtra, usAverageRatio, score, convertPer, priorListings,
} from "./lib.mjs";

const cfg = loadConfig();
const BASE = process.env.BASE_PATH ?? cfg.site.base_path;
const DIST = join(ROOT, "dist");
const weeks = loadWeeks().map((w) => w.data); // oldest first
if (!weeks.length) throw new Error("No week files in data/weeks");
const latest = weeks[weeks.length - 1];

const CATEGORY_LABELS = {
  produce: "Produce", meat: "Meat", seafood: "Seafood", "dairy-eggs": "Dairy and eggs", pantry: "Pantry",
  frozen: "Frozen", bakery: "Bakery", prepared: "Prepared", "snacks-drinks": "Snacks and drinks", other: "Other",
};
const STATUS_LABELS = { full: "Read in full", partial: "Partly read", stale: "Stale", unreadable: "Unreadable" };
const FORMAT_LABELS = { "web-page": "Web page", images: "Flyer images", pdf: "PDF", "catalogue-viewer": "Catalogue viewer" };
const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

const url = (p = "") => BASE + p;
const storeName = (id) => cfg.storeById[id]?.name ?? id;

// ---------- badges from history ----------

function comparable(d) {
  return d.unit_price ? { value: d.unit_price.value, per: d.unit_price.per } : null;
}

function sameUnit(a, b) {
  if (!a || !b) return null;
  const v = convertPer(b.value, b.per, a.per);
  return v == null ? null : v;
}

function decorate(week, index) {
  const prior = weeks.slice(0, index).flatMap((w) => w.deals);
  const listings = priorListings(weeks, week.week);
  const minPrior = cfg.criteria.badges.lowest_listed_min_prior_listings;
  return week.deals
    .map((d) => {
      const badges = [];
      const up = comparable(d);
      const rivals = week.deals.filter((o) => o !== d && o.item_key === d.item_key && o.store !== d.store);
      if (up && rivals.length) {
        const cheaper = rivals.some((o) => {
          const v = sameUnit(up, comparable(o));
          return v != null && v < up.value;
        });
        const anyComparable = rivals.some((o) => sameUnit(up, comparable(o)) != null);
        if (anyComparable && !cheaper) badges.push("Cheapest this week");
      }
      const history = prior.filter((o) => o.item_key === d.item_key).map((o) => sameUnit(up, comparable(o))).filter((v) => v != null);
      if (up && history.length >= minPrior && up.value <= Math.min(...history)) badges.push("Lowest we've listed");
      return { ...d, badges, score: score(d, cfg, listings) };
    })
    .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item));
}

const decorated = new Map(weeks.map((w, i) => [w.week, decorate(w, i)]));

// ---------- pieces ----------

function referenceText(d) {
  if (d.reference === "printed") {
    if (d.regular_price != null) return `Regular ${priceText(d, d.regular_price)}, ${d.percent_off}% off`;
    return `${d.percent_off}% off as printed`;
  }
  if (d.reference === "us-average") {
    const ratio = usAverageRatio(d);
    const pct = Math.round((1 - ratio) * 100);
    const a = d.us_average;
    const per = a.per === "each" ? " each" : `/${a.per === "l" ? "L" : a.per}`;
    let t = `About ${pct}% under the US average (${money(a.price)}${per}, BLS ${fmtPeriod(a.period)}). Approximate.`;
    if (d.regular_price != null) t = `Regular ${priceText(d, d.regular_price)}. ` + t;
    return t;
  }
  if (d.reference === "site-history") {
    const h = d.site_history;
    const per = h.per === "each" ? " each" : `/${h.per === "l" ? "L" : h.per}`;
    return `Below the lowest price we've listed before: ${money(h.price)}${per} at ${storeName(h.store)}, week of ${fmtDate(h.week, { weekday: false })}.`;
  }
  return "No regular price printed and nothing to compare against. Picked on price.";
}

function dealCard(d) {
  const extra = unitPriceIsExtra(d) ? `<span class="unit">${esc(unitPriceText(d.unit_price))}</span>` : "";
  const badges = [
    ...d.badges.map((b) => `<span class="badge">${esc(b)}</span>`),
    d.member_price ? `<span class="badge member">Member price</span>` : "",
  ].join("");
  return `<li class="deal" data-store="${esc(d.store)}" data-category="${esc(d.category)}">
  <div class="deal-head">
    <h3>${esc(d.item)}</h3>
    <p class="price">${esc(priceText(d))} ${extra}</p>
  </div>
  <p class="meta"><a href="${url(`stores/${d.store}/`)}">${esc(storeName(d.store))}</a> <span aria-hidden="true">&middot;</span> ${esc(CATEGORY_LABELS[d.category])} <span aria-hidden="true">&middot;</span> through ${esc(fmtDate(d.valid_through))}</p>
  <p class="reason">${esc(d.reason)}</p>
  <p class="ref">${esc(referenceText(d))}</p>
  ${d.notes ? `<p class="notes">${esc(d.notes)}</p>` : ""}
  ${badges ? `<p class="badges">${badges}</p>` : ""}
</li>`;
}

function flyerLinks(f, store) {
  if (f.links.length) return f.links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join(" ");
  if (store.flyer_url) return `<a href="${esc(store.flyer_url)}" rel="noopener">Store flyer page</a>`;
  return `<span class="muted">No link recorded</span>`;
}

function flyerRows(week) {
  const byStore = Object.fromEntries(week.flyers.map((f) => [f.store, f]));
  const rows = cfg.stores
    .filter((s) => s.active && s.tracked_since <= week.week)
    .map((s) => {
      const f = byStore[s.id];
      if (!f) {
        return `<li class="flyer status-none" data-store="${esc(s.id)}">
  <div><a class="store" href="${url(`stores/${s.id}/`)}">${esc(s.name)}</a> <span class="status">Not checked</span></div>
  <div class="links">${s.flyer_url ? `<a href="${esc(s.flyer_url)}" rel="noopener">Store flyer page</a>` : `<span class="muted">No link</span>`}</div>
</li>`;
      }
      const dates = f.valid_from || f.valid_through
        ? `${f.valid_from ? esc(fmtDate(f.valid_from)) : "?"} to ${f.valid_through ? esc(fmtDate(f.valid_through)) : "?"}`
        : `<span class="muted">Dates not recorded</span>`;
      return `<li class="flyer status-${f.status}" data-store="${esc(s.id)}">
  <div><a class="store" href="${url(`stores/${s.id}/`)}">${esc(s.name)}</a> <span class="status">${STATUS_LABELS[f.status]}</span></div>
  <div class="dates">${dates}</div>
  <div class="links">${flyerLinks(f, s)}</div>
  ${f.note ? `<div class="note">${esc(f.note)}</div>` : ""}
</li>`;
    });
  return `<ul class="flyers">${rows.join("\n")}</ul>`;
}

function filters(deals) {
  const stores = [...new Set(deals.map((d) => d.store))];
  const cats = cfg.criteria.categories.filter((c) => deals.some((d) => d.category === c));
  return `<div class="filters" data-filters>
  <label>Store <select data-filter="store"><option value="">All stores</option>${stores.map((s) => `<option value="${esc(s)}">${esc(storeName(s))}</option>`).join("")}</select></label>
  <label>Category <select data-filter="category"><option value="">All categories</option>${cats.map((c) => `<option value="${c}">${CATEGORY_LABELS[c]}</option>`).join("")}</select></label>
  <label class="check"><input type="checkbox" data-filter="mine"> Only my stores</label>
  <button type="button" class="linkish" data-mystores-open>Choose my stores</button>
</div>
<p class="count" data-count aria-live="polite"></p>`;
}

function myStoresDialog() {
  const boxes = cfg.stores
    .filter((s) => s.active)
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

function weekSection(week, { current }) {
  const deals = decorated.get(week.week);
  const note = current ? "" : `<p class="notice">This is a past week. These prices have ended, and flyer links may now show a newer flyer.</p>`;
  return `${note}
<section aria-labelledby="deals-h">
  <h2 id="deals-h">Good deals <span class="muted">(${deals.length})</span></h2>
  ${deals.length ? filters(deals) : ""}
  ${deals.length ? `<ol class="deals" data-deals>${deals.map(dealCard).join("\n")}</ol><p class="empty" data-empty hidden>No deals match these filters.</p>` : `<p>No deals met the bar this week.</p>`}
</section>
<section aria-labelledby="flyers-h">
  <h2 id="flyers-h">${current ? "This week's flyers" : "Flyers that week"}</h2>
  ${flyerRows(week)}
</section>
${myStoresDialog()}`;
}

function page({ title, path, body, description }) {
  const full = title ? `${title} | ${cfg.site.title}` : cfg.site.title;
  const nav = [["", "This week"], ["weeks/", "Past weeks"], ["stores/", "Stores"], ["about/", "About"]]
    .map(([p, label]) => `<a href="${url(p)}"${p === path ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description ?? cfg.site.tagline)}">
<link rel="stylesheet" href="${url("assets/style.css")}">
<script src="${url("assets/app.js")}" defer></script>
</head>
<body>
<header class="site">
  <a class="brand" href="${url()}">${esc(cfg.site.title)}</a>
  <nav>${nav}</nav>
</header>
<main>
${body}
</main>
<footer class="site">
  <p>Prices come from store flyers and can change. Check in store. Not affiliated with any store.</p>
  <p><a href="${url("about/")}">How deals are picked</a> <span aria-hidden="true">&middot;</span> <a href="${esc(cfg.site.repo_url)}">Source</a></p>
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
  const body = `<h1>Grocery deals, week of ${esc(fmtDate(latest.week, { year: true }))}</h1>
<p class="lede">${esc(cfg.site.tagline)} Strongest deals first.</p>
${weekSection(latest, { current: true })}`;
  write("", page({ title: "", path: "", body }));
}

function weekPages() {
  for (const w of weeks) {
    const current = w === latest;
    const body = `<p class="crumb"><a href="${url("weeks/")}">Past weeks</a></p>
<h1>Week of ${esc(fmtDate(w.week, { year: true }))}</h1>
${weekSection(w, { current })}`;
    write(`weeks/${w.week}/`, page({ title: `Week of ${fmtDate(w.week, { weekday: false, year: true })}`, path: "weeks/", body }));
  }
  const rows = [...weeks].reverse().map((w) => {
    const top = decorated.get(w.week)[0];
    const read = w.flyers.filter((f) => f.status === "full" || f.status === "partial").length;
    return `<li><a href="${url(`weeks/${w.week}/`)}">${esc(fmtDate(w.week, { year: true }))}</a>
  <span class="muted">${w.deals.length} deals, ${read} flyers read</span>
  ${top ? `<div class="small">Top: ${esc(top.item)} at ${esc(storeName(top.store))}, ${esc(priceText(top))}</div>` : ""}</li>`;
  });
  write("weeks/", page({ title: "Past weeks", path: "weeks/", body: `<h1>Past weeks</h1>\n<ul class="weeks">${rows.join("\n")}</ul>` }));
}

function storePages() {
  const list = cfg.stores.filter((s) => s.active).map((s) => {
    const f = latest.flyers.find((x) => x.store === s.id);
    return `<li><a class="store" href="${url(`stores/${s.id}/`)}">${esc(s.name)}</a>
  <span class="muted">${f ? STATUS_LABELS[f.status] : "Not checked"} this week</span></li>`;
  });
  write("stores/", page({
    title: "Stores", path: "stores/",
    body: `<h1>Stores</h1>
<p>Each store is tracked by one general Seattle-area flyer, not by location.</p>
<ul class="stores">${list.join("\n")}</ul>
<p><a href="${esc(cfg.site.suggest_store_url)}">Suggest a store</a></p>`,
  }));

  for (const s of cfg.stores) {
    const period = s.sale_period.starts === "varies" ? "Varies" : `${DAY_LABELS[s.sale_period.starts]} to ${DAY_LABELS[s.sale_period.ends]}`;
    const f = latest.flyers.find((x) => x.store === s.id);
    const history = [...weeks].reverse().flatMap((w) =>
      decorated.get(w.week).filter((d) => d.store === s.id).map((d) => ({ week: w.week, d })),
    );
    const histRows = history.map(({ week, d }) => `<tr>
  <td><a href="${url(`weeks/${week}/`)}">${esc(fmtDate(week, { weekday: false }))}</a></td>
  <td>${esc(d.item)}</td>
  <td>${esc(priceText(d))}${unitPriceIsExtra(d) ? `<br><span class="muted">${esc(unitPriceText(d.unit_price))}</span>` : ""}</td>
  <td>${d.percent_off != null && d.reference === "printed" ? `${d.percent_off}% off` : d.reference === "us-average" ? `${Math.round((1 - usAverageRatio(d)) * 100)}% under US avg.` : d.reference === "site-history" ? "Lowest listed" : ""}</td>
</tr>`);
    const thisWeek = f
      ? `<p><span class="status-pill status-${f.status}">${STATUS_LABELS[f.status]}</span> ${f.valid_from || f.valid_through ? `${f.valid_from ? esc(fmtDate(f.valid_from)) : "?"} to ${f.valid_through ? esc(fmtDate(f.valid_through)) : "?"}` : ""}</p>
<p class="links">${flyerLinks(f, s)}</p>${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}`
      : `<p class="muted">Not checked this week.</p>${s.flyer_url ? `<p><a href="${esc(s.flyer_url)}" rel="noopener">Store flyer page</a></p>` : ""}`;
    const body = `<p class="crumb"><a href="${url("stores/")}">Stores</a></p>
<h1>${esc(s.name)}</h1>
<dl class="facts">
  <dt>Flyer</dt><dd>${s.flyer_url ? `<a href="${esc(s.flyer_url)}" rel="noopener">${esc(s.flyer_url.replace(/^https:\/\/(www\.)?/, ""))}</a>` : "No fixed link"}${s.flyer_url_note ? `<br><span class="muted">${esc(s.flyer_url_note)}</span>` : ""}</dd>
  <dt>Sale period</dt><dd>${esc(period)}${s.sale_period.note ? `<br><span class="muted">${esc(s.sale_period.note)}</span>` : ""}</dd>
  <dt>Format</dt><dd>${FORMAT_LABELS[s.flyer_format]}</dd>
  <dt>Regular prices</dt><dd>${s.prints_regular_prices ? "Printed" : "Not printed, so staples are compared to US averages"}</dd>
  <dt>Flyer used</dt><dd>${esc(s.representative_location)}</dd>
  ${s.website ? `<dt>Website</dt><dd><a href="${esc(s.website)}" rel="noopener">${esc(s.website.replace(/^https:\/\/(www\.)?/, ""))}</a></dd>` : ""}
</dl>
<h2>This week (${esc(fmtDate(latest.week, { weekday: false }))})</h2>
${thisWeek}
<h2>Deals we've listed</h2>
${histRows.length ? `<div class="table-wrap"><table><thead><tr><th>Week</th><th>Item</th><th>Price</th><th>Deal</th></tr></thead><tbody>${histRows.join("")}</tbody></table></div>` : `<p class="muted">None yet.</p>`}`;
    write(`stores/${s.id}/`, page({ title: s.name, path: "stores/", body }));
  }
}

function aboutPage() {
  const c = cfg.criteria;
  const p = c.printed_discount;
  const body = `<h1>About</h1>
<p>Every Friday this site lists the good sales from Seattle-area grocery flyers, with a short reason for each, and links to every store's flyer for the week.</p>
<h2>How deals are picked</h2>
<p>Each flyer is read in full. A sale makes the list when it meets one of these:</p>
<ul>
  <li><strong>A real discount.</strong> At least ${p.min_percent_off_priority}% off a regular price the store printed, for produce, meat, seafood and staples. Other categories need at least ${p.min_percent_off_other}% off.</li>
  <li><strong>A notably low price for a staple.</strong> When a store prints no regular price, staples like produce, meat, seafood, eggs and rice can still make the list if their price per unit is ${Math.round(c.us_average.max_ratio * 100)}% or less of the US average price from the <a href="${esc(cfg.benchmarksFile.source_url)}">Bureau of Labor Statistics</a>. These comparisons are approximate: they are national averages, not Seattle prices.</li>
  <li><strong>Lower than we've listed before.</strong> A staple priced below the lowest price this site has listed for the same item at any store.</li>
  <li><strong>A clearly good price, on judgment.</strong> Some produce, meat and seafood has no printed regular price and no average to compare with, such as fresh salmon at a seafood market. Those can still be listed when the price is clearly good, and they are marked as having no reference price.</li>
</ul>
<p>Prices are never guessed, and regular prices or percent off are never made up. Anything that could not be read clearly is left out. "Save up to" amounts do not count as a regular price. Member or loyalty-card prices are labeled.</p>
<p>The list leans toward produce and protein. The strongest deals come first.</p>
<h2>Badges</h2>
<ul>
  <li><strong>Cheapest this week:</strong> the lowest price per unit for that item among the stores listed this week.</li>
  <li><strong>Lowest we've listed:</strong> as low as or lower than every earlier listing of that item on this site, once there are at least ${c.badges.lowest_listed_min_prior_listings} earlier listings.</li>
</ul>
<h2>Flyers</h2>
<p>Each store is tracked by one general Seattle-area flyer, not by location. Flyers that could not be read, or still show last week's dates, are marked as such. This site links to the flyers and does not copy them.</p>
<h2>Check in store</h2>
<p>Prices come from store flyers and can change, sell out, or differ by location. Check in store before you rely on a price. This site is not affiliated with any store.</p>
<h2>Suggest a store</h2>
<p>Know a Seattle-area store with a public weekly flyer? <a href="${esc(cfg.site.suggest_store_url)}">Open a suggestion on GitHub</a> (needs a free GitHub account).</p>
<h2>Privacy</h2>
<p>No accounts, analytics or tracking. Your "my stores" choice is saved only in your browser.</p>
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
  writeFileSync(join(DIST, "404.html"), page({ title: "Not found", path: "", body: `<h1>Not found</h1>\n<p><a href="${url()}">Go to this week's deals</a></p>` }));
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, "site", "assets"), join(DIST, "assets"), { recursive: true });
writeFileSync(join(DIST, ".nojekyll"), "");
homePage();
weekPages();
storePages();
aboutPage();
dataPages();
notFound();
console.log(`Built ${weeks.length} week(s), latest ${latest.week}, into dist/ with base ${BASE}`);
