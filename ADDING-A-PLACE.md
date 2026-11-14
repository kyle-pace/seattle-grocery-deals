# Adding a farmers market or shop

Farmers markets and independent shops live in `config/places.json`. They have no weekly flyer, so
there are no prices: they show on Farmers markets (`/markets/`), Shops worth a trip (`/shops/`),
`/api/places.json` and the MCP server's `find_places` tool. Stores with a weekly flyer go in
`config/stores.json` instead (see ADDING-A-STORE.md).

Check every entry against a recent source (the shop's own site, the City, a 2025 or 2026 article)
and put that link in `source`. When you've rechecked the whole file, update `checked`.
`npm run validate` checks the file, and `node --test scripts/places.test.mjs` runs it against a
broken sample too.

## Fields

| Field | What it is |
| --- | --- |
| `id` | Lowercase words joined by hyphens. It's the page anchor (`/shops/#beast-and-cleaver`), so don't change it. |
| `kind` | `market`, `shop`, or `hub` (a place that groups shops, like Pike Place Market's food side). |
| `type` | Shops only: `butcher`, `seafood`, `world` (grocers from around the world) or `neighborhood`. |
| `name`, `neighborhood`, `address` | As people would say them. Leave the city off Seattle addresses. |
| `lat`, `lon` | For the map. Look the address up on OpenStreetMap (Nominatim) by hand; shops inside a hub don't need them. |
| `about` | One or two plain sentences, 20 to 300 characters: what it is and why it's worth the trip. |
| `carries` | Shops: 1 to 8 short phrases for what it's known for ("Dry-aged beef", "Curry leaf"). People search these. |
| `services` | Only what you've confirmed: `order_online` (`how`, and `url` if there is one), `phone_orders`, `delivery`, `ships`, each in a few plain words. |
| `fresh_bucks` | `true` only when the City lists it as a Fresh Bucks retailer. |
| `hub` | A shop inside a hub: the hub's id. |
| `status`, `status_note` | `moving` plus when and where, for a shop that's relocating. |
| `website`, `newsletter`, `weekly` | Links. `weekly` is something that changes each week, like Ballard's vendor map. |
| `source` | The https link you checked it against. Not shown on the site. |

Markets also have:

| Field | What it is |
| --- | --- |
| `hours` | Lines as people read them: "Sundays 9am to 2pm, all year". |
| `now` | The run that's on: `days` (`sun`..`sat`), `time`, and `from`/`through` dates for a seasonal run. Leave it off between seasons. |
| `every_day` | `true` for Pike Place Market. |
| `special` | One-day markets: `date` and `name`, like a Thanksgiving harvest market. |
| `closed` | Days a regular market is off: `date` and `note`. |
| `programs` | `market_match` and `produce_rewards` (see the food help page). |

Each spring, update the summer markets' `hours` with the new dates and add `now` once they open.
`npm run validate` warns when a run has ended.
