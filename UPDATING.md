# Updating: how to make a week's file

Each week gets one file, `data/weeks/YYYY-MM-DD.json`, named for that Friday's Pacific date. It is built from the Friday "All Items" note and must pass `npm run validate` before it is pushed. Pushing to `main` rebuilds and deploys the site.

This document is the contract. Follow it exactly.

## 1. Inputs

The Friday routine writes a note at:

```
<vault>/00 Weekly/Weekly Deals/All Items/All Items YYYY-MM-DD.md
```

It has a `## Flyers` list (store, valid dates, flyer links) and a `## Items` table with these columns:

| Store | Item (as printed) | Sale price | Unit | Regular price (only if printed) | Valid through | Category | Notes |

Any price that could not be read says `unverified`. Those rows are never used.

## 2. Steps

1. Pull the latest `main`.
2. Make a draft:
   ```
   npm install
   npm run draft -- "<vault>/00 Weekly/Weekly Deals/All Items/All Items YYYY-MM-DD.md"
   ```
   This writes `drafts/YYYY-MM-DD.draft.json` (not committed). It has:
   - `flyers`: one entry per store line, with status, dates and links parsed from the note.
   - `candidates`: every readable item with its price, unit, unit price, regular price, percent off, a suggested `item_key`, and whether it meets the criteria with that key.
   - `skipped`: unverified rows and rows it could not parse.
3. Create `data/weeks/YYYY-MM-DD.json` with `week`, `flyers` and `deals` (section 4).
4. Copy the flyers. Check each against its source line in the note. Fix dates or status by hand if the parse is wrong. Add a `note` for anything a visitor should know (see section 5).
5. Pick the deals (section 3). Use the candidates as a starting point, but check every suggested `item_key` and every parsed number against the note. Look over the items with no suggested key too.
6. Write a one-line `reason` for each deal (section 6).
7. Run `npm run check` (validate, then build). Fix every error. Warnings are fine when they are expected, such as a store that was not checked this week.
8. Commit only the new week file, plus any `config/items.json` keys you added:
   ```
   git add data/weeks/YYYY-MM-DD.json config/items.json
   git commit -m "Add week YYYY-MM-DD"
   git push
   ```
   The GitHub Actions workflow validates, builds and deploys. If the workflow fails, the live site stays on the previous week.

## 3. Picking deals

The thresholds live in `config/criteria.json`. The validator enforces them, so a deal that does not qualify will fail the build.

A sale qualifies when it meets one of these tests. Use the first one that applies, in this order, because the stronger the evidence, the better:

**A. Printed discount** (`reference: "printed"`)
- The store printed a regular price, or an exact savings amount ("save $2.00/lb"), or a percent off.
- Percent off is at least `min_percent_off_priority` (25) for produce, meat and seafood, and at least `min_percent_off_staple` (25) for staple items (see `staple` in `config/items.json`, such as rice).
- Everything else needs at least `min_percent_off_other` (40). These are the "only when clearly strong" categories.
- The store must have `prints_regular_prices: true` in `config/stores.json`.

**B. Low price per unit for a staple** (`reference: "us-average"`)
- The item is marked `staple: true` in `config/items.json` and has a `benchmark`.
- Its unit price is at most `max_ratio` (0.75) of the US average in `config/benchmarks.json`.
- Use this for stores that print no regular price (Lam's, Red Apple, H Mart and others). You can also use it for any store when it is the stronger case, as long as the deal really qualifies on it.
- The site labels these comparisons as approximate.

**C. Lower than the site has listed before** (`reference: "site-history"`)
- The item is a staple, and its unit price is strictly lower than the lowest earlier listing of the same `item_key` on this site, at any store (`site_history.min_prior_listings`, currently 1).
- Fill `site_history` with that earlier listing: `{ "price", "per", "week", "store" }`. The validator works it out and tells you the right values. The draft helper shows it too.
- Only earlier listed deals count, not every item seen in past notes.

**D. Clearly good, on judgment** (`reference: "none"`)
- Allowed only in `no_reference.categories` (produce, meat and seafood).
- For items with no printed regular price, no benchmark and no earlier listing, such as fresh salmon at Lam's or flanken short ribs at H Mart, when the price is clearly good for that item.
- The reason must say why, in concrete terms: compare it with another price in the same note if you can ("under $9/lb, against $12.99 elsewhere this week"). If you cannot say why, leave it out.
- These rank below the other tests.

Then:
- Lean toward produce and protein. Do not pad the list. Five strong deals beat fifteen weak ones.
- If the same item qualifies at several stores, list each. The build marks the cheapest.
- If nothing at a store qualifies, list no deals for it. Its flyer still appears.

Hard rules:
- **Never guess a price.** If a number is unclear, leave the item out.
- **Never invent a regular price or percent off.** Only use what the store printed. An exact printed savings amount counts: the regular price is the sale price plus the savings. "Save up to $X" does not count.
- **Never use anything marked `unverified`.**
- Grocery Outlet "compare at" prices are other retailers' prices, not a printed regular price.
- **Member, loyalty-card, app-only and Prime prices:** set `member_price: true` and name the program in `notes`.
- **No items from a stale or unreadable flyer.**

## 4. Fields

### Flyers

One entry per store checked this week.

| Field | Rule |
|---|---|
| `store` | Store id from `config/stores.json`. |
| `status` | `full`: every page, image or category was read. `partial`: some of it was not read; say what in `note`. `stale`: the printed dates are not this week (for example Lam's on Friday morning). `unreadable`: no prices could be read. |
| `valid_from`, `valid_through` | The printed dates, as `YYYY-MM-DD`. Use `null` if none were printed. For a stale flyer, use the old printed dates. |
| `links` | The exact link to this week's flyer. A store with several pages or images gets one link per page, labeled `Page 1`, `Page 2`, and so on. If there is no page-specific link, use the store's flyer page. Use `[]` only when no link exists at all. |
| `note` | Optional, up to 300 characters, such as "Meat and produce specials run Friday to Monday only." |

Stores in `config/stores.json` that are not listed show as "Not checked" on the site.

### Deals

| Field | Rule |
|---|---|
| `store` | Store id. That store's flyer entry must be `full` or `partial`. |
| `item` | The item name as printed. You may add the pack size, as in "Shirakiku Sekka Rice, 15 lb". |
| `item_key` | A key from `config/items.json`. If none fits, add one (see below). |
| `category` | Must match the key's category in `config/items.json`. |
| `price` | The sale price as printed, for `quantity` units. |
| `quantity` | `1`, unless the price is a multi-buy: for "4 for $5", `price` is `5` and `quantity` is `4`. |
| `unit` | `lb` for a per-pound price, `each` for per item, `pack` for a package. |
| `pack` | Only when `unit` is `pack`: `{ "size": 15, "unit": "lb" }`. Units: `lb`, `oz`, `kg`, `g`, `l`, `ml`, `fl-oz`, `gal`, `ct`, `dozen`. Use `dozen` for eggs (an 18-count carton is `{ "size": 1.5, "unit": "dozen" }`). |
| `unit_price` | `{ "value", "per" }`, rounded to cents. Weight packs give per `lb`, volume packs per `l`, count packs per `each`, dozens per `dozen`. The validator recomputes it and tells you the right number. |
| `regular_price` | Only if printed, for the same quantity and unit as `price`. Otherwise `null`. |
| `percent_off` | Whole number. Computed from `regular_price` when there is one (`round((1 - price / regular) * 100)`), or as printed when only a percent was printed. Otherwise `null`. |
| `reference` | `printed`, `us-average`, `site-history` or `none`: the test the deal qualifies on (section 3). |
| `us_average` | For `us-average` deals: copy the benchmark from `config/benchmarks.json` as `{ "benchmark", "price", "per", "period" }`. Otherwise `null`. |
| `site_history` | For `site-history` deals: the lowest earlier listing, `{ "price", "per", "week", "store" }`. Otherwise `null`. |
| `member_price` | `true` for member or loyalty prices, otherwise `false`. |
| `reason` | One line, 10 to 140 characters. See section 6. |
| `valid_through` | The last day of the sale price. Usually the flyer's last day, but shorter when the flyer says so (H Mart meat often ends Monday). |
| `notes` | Limits, while supplies last, member details, location caveats. Use an empty string when there are none. |

### Adding an item key

Add an entry to `config/items.json`: lowercase words joined by hyphens, such as `"pork-shoulder"`, with `label`, `category`, `staple`, an optional `benchmark` and `match` words. Reuse an existing key whenever the item is the same thing, because keys are how prices are compared across weeks and stores. Keep keys about as specific as a shopper would compare: `salmon-atlantic`, not `salmon-atlantic-fillet-skin-on`.

## 5. Store notes

- **Lam's:** two images. One covers the Seattle store only; the other covers both Seattle and Tukwila. For items only on the combined image, add this note: "On the flyer covering both the Seattle and Tukwila stores, so it may only be at Tukwila." If the images still show last week's dates, the flyer is `stale`.
- **H Mart:** meat and produce prices often end Monday. Use that date as the deal's `valid_through`, and say so in the flyer note.
- **Smith Brothers:** a two-week delivery cycle, so its dates span two weeks. A deal can appear in both weeks.
- **Central Co-op:** often keeps old dates for weeks. Mark it `stale` when the dates are wrong.
- **PCC:** if the sales page shows no items, mark it `unreadable`.
- For every store's reading notes, see `how_to_read` in `config/stores.json`.

## 6. Writing reasons

The site already shows the price, the regular price or US average, and the percent off under each deal. The reason should say in plain words why it stands out, without repeating those numbers:
- Good: "Half price, the biggest discount on any protein this week."
- Good: "Boneless breast under $3/lb, well below the national average."
- Good: "About 73 cents a pound, the cheapest rice we have listed so far."
- Avoid: "53% off the printed $7.49/lb." (repeats the line below it)

Rules:
- One sentence, 140 characters or fewer.
- Plain facts about price and the item. No meal plans, no shopping advice, nothing personal.
- If you cite a number, make sure it matches the data.
- **No em dashes** anywhere. Use a comma, a colon or a new sentence. The validator rejects them.

## 7. Privacy

Only store and price facts go in this repo. No names, emails, addresses, home locations, pantry contents, meal plans, or anything from the personal parts of the vault notes.

## 8. Refreshing US averages

`config/benchmarks.json` holds BLS US city average prices. Refresh it about once a month when BLS publishes new data. For each benchmark, fetch its series from the BLS public API and update `price` and `period`:

```
curl -s -X POST https://api.bls.gov/publicAPI/v1/timeseries/data/ \
  -H "Content-Type: application/json" \
  -d '{"seriesid":["APU0000FD3101"]}'
```

The newest value is `Results.series[0].data[0]` (skip entries whose value is `-`). Update `updated` at the top of the file. Past weeks keep the benchmark they were judged against, because each deal stores its own copy.

## 9. Common validator errors

| Error | Fix |
|---|---|
| `does not meet the criteria` | The deal is too weak. Remove it, or check that `reference` and the numbers are right. |
| `unit_price should be X` | Use the number the validator gives. |
| `does not print regular prices (config)` | That store has no printed regular prices, so use another test or drop the deal. If the store does print them now, update `config/stores.json`. |
| `site_history should be ...` | Copy the values the validator gives. |
| `no-reference deals are only allowed in ...` | Only produce, meat and seafood can be listed without a reference. |
| `item_key ... not in config/items.json` | Use an existing key or add one. |
| `flyer status is stale` | Deals cannot come from a stale or unreadable flyer. |
| `em dash` | Replace it. |
