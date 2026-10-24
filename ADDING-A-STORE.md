# Adding a store

Adding a store is a config change. No code changes.

## 1. Check that it fits

The site covers the stores the big chains' apps skip. A store fits when it:

1. publishes a weekly flyer or specials page online;
2. is not a mainstream supermarket, discount or big-box chain (Safeway, QFC, Fred Meyer, Albertsons, Haggen, Costco, Walmart, Target, Grocery Outlet, Sprouts and the like); and
3. sells something that's hard to find at those chains: a cuisine, a specialty such as seafood, or co-op produce.

Size alone does not rule a store out. T&T and H Mart are large chains, but they are specialty grocers. The About page says the same thing, so keep the two in step.

## 2. Check the flyer

The store needs a public weekly flyer or specials page that can be read without an account. Note:
- the flyer URL, and whether it changes each week;
- the sale period (for example Wednesday to Tuesday);
- the format: `web-page`, `images`, `pdf` or `catalogue-viewer`;
- whether it prints regular prices (or exact savings amounts);
- whether it varies by location. If it does, pick one representative Seattle-area store and use it every week.

## 3. Add an entry to `config/stores.json`

```json
{
  "id": "example-market",
  "name": "Example Market",
  "aliases": ["Example", "Example Mkt"],
  "active": true,
  "tracked_since": "2026-11-06",
  "website": "https://www.example.com",
  "flyer_url": "https://www.example.com/weekly-ad",
  "sale_period": { "starts": "wed", "ends": "tue" },
  "prints_regular_prices": true,
  "flyer_format": "catalogue-viewer",
  "representative_location": "Rainier Valley store",
  "how_to_read": [
    "Choose the Rainier Valley store, then open Weekly Ad.",
    "Read every page; the catalogue loads one page at a time."
  ]
}
```

| Field | Notes |
|---|---|
| `id` | Lowercase words joined by hyphens. Never change it later, because past weeks refer to it. |
| `aliases` | Names the All Items note might use for the store. The draft helper matches on these. |
| `active` | `false` hides it from the flyer list and the store picker but keeps its history. |
| `tracked_since` | The first Friday it will be checked. Earlier weeks do not show it as "Not checked". |
| `website` | `null` if there is none. |
| `flyer_url` | The page that has the flyer. `null` if it changes every week, in which case add `flyer_url_note` to explain where to find it. |
| `flyer_url_note` | Optional explanation shown on the store page. |
| `sale_period` | `starts` and `ends` are `mon` to `sun`, or `varies` with a `note`. |
| `prints_regular_prices` | `true` only if the flyer prints regular prices or exact savings. When it is `false`, deals from this store can only qualify on US average. |
| `representative_location` | Which store's flyer is used, if it varies. |
| `how_to_read` | Short instructions for the weekly routine. Include any quirks. |

## 4. The weekly routine

Nothing to change. The Friday routine ([ROUTINE.md](ROUTINE.md)) reads every active store in `config/stores.json` using its `how_to_read` notes, from `tracked_since` on. Write those notes so someone who has never seen the site could follow them.

## 5. Check

```
npm run check
```

Then commit and push. The store gets its own page at `/stores/<id>/`.
