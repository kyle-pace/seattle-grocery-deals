// The answers behind the MCP tools: plain functions over the site's feed
// (https://seattlegrocery.deals/api/week.json, written by scripts/build.mjs).
// No network and no MCP here, so `npm test` can run them with a small made-up feed.

export const SITE = "https://seattlegrocery.deals";

const TIER_WORDS = { standout: "Standout", good: "Good deal", sale: "On sale" };
const TIER_ORDER = { standout: 0, good: 1, sale: 2 };

// Today's date in Seattle as YYYY-MM-DD, so "ended" means the same thing here as on the site.
export function seattleToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

// "Chicken Thighs" -> ["chicken", "thigh"]: lowercase, no accents or punctuation, and a light
// trim of plurals so "tomatoes" finds "tomato" and "thighs" finds "thigh".
export function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(singular);
}

function singular(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

// A store by id ("hmart"), name ("H Mart") or a loose match ("h-mart", "ranch 99").
export function findStore(feed, wanted) {
  if (!wanted) return null;
  const flat = (s) => words(s).join("");
  const want = flat(wanted);
  if (!want) return null;
  const stores = feed.stores;
  return (
    stores.find((s) => s.id === wanted) ??
    stores.find((s) => flat(s.id) === want || flat(s.name) === want) ??
    stores.find((s) => flat(s.name).includes(want) || want.includes(flat(s.name))) ??
    stores.find((s) => words(wanted).every((w) => words(`${s.id} ${s.name}`).includes(w))) ??
    null
  );
}

export function findCategory(feed, wanted) {
  if (!wanted) return null;
  const want = words(wanted).join(" ");
  return (
    feed.categories.find((c) => c.id === wanted) ??
    feed.categories.find((c) => words(c.label).join(" ") === want || words(c.id).join(" ") === want) ??
    feed.categories.find((c) => words(`${c.id} ${c.label}`).some((w) => words(wanted).includes(w))) ??
    null
  );
}

// "Your stores": the stores a person shops at (`stores`) and the ones they never do
// (`skip_stores`). Each is a list, or one string with commas, of ids or names. The app and the
// site keep this on the device; here the assistant passes it on each call, or the connection's
// address carries it (?stores=uwajimaya,pcc&skip=99-ranch), so nothing is stored.
export function storeList(feed, wanted) {
  const asked = (Array.isArray(wanted) ? wanted : String(wanted ?? "").split(/[,;\n]/)).map((w) => String(w).trim()).filter(Boolean);
  const found = [];
  const unknown = [];
  for (const w of asked) {
    const s = findStore(feed, w);
    if (!s) unknown.push(w);
    else if (!found.includes(s)) found.push(s);
  }
  return { found, unknown };
}

// The person's stores for one call: `mine` (ids they shop at, empty when they named none),
// `skip` (ids to leave out everywhere), and notes for names that matched nothing.
function yourStores(feed, opts) {
  const mine = storeList(feed, opts.stores);
  const skip = storeList(feed, opts.skip_stores);
  const skipIds = new Set(skip.found.map((s) => s.id));
  const notes = [];
  const unknown = [...mine.unknown, ...skip.unknown];
  if (unknown.length) notes.push(`No store here matches: ${unknown.join(", ")}. See list_stores for the stores covered.`);
  return { mine: mine.found.filter((s) => !skipIds.has(s.id)), skipIds, notes };
}

// A week with little on: under 3 standouts and 6 good deals (the same line scripts/lib.mjs draws).
const quiet = (r) => !r || ((r.standouts ?? 0) < 3 && (r.good ?? 0) < 6);

// Does this deal match the words asked for? A word matches when it's in the deal's name, item
// key, aisle or store, or starts a word in the name ("mushroom" finds "mushrooms, king
// oyster"; 4+ letters only).
// `nameOnly` leaves the aisle and store out: a shopping list's "eggs" means eggs, not everything
// in Dairy & eggs (plan_trip once counted soy milk and yogurt as eggs).
function matcher(feed, { nameOnly = false } = {}) {
  const storeName = (id) => feed.stores.find((s) => s.id === id)?.name ?? id;
  const aisleName = (id) => feed.categories.find((c) => c.id === id)?.label ?? id;
  return (item) => {
    const nameWords = words(`${item.name} ${item.key ?? ""}`);
    const allWords = new Set([...nameWords, ...(nameOnly ? [] : words(`${aisleName(item.category)} ${storeName(item.store)}`))]);
    const has = (w) => allWords.has(w) || (w.length >= 4 && nameWords.some((n) => n.startsWith(w)));
    return (askWords) => askWords.every(has);
  };
}

const asksFrom = (text) =>
  (Array.isArray(text) ? text : String(text ?? "").split(/[,;\n]/))
    .map((q) => ({ text: String(q).trim(), words: words(q) }))
    .filter((q) => q.words.length);

// One deal the way an assistant should repeat it: printed prices as text, never recomputed.
export function dealOut(feed, item) {
  const store = feed.stores.find((s) => s.id === item.store);
  const aisle = feed.categories.find((c) => c.id === item.category);
  const out = {
    name: item.name,
    price: item.text,
    store: store?.name ?? item.store,
    store_id: item.store,
    aisle: aisle?.label ?? item.category,
    rating: TIER_WORDS[item.tier] ?? item.tier,
  };
  if (item.regular) out.regular_price = item.regular;
  if (item.off) out.percent_off = item.off;
  if (item.unit_price && item.unit_price !== item.text) out.unit_price = item.unit_price;
  if (item.why) out.why = item.why;
  if (item.us) out.us_average = `${item.us.under}% under the US average of ${item.us.avg}`;
  if (item.lowest) out.lowest_listed = true;
  out.vegetarian = Boolean(item.veg);
  if (item.ends) out.ends = item.ends;
  if (item.notes) out.notes = item.notes;
  return out;
}

function live(feed, today, includeEnded) {
  return includeEnded ? feed.items : feed.items.filter((i) => !i.ends || i.ends >= today);
}

// Search this week's deals. `query` is one or more things to look for, separated by commas
// ("chicken thighs, tofu, bok choy"): a deal matches when every word of any one of them is in
// its name, item key, aisle or store. No query lists everything the filters allow, best first.
export function searchDeals(feed, opts = {}, today = seattleToday()) {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 60);
  const notes = [];

  let store = null;
  if (opts.store) {
    store = findStore(feed, opts.store);
    if (!store) return { error: `No store matches "${opts.store}".`, stores: feed.stores.map((s) => ({ id: s.id, name: s.name })) };
  }
  let category = null;
  if (opts.aisle) {
    category = findCategory(feed, opts.aisle);
    if (!category) return { error: `No aisle matches "${opts.aisle}".`, aisles: feed.categories };
  }

  const asks = asksFrom(opts.query);

  // Your stores: a search stays inside them unless one store was named or `everywhere` is set.
  const yours = yourStores(feed, opts);
  notes.push(...yours.notes);
  const mineIds = new Set(yours.mine.map((s) => s.id));
  const inYours = !store && !opts.everywhere && mineIds.size > 0;

  const minTier = opts.rating === "standout" ? 0 : opts.rating === "good" ? 1 : 2;

  const allowed = live(feed, today, opts.include_ended).filter(
    (i) =>
      (store ? i.store === store.id : !yours.skipIds.has(i.store)) &&
      (!category || i.category === category.id) &&
      (!opts.vegetarian || i.veg) &&
      (TIER_ORDER[i.tier] ?? 2) <= minTier,
  );
  const pool = inYours ? allowed.filter((i) => mineIds.has(i.store)) : allowed;

  let found = [...pool].sort((a, b) => a.rank - b.rank); // the site's order: best first
  if (asks.length) {
    const matches = matcher(feed);
    const groups = asks.map((a) => ({ ...a, hits: [] }));
    for (const i of found) {
      const has = matches(i);
      for (const g of groups) if (has(g.words)) g.hits.push(i);
    }
    const missing = groups.filter((g) => !g.hits.length).map((g) => g.text);
    if (missing.length) notes.push(`Nothing on sale this week${inYours ? " at your stores" : ""} matching: ${missing.join(", ")}.`);
    // Take turns between the things asked for, so a long list of chicken deals doesn't push
    // the tofu off the end.
    const seen = new Set();
    found = [];
    for (let n = 0; groups.some((g) => n < g.hits.length); n++) {
      for (const g of groups) {
        const i = g.hits[n];
        if (i && !seen.has(i.id)) {
          seen.add(i.id);
          found.push(i);
        }
      }
    }
  }

  if (found.length > limit) notes.push(`Showing ${limit} of ${found.length}. Narrow by store, aisle or rating, or raise limit (up to 60).`);

  // What the same search finds at stores the person didn't name, as a count per store, so the
  // assistant can say so without sending them all over town.
  let elsewhere = null;
  if (inYours) {
    const matches = matcher(feed);
    const counts = new Map();
    for (const i of allowed) {
      if (mineIds.has(i.store)) continue;
      if (asks.length && !asks.some((a) => matches(i)(a.words))) continue;
      counts.set(i.store, (counts.get(i.store) ?? 0) + 1);
    }
    elsewhere = [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ store: feed.stores.find((s) => s.id === id)?.name ?? id, store_id: id, matching_deals: n }));
    if (elsewhere.length) notes.push("Only your stores are searched. `elsewhere` counts matches at other stores; set everywhere to true to see them.");
  }

  return {
    week_of: feed.week,
    updated: feed.updated,
    ...(mineIds.size ? { your_stores: yours.mine.map((s) => s.name) } : {}),
    total_matching: found.length,
    deals: found.slice(0, limit).map((i) => dealOut(feed, i)),
    ...(elsewhere?.length ? { elsewhere } : {}),
    ...(notes.length ? { notes } : {}),
    source: store ? `${SITE}/stores/${store.id}/` : `${SITE}/`,
  };
}

function storeOut(feed, s, vegetarian) {
  const rank = feed.store_ranks?.[s.id];
  const r = vegetarian ? rank?.veg : rank;
  const out = { id: s.id, name: s.name, about: s.about };
  if (r) {
    out.this_week = r.reason;
    out.deals = r.deals;
    out.standouts = r.standouts;
    out.good_deals = r.good;
  }
  if (s.from || s.through) out.flyer_dates = { from: s.from, through: s.through };
  if (s.status && s.status !== "full") out.flyer_status = s.status;
  out.locations = (s.locations ?? []).map((l) => (l.address ? `${l.label}: ${l.address}` : l.label));
  if (s.delivery) out.delivery = s.delivery;
  if (s.flyer_url) out.weekly_ad = s.flyer_url;
  out.page = `${SITE}/stores/${s.id}/`;
  return out;
}

const score = (feed, id, vegetarian) => {
  const r = feed.store_ranks?.[id];
  return (vegetarian ? r?.veg?.score : r?.score) ?? 0;
};

// Every store the site covers, best week first.
export function listStores(feed, opts = {}) {
  const yours = yourStores(feed, opts);
  const mineIds = new Set(yours.mine.map((s) => s.id));
  // Every store is listed (this is the answer to "which stores do you cover?"); the person's
  // stores come first and are marked.
  const stores = [...feed.stores].sort(
    (a, b) => mineIds.has(b.id) - mineIds.has(a.id) || score(feed, b.id, opts.vegetarian) - score(feed, a.id, opts.vegetarian),
  );
  return {
    week_of: feed.week,
    updated: feed.updated,
    ...(mineIds.size ? { your_stores: yours.mine.map((s) => s.name) } : {}),
    stores: stores.map((s) => ({ ...storeOut(feed, s, opts.vegetarian), ...(mineIds.has(s.id) ? { yours: true } : {}), ...(yours.skipIds.has(s.id) ? { skipped: true } : {}) })),
    ...(yours.notes.length ? { notes: yours.notes } : {}),
    source: `${SITE}/stores/`,
  };
}

// The front page in one answer: where to shop, the best single deals, and what's in season.
// With `stores`, it follows the app's "Best of your stores" rules: only your stores are ranked;
// one other store is named under `elsewhere` only when it has 5+ standouts and beats your best
// by 1.5x (or your stores are having a quiet week); your stores with nothing listed stay, with
// a link to their ad. `skip_stores` are left out of everything.
export function thisWeek(feed, opts = {}, today = seattleToday()) {
  const yours = yourStores(feed, opts);
  const mineIds = new Set(yours.mine.map((s) => s.id));
  const picked = mineIds.size > 0;
  const rankOf = (id) => {
    const rank = feed.store_ranks?.[id];
    return opts.vegetarian ? rank?.veg : rank;
  };
  const byId = new Map(feed.items.map((i) => [i.id, i]));
  const card = (s) => {
    const r = rankOf(s.id);
    if (!r) {
      if (!mineIds.has(s.id)) return null;
      return { id: s.id, name: s.name, this_week: "No deals listed this week.", deals: 0, standouts: 0, flyer_through: s.through ?? null, top_deals: [], ...(s.flyer_url ? { weekly_ad: s.flyer_url } : {}) };
    }
    return {
      id: s.id,
      name: s.name,
      this_week: r.reason,
      deals: r.deals,
      standouts: r.standouts,
      flyer_through: s.through ?? null,
      top_deals: (r.top ?? [])
        .map((id) => byId.get(id))
        .filter((i) => i && (!i.ends || i.ends >= today))
        .map((i) => `${i.name}, ${i.text}`),
      ...(mineIds.has(s.id) && !r.deals && s.flyer_url ? { weekly_ad: s.flyer_url } : {}),
    };
  };
  const ranked = [...feed.stores]
    .filter((s) => !yours.skipIds.has(s.id))
    .sort((a, b) => score(feed, b.id, opts.vegetarian) - score(feed, a.id, opts.vegetarian));
  const stores = ranked.filter((s) => !picked || mineIds.has(s.id)).map(card).filter(Boolean);

  // One store worth a detour, by the app's rule.
  let elsewhere = null;
  if (picked) {
    const best = ranked.find((s) => mineIds.has(s.id));
    const bestScore = best ? score(feed, best.id, opts.vegetarian) : 0;
    const yoursQuiet = !best || quiet(rankOf(best.id));
    const other = ranked.find((s) => !mineIds.has(s.id));
    const r = other && rankOf(other.id);
    if (r && (r.standouts ?? 0) >= 5 && (yoursQuiet || score(feed, other.id, opts.vegetarian) >= bestScore * 1.5)) elsewhere = card(other);
  }

  const shown = new Set(stores.map((s) => s.id));
  const items = live(feed, today, false).filter((i) => (!opts.vegetarian || i.veg) && !yours.skipIds.has(i.store));
  const bestFrom = picked ? items.filter((i) => shown.has(i.store)) : items;

  const seasons = (feed.seasons ?? []).map((s) => {
    const best = byId.get(s.best);
    return {
      name: s.name ?? s.label,
      best_price: best ? `${best.name}, ${best.text} at ${feed.stores.find((x) => x.id === best.store)?.name ?? best.store}` : null,
      stores_with_it: s.stores ?? null,
      page: s.url ?? null,
    };
  });

  const notes = [...yours.notes];
  if (picked) notes.push("Ranked for the person's stores only. Recommend one store for a trip, the first under where_to_shop unless they ask otherwise.");

  return {
    week_of: feed.week,
    updated: feed.updated,
    today,
    ...(picked ? { your_stores: yours.mine.map((s) => s.name) } : {}),
    deal_count: items.length,
    store_count: new Set(items.map((i) => i.store)).size,
    where_to_shop: stores,
    ...(elsewhere ? { elsewhere } : {}),
    best_single_deals: [...bestFrom].sort((a, b) => a.rank - b.rank).slice(0, 10).map((i) => dealOut(feed, i)),
    ...(seasons.length ? { in_season: seasons } : {}),
    aisles: feed.categories.map((c) => c.label),
    ...(notes.length ? { notes } : {}),
    about: "Seattle-area grocery flyer sales on food for cooking, from specialty grocers (Asian markets, seafood shops, co-ops). Prices are the ones each store printed and can change. Not affiliated with any store.",
    source: `${SITE}/`,
  };
}

// One trip, one store: for a list of things to buy, which single store has the most of them on
// sale this week. Each store comes back with how many of the items it covers, its best deal
// for each, and what it's missing; best coverage first, ties broken by better deals and then
// by the store's week. With `stores`, only the person's stores are compared, and one other
// store is named under `elsewhere` only if it covers more of the list than any of theirs.
export function planTrip(feed, opts = {}, today = seattleToday()) {
  const asks = asksFrom(opts.items);
  if (!asks.length) return { error: "Give the things to buy in `items`, separated by commas, for example 'salmon, tofu, bok choy'." };
  const yours = yourStores(feed, opts);
  const mineIds = new Set(yours.mine.map((s) => s.id));
  const picked = mineIds.size > 0;
  const notes = [...yours.notes];

  const pool = live(feed, today, false)
    .filter((i) => !yours.skipIds.has(i.store) && (!opts.vegetarian || i.veg))
    .sort((a, b) => a.rank - b.rank);
  const matches = matcher(feed, { nameOnly: true });
  // store id -> ask text -> its best (first by site rank) matching deal
  const byStore = new Map();
  // A deal whose main name has the item ("Baby Bok Choy") beats one that only mentions it further
  // along ("Wontons, Pork / Spinach / Bok Choy"), even when the mention ranks higher on the site.
  const mainWords = (i) => words(String(i.name).split(/[,(]/)[0]);
  const isMain = (i, a) => { const m = mainWords(i); return a.words.every((w) => m.includes(w) || (w.length >= 4 && m.some((n) => n.startsWith(w)))); };
  const mainHit = new Set();
  for (const i of pool) {
    const has = matches(i);
    for (const a of asks) {
      // The store's own name shouldn't count as having an item ("market" at every market).
      if (!has(a.words) || a.words.every((w) => words(feed.stores.find((s) => s.id === i.store)?.name ?? "").includes(w))) continue;
      if (!byStore.has(i.store)) byStore.set(i.store, new Map());
      const got = byStore.get(i.store);
      const key = `${i.store}|${a.text}`;
      const main = isMain(i, a);
      if (!got.has(a.text) || (main && !mainHit.has(key))) got.set(a.text, i);
      if (main) mainHit.add(key);
    }
  }

  const plan = (s) => {
    const got = byStore.get(s.id) ?? new Map();
    const deals = [...got].map(([asked, i]) => ({ item: asked, ...dealOut(feed, i) }));
    return {
      id: s.id,
      name: s.name,
      covers: got.size,
      of: asks.length,
      quality: [...got.values()].reduce((n, i) => n + (2 - (TIER_ORDER[i.tier] ?? 2)), 0),
      on_sale: deals.map(({ store, store_id, aisle, ...d }) => d),
      not_on_sale_here: asks.filter((a) => !got.has(a.text)).map((a) => a.text),
      flyer_through: s.through ?? null,
      page: `${SITE}/stores/${s.id}/`,
    };
  };
  const order = (a, b) => b.covers - a.covers || b.quality - a.quality || score(feed, b.id, opts.vegetarian) - score(feed, a.id, opts.vegetarian);
  const all = feed.stores.filter((s) => !yours.skipIds.has(s.id)).map(plan).sort(order);
  const tidy = ({ quality, ...p }) => p;
  const compared = (picked ? all.filter((p) => mineIds.has(p.id)) : all.filter((p) => p.covers > 0)).map(tidy);

  let elsewhere = null;
  if (picked) {
    const bestMine = compared[0]?.covers ?? 0;
    const other = all.find((p) => !mineIds.has(p.id));
    if (other && other.covers > bestMine) elsewhere = tidy(other);
  }

  const nowhere = asks.filter((a) => !all.some((p) => p.on_sale.some((d) => d.item === a.text))).map((a) => a.text);
  if (nowhere.length) notes.push(`Not on sale at any store compared this week: ${nowhere.join(", ")}. They may still be sold at regular price.`);
  const best = compared[0]?.covers ? compared[0] : null;
  if (!best) notes.push(picked ? "None of these are on sale at the person's stores this week." : "None of these are on sale this week.");
  notes.push("On sale means in this week's flyer. A store usually carries the rest at regular price, so one store can still be the whole trip.");

  return {
    week_of: feed.week,
    updated: feed.updated,
    ...(picked ? { your_stores: yours.mine.map((s) => s.name) } : {}),
    items: asks.map((a) => a.text),
    best_store: best ? { id: best.id, name: best.name, covers: best.covers, of: best.of } : null,
    stores: compared,
    ...(elsewhere ? { elsewhere } : {}),
    notes,
    source: `${SITE}/`,
  };
}
