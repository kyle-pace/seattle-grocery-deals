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

  const asks = String(opts.query ?? "")
    .split(/[,;\n]/)
    .map((q) => ({ text: q.trim(), words: words(q) }))
    .filter((q) => q.words.length);

  const minTier = opts.rating === "standout" ? 0 : opts.rating === "good" ? 1 : 2;
  const storeName = (id) => feed.stores.find((s) => s.id === id)?.name ?? id;
  const aisleName = (id) => feed.categories.find((c) => c.id === id)?.label ?? id;

  const pool = live(feed, today, opts.include_ended).filter(
    (i) =>
      (!store || i.store === store.id) &&
      (!category || i.category === category.id) &&
      (!opts.vegetarian || i.veg) &&
      (TIER_ORDER[i.tier] ?? 2) <= minTier,
  );

  let found = [...pool].sort((a, b) => a.rank - b.rank); // the site's order: best first
  if (asks.length) {
    // A word matches a deal when it's in the deal's name, item key, aisle or store, or starts
    // a word in the name ("mushroom" finds "mushrooms, king oyster"; 4+ letters only).
    const groups = asks.map((a) => ({ ...a, hits: [] }));
    for (const i of found) {
      const nameWords = words(`${i.name} ${i.key ?? ""}`);
      const allWords = new Set([...nameWords, ...words(`${aisleName(i.category)} ${storeName(i.store)}`)]);
      const has = (w) => allWords.has(w) || (w.length >= 4 && nameWords.some((n) => n.startsWith(w)));
      for (const g of groups) if (g.words.every(has)) g.hits.push(i);
    }
    const missing = groups.filter((g) => !g.hits.length).map((g) => g.text);
    if (missing.length) notes.push(`Nothing on sale this week matching: ${missing.join(", ")}.`);
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

  return {
    week_of: feed.week,
    updated: feed.updated,
    total_matching: found.length,
    deals: found.slice(0, limit).map((i) => dealOut(feed, i)),
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
  const stores = [...feed.stores].sort((a, b) => score(feed, b.id, opts.vegetarian) - score(feed, a.id, opts.vegetarian));
  return {
    week_of: feed.week,
    updated: feed.updated,
    stores: stores.map((s) => storeOut(feed, s, opts.vegetarian)),
    source: `${SITE}/stores/`,
  };
}

// The front page in one answer: where to shop, the best single deals, and what's in season.
export function thisWeek(feed, opts = {}, today = seattleToday()) {
  const items = live(feed, today, false).filter((i) => !opts.vegetarian || i.veg);
  const byId = new Map(feed.items.map((i) => [i.id, i]));
  const stores = [...feed.stores]
    .sort((a, b) => score(feed, b.id, opts.vegetarian) - score(feed, a.id, opts.vegetarian))
    .map((s) => {
      const rank = feed.store_ranks?.[s.id];
      const r = opts.vegetarian ? rank?.veg : rank;
      if (!r) return null;
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
      };
    })
    .filter(Boolean);

  const seasons = (feed.seasons ?? []).map((s) => {
    const best = byId.get(s.best);
    return {
      name: s.name ?? s.label,
      best_price: best ? `${best.name}, ${best.text} at ${feed.stores.find((x) => x.id === best.store)?.name ?? best.store}` : null,
      stores_with_it: s.stores ?? null,
      page: s.url ?? null,
    };
  });

  return {
    week_of: feed.week,
    updated: feed.updated,
    today,
    deal_count: items.length,
    store_count: stores.filter((s) => s.deals > 0).length,
    where_to_shop: stores,
    best_single_deals: [...items].sort((a, b) => a.rank - b.rank).slice(0, 10).map((i) => dealOut(feed, i)),
    ...(seasons.length ? { in_season: seasons } : {}),
    aisles: feed.categories.map((c) => c.label),
    about: "Seattle-area grocery flyer sales on food for cooking, from specialty grocers (Asian markets, seafood shops, co-ops). Prices are the ones each store printed and can change. Not affiliated with any store.",
    source: `${SITE}/`,
  };
}
