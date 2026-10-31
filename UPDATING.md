# Updating: how to make a week's file

Each week gets one file, `data/weeks/YYYY-MM-DD.json`, named for that Friday's Pacific date. It lists every flyer checked and **every readable sale item for cooking** from them (snacks and packaged convenience food are left out, section 3). The build highlights and ranks the items, so the weekly job is mostly copying and checking, plus a few hand-written reasons.

The file must pass `npm run validate` before it is pushed. Pushing to `main` rebuilds and deploys the site.

## 1. Input

The Friday routine writes a note at:

```
<vault>/00 Weekly/Weekly Deals/All Items/All Items YYYY-MM-DD.md
```

It has a `## Flyers` list (store, valid dates, flyer links) and a `## Items` table with these columns:

| Store | Item (as printed) | Sale price | Unit | Regular price (only if printed) | Valid through | Category | Notes |

Any price that could not be read says `unverified`. Those rows are never used.

## 2. Steps

1. Pull the latest `main`, then run `npm install` if needed.
2. Make the draft:
   ```
   npm run draft -- "<vault>/00 Weekly/Weekly Deals/All Items/All Items YYYY-MM-DD.md"
   ```
   This writes:
   - `drafts/YYYY-MM-DD.json`: a complete week file with every flyer and every readable item.
   - `drafts/YYYY-MM-DD.report.json`: skipped rows, rows left out as snacks or packaged food (`left_out`), and things to check by hand.

   It also prints the top items by score and the list of things to check.
3. Review the draft against the note (section 4).
4. Add a `highlight` with a one-line reason to the few items most worth calling out (section 5). This is optional, but aim for 3 to 6 a week.
5. Move it into place and check it:
   ```
   mv drafts/YYYY-MM-DD.json data/weeks/
   npm run check
   ```
   Fix every error. Warnings are fine when they are expected, such as a store that was not checked this week.
6. Commit and push:
   ```
   git add data/weeks/YYYY-MM-DD.json config/items.json
   git commit -m "Add week YYYY-MM-DD"
   git push
   ```
   GitHub Actions validates, builds and deploys. If it fails, the live site stays on the previous week.

## 3. What goes in

- **Every sale item for cooking whose price was read clearly.** Do not filter for "good deals". The site shows everything and highlights the strong ones itself.
- **Leave out snacks and packaged convenience food** (decided 2026-10-26). The site is for cooking ingredients. Most things stay; skip only these:
  - **Snacks and sweets:** chips, crackers, popcorn, candy, chocolate bars, packaged cookies and toaster pastries, snack bars, jerky, ice cream and other frozen desserts.
  - **Drinks:** soda, juice, bottled tea and coffee, kombucha, energy and protein drinks, drink mixes and powders.
  - **Ready-made meals:** frozen pizza, burritos, entrees and meals, instant and cup noodles, boxed side mixes, mac and cheese, lunch kits, salad kits, deli salads and sandwiches, kimbap, nuggets, taquitos and similar heat-and-eat appetizers.
  - **Keep:** all produce, meat and seafood (marinated and seasoned cuts too), eggs, milk and plant milks, cheese, yogurt (yogurt drinks and tubes too), butter, coffee creamers, tofu, everything from the bakery (bread, tortillas, donuts, cakes, pastries, sweet buns), rice, flour and baking mixes, cereal and granola, dried and fresh noodles, oils, vinegars, sauces, condiments, spices, canned basics (coconut milk, beans, tomatoes, fish, meats), soup and broth, coffee beans and ground coffee, tea bags, frozen vegetables, fruit, seafood and meat, frozen dumplings, dim sum, buns, egg tarts and spring rolls, fish balls and fish cakes, kimchi, plant-based meat. (Dim sum, buns, spring rolls, cereal, granola, soup, creamers, yogurt drinks and sweet bakery items were put back in on 2026-10-26.)
  - When unsure, keep it. The draft drops what slips through (below), and `config/leave-out.json` holds the words and categories it uses.
- **Never guess a price.** If a number is unclear, leave that item out.
- **Never invent a regular price or percent off.** Only use what the store printed. An exact printed savings amount counts: the regular price is the sale price plus the savings. "Save up to $X" does not count; put that text in `notes` instead.
- **Never use anything marked `unverified`.**
- Grocery Outlet "compare at" prices are other retailers' prices, not a printed regular price.
- **Member, loyalty-card, app-only and Prime prices:** set `member_price: true` and name the program in `notes`.
- **No items from a stale or unreadable flyer.** Its flyer entry still goes in.
- Food only.
- **One row per deal, not per flavor** (2026-10-31). When the flyer prints one price for a product line and lists the flavors or varieties (Zoi Honey, Lemon Cream and Raspberry Cream Greek Yogurt, all $1.29), the note can list them as printed; the draft joins rows from the same store with the same deal (price, pack, unit price, regular price, dates, category, key and notes) whose names start with the same brand into one row, such as "Zoi Greek Yogurt, Honey / Lemon Cream / Raspberry Cream". It leaves names that already hold a list ("," or "/"), names that share only a generic first word (Organic, Fresh, Pork) and a store's own label (Metropolitan Market salad and soup aren't one product). Different sizes or prices stay separate rows.

## 4. Reviewing the draft

Check against the note:
- **Flyers:** status, dates and links. The parser guesses status from words like "partly", "stale" and "unreadable". Partly read and stale flyers need a `note`; the draft fills one in from the note's line, so tidy it up.
- **Item keys:** the "Check by hand" list shows items with no suggested key, or a key whose category disagrees with the note. Keys matter because they power "Compare stores", "Lowest we've listed" and US average comparisons.
- **Keys from KitchenCatalog:** the draft also reads every name with KitchenCatalog's matcher. When that finds a Deals key the match words missed, or a different one, the line says so and it's listed under `suggested_keys` in the report. Take a suggestion only when the deal compares on price with that key's other listings: same kind of product and the same unit. Leave it `null` for drinks, mixes and ready-made versions (yogurt drinks aren't `yogurt`, liquid egg whites aren't `eggs`), for pre-sliced cuts that have no key of their own (sliced shoulder for shabu isn't `pork-shoulder`), and for specialty versions priced far from the rest (matsutake isn't `mushrooms`).
  - Fix wrong keys. A key is wrong when it would compare unlike things (for example Kurobuta sliced loin against a plain loin roast).
  - Use `null` for one-off items with no fair comparison.
  - Add a key to `config/items.json` for items that will come up again.
- **Left out:** the draft drops rows in the `snacks-drinks` and `prepared` categories, rows whose name says a snack or ready-made word (sweet bakery words only outside `bakery` and `frozen`), and rows KitchenCatalog reads as a ready-made product other than those kept (`config/leave-out.json`). The `bakery` category is always kept. Each one is listed under `left_out` in the report with the reason. If one belongs (a cooking ingredient caught by a word), add a phrase to `keep_words` and redraft. The validator warns about any snack or packaged item that's still in a week file from 2026-10-30 on.
- **Joined flavors:** the draft lists each row it made from flavors under `merged_variants` in the report. Check the names read well, and split any that aren't really one product line. The validator warns about flavor rows still listed separately in a week file from 2026-10-30 on.
- **Prices and units:** spot-check multi-buys ("3/$4"), pack sizes and anything the report lists as skipped for parsing.

## 5. Highlights

A `highlight` marks an item as a standout and shows a reason on its card:

```json
"highlight": { "reason": "Half price, the biggest discount on any protein this week." }
```

Use it for:
- items the build already ranks high, where a reason helps (the draft prints the top 15);
- good buys the numbers cannot see, such as fresh salmon at a seafood market that prints no regular price. Say why in concrete terms, and compare with another price in the same note if you can ("under $9/lb, against $12.99 elsewhere this week").

Reason rules:
- One sentence, 10 to 140 characters.
- The card already shows the price, regular price, percent off, US average and badges. Say what makes it stand out rather than repeating those numbers.
- Plain facts about price and the item. No meal plans, no shopping advice, nothing personal.
- **No em dashes** anywhere. Use a comma, a colon or a new sentence. The validator rejects them.

## 6. How the site ranks items

The settings are in `config/criteria.json`. Every item gets a tier:

- **Standout:** hand-highlighted, or at least 25% off a printed regular price for produce, meat, seafood and staples (40% for other categories), or a staple at 75% or less of the US average, or lower than any earlier listing of the same item key (with at least 2 earlier listings).
- **Good deal:** at least 15% off, under 90% of the US average, the cheapest of several stores this week, or matching the lowest earlier listing.
- **On sale:** everything else.

"Where to shop" ranks stores by standouts, then by the strength of their best items. "Compare stores" groups items with the same key at two or more stores. US average comparisons use `config/benchmarks.json`.

## 7. Fields

### Flyers

| Field | Rule |
|---|---|
| `store` | Store id from `config/stores.json`. |
| `status` | `full`: every page, image or category was read. `partial`: some was not read; say what in `note`. `stale`: the printed dates are not this week. `unreadable`: no prices could be read. |
| `valid_from`, `valid_through` | The printed dates, as `YYYY-MM-DD`, or `null` if none were printed. For a stale flyer, use the old printed dates. |
| `links` | The exact link to this week's flyer, one per page or image (`Page 1`, `Page 2`, ...). **Link the page images and PDFs themselves** (the `.jpg`, `.png` or `.pdf` URL, or the image CDN URL), not only the page that shows them: the iPhone app shows them in its own flyer viewer, and a flyer with only web links opens in Safari instead. Put the store's flyer page last, labeled `Flyer page`. If there is no page-specific link, use the store's flyer page. `[]` only when no link exists. The validator warns when a read flyer has no image or PDF, unless the store has `web_only_flyer: true` in `config/stores.json` (its specials are only a web page, like Smith Brothers). |
| `note` | Optional, up to 300 characters. Required for `partial`. |

### Items

| Field | Rule |
|---|---|
| `store` | Store id. Its flyer entry must be `full` or `partial`. |
| `item` | The name as printed. You may add the pack size, as in "Shirakiku Sekka Rice, 15 lb". |
| `item_key` | A key from `config/items.json`, or `null`. |
| `category` | `produce`, `meat`, `seafood`, `dairy-eggs`, `pantry`, `frozen`, `bakery` or `other`. `prepared` and `snacks-drinks` are no longer used from 2026-10-30 (section 3): sliced deli meat and cheese go in `meat` and `dairy-eggs`, plain milks in `dairy-eggs`, coffee beans and tea bags in `pantry`, tofu in `other`. |
| `price` | The sale price as printed, for `quantity` units. |
| `quantity` | `1`, unless it is a multi-buy: for "4 for $5", `price` is `5` and `quantity` is `4`. |
| `unit` | `lb` per pound, `each` per item, `pack` per package. |
| `pack` | Only when `unit` is `pack`: `{ "size": 15, "unit": "lb" }`. Units: `lb`, `oz`, `kg`, `g`, `l`, `ml`, `fl-oz`, `gal`, `ct`, `dozen`. Use `dozen` for eggs. |
| `unit_price` | `{ "value", "per" }`, rounded to cents. The validator recomputes it and tells you the right number. |
| `regular_price` | Only if printed, for the same quantity and unit as `price`. Otherwise `null`. |
| `percent_off` | Whole number, computed from `regular_price`, or as printed when only a percent was printed. Otherwise `null`. |
| `member_price` | `true` for member or loyalty prices. |
| `vegetarian` | Optional. Leave it out normally: the site decides from the category and name, and hides anything unsure. Set `false` on an item that contains meat or fish but whose name does not say so (for example a dumpling brand), or `true` on one it hides wrongly. |
| `valid_through` | The last day of the sale price, or `null` to use the flyer's. Set it when it is shorter (H Mart meat often ends Monday). |
| `notes` | Limits, while supplies last, member details, location caveats, "save up to" text. Empty string if none. |
| `highlight` | Optional `{ "reason" }` (section 5). |

## 8. Store notes

- **Lam's:** two images. One covers the Seattle store only; the other covers both Seattle and Tukwila. For items only on the combined image, add this note: "On the flyer covering both the Seattle and Tukwila stores, so it may only be at Tukwila." If the images still show last week's dates, the flyer is `stale`.
- **H Mart:** meat and produce prices often end Monday. Set those items' `valid_through` and say so in the flyer note.
- **Smith Brothers:** a two-week delivery cycle, so its items can appear in two weeks.
- **Central Co-op:** often keeps old dates for weeks. Mark it `stale` when the dates are wrong.
- **PCC:** if the sales page shows no items, mark it `unreadable`.
- Every store's reading notes are in `how_to_read` in `config/stores.json`.

## 9. Privacy

Only store and price facts go in this repo. No names, emails, addresses, home locations, pantry contents, meal plans, or anything from the personal parts of the vault notes.

## 10. Refreshing US averages

`config/benchmarks.json` holds BLS US city average prices. Refresh it about once a month. For each benchmark, fetch its series from the BLS public API and update `price` and `period`:

```
curl -s -X POST https://api.bls.gov/publicAPI/v1/timeseries/data/ \
  -H "Content-Type: application/json" \
  -d '{"seriesid":["APU0000FD3101"]}'
```

The newest value is `Results.series[0].data[0]` (skip entries whose value is `-`). Update `updated` at the top of the file.

## 11. Common validator errors

| Error | Fix |
|---|---|
| `unit_price should be X` | Use the number the validator gives. |
| `does not print regular prices (config)` | Set `regular_price` and `percent_off` to `null`. If the store does print them now, update `config/stores.json`. |
| `item_key ... not in config/items.json` | Use an existing key, add one, or use `null`. |
| `flyer status is stale` | Items cannot come from a stale or unreadable flyer. |
| `partial flyers need a note` | Say what was not read. |
| `em dash` | Replace it. |
