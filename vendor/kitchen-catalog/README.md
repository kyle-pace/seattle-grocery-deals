# KitchenCatalog (copy)

A copy of the shared grocery catalog from `~/Developer/KitchenCatalog`, so the Friday cloud
run (which only has this repo) can use it. **Don't edit these files here**: edit the catalog in
KitchenCatalog, then run `npm run sync-catalog` from this repo and commit the result.

Used for ranking: each deal's `popularity` (everyday, common or specialty) comes from its
catalog item, found by `item_key` or a strong name match. See `analyze` in `scripts/lib.mjs`.
