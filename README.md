# Seattle Grocery Deals

A static site that shows what's on sale in Seattle-area grocery flyers each week: every readable sale item, the standouts, where to shop, and the same item compared across stores, plus links to every store's flyer. A new week is added every Friday.

Live site: https://seattlegrocery.deals/

## How it works

- `config/stores.json`: the stores, their flyer links and how to read them.
- `config/criteria.json`: how items are highlighted and ranked.
- `config/items.json`: normalized item keys, so prices can be compared across weeks and stores.
- `config/benchmarks.json`: US average prices from the Bureau of Labor Statistics.
- `config/site.json`: site title, paths, and the Google Analytics measurement ID (`ga_measurement_id`). The tag is added only to the deployed build, not local previews; remove the ID to turn analytics off.
- `data/weeks/YYYY-MM-DD.json`: one file per week, named by that Friday's date.
- `schema/week.schema.json`: the JSON Schema for a week file.
- `scripts/validate.mjs`: schema plus cross checks (unit prices, percent off, printed prices only, no em dashes).
- `scripts/fetch-flipp.mjs`: pulls this week's rows for stores listed on Flipp (stores with a `flipp` entry), in All Items note format.
- `scripts/draft-week.mjs`: turns a weekly All Items note into a draft week file.
- `notes/all-items/`: the All Items note for each week written by the cloud routine.
- `scripts/build.mjs`: ranks items and renders the site into `dist/`.
- `site/assets/`: styles, the filter script, the logo, and the Bricolage Grotesque font (SIL Open Font License, see `fonts/OFL.txt`).
- `.github/workflows/pages.yml`: validates, builds and deploys to GitHub Pages on every push to `main`.

## Commands

```
npm install
npm run validate     # check all week files and config
npm run build        # build dist/
npm run check        # both
npm run serve        # build for / and preview at http://localhost:8080
npm run draft -- "path/to/All Items YYYY-MM-DD.md"
node scripts/fetch-flipp.mjs YYYY-MM-DD   # Flipp rows to work/
```

Requires Node 20 or newer. The only dependencies are Ajv and ajv-formats, used for schema validation.

## Docs

- [ROUTINE.md](ROUTINE.md): the Friday cloud routine that reads the flyers and opens a pull request.
- [UPDATING.md](UPDATING.md): how to make a week's file.
- [ADDING-A-STORE.md](ADDING-A-STORE.md): how to add a store.

Prices come from store flyers and can change. Not affiliated with any store.
