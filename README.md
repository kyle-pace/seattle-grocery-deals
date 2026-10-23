# Seattle Grocery Deals

A static site that lists the good sales from Seattle-area grocery flyers each week, with a short reason for each, plus links to every store's flyer. A new week is added every Friday.

Live site: https://kyle-pace.github.io/seattle-grocery-deals/

## How it works

- `config/stores.json`: the stores, their flyer links and how to read them.
- `config/criteria.json`: the thresholds for what counts as a good deal.
- `config/items.json`: normalized item keys, so prices can be compared across weeks and stores.
- `config/benchmarks.json`: US average prices from the Bureau of Labor Statistics.
- `data/weeks/YYYY-MM-DD.json`: one file per week, named by that Friday's date.
- `schema/week.schema.json`: the JSON Schema for a week file.
- `scripts/validate.mjs`: schema plus cross checks (unit prices, percent off, criteria, no em dashes).
- `scripts/draft-week.mjs`: parses a weekly All Items note into a draft.
- `scripts/build.mjs`: renders the site into `dist/`.
- `.github/workflows/pages.yml`: validates, builds and deploys to GitHub Pages on every push to `main`.

## Commands

```
npm install
npm run validate     # check all week files and config
npm run build        # build dist/
npm run check        # both
npm run serve        # build for / and preview at http://localhost:8080
npm run draft -- "path/to/All Items YYYY-MM-DD.md"
```

Requires Node 20 or newer. The only dependencies are Ajv and ajv-formats, used for schema validation.

## Docs

- [UPDATING.md](UPDATING.md): how to make a week's file.
- [ADDING-A-STORE.md](ADDING-A-STORE.md): how to add a store.

Prices come from store flyers and can change. Not affiliated with any store.
