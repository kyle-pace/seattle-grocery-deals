# The flyer routine

Since 2026-10-31 the site updates each store as soon as its new flyer comes out. A GitHub Action (`.github/workflows/watch-flyers.yml`, every 30 minutes) checks each store's flyer page and, when one changes, starts this routine with a message like `Stores: lams, hmart`. The routine reads just those stores and publishes them straight to `main` (**MODE: update**, below). A weekly run without a message sweeps for anything the watcher missed. Nothing here needs a local computer or the Obsidian vault.

The full-week modes further down (`live` and `dry-run`) still work for reading every store at once, but they are no longer scheduled.

Read [UPDATING.md](UPDATING.md) first. Its rules on what goes in (section 3), highlights (section 5) and fields (section 7) all apply. The short version: never guess a price, only use regular prices the store printed, food for cooking only (no snacks or packaged convenience food), no em dashes.

## MODE: update (the normal run)

The message that started the run has a line `Stores: <ids>` (store ids from `config/stores.json`). A run with no such line (the weekly sweep) means: every active store whose watch entry is not `desktop`, but read only the ones whose flyer page shows a newer flyer than the live one, or whose live flyer has ended.

Pushing to `main` is allowed in this mode (owner's call, 2026-10-30): updates go live without review unless a check below flags something.

1. **Set up.** Start from an up-to-date `main`. `npm ci`. Check the network by fetching one of the stores' flyer pages; if every store host is refused, stop and say so. Read stores one at a time in this session, no subagents (see the usage note in step 1 of the full-week steps).
2. **Week.** `node scripts/apply-store.mjs --week` prints the week the update belongs to (the most recent Friday in Seattle). Call it `W`.
3. **Is it new?** For each store, open its flyer as its `how_to_read` notes say, and compare the printed dates and the flyer links with its entry in `data/weeks/W.json` (or the latest week file if `W.json` doesn't exist yet). If it's the flyer already live, skip the store and say so in the final message. A store whose watch entry says `desktop` can't be read from the cloud: skip it and say so.
4. **Read.** For each new flyer, read it in full exactly as in step 2 of the full-week steps (every page, skip snacks and packaged convenience food, never guess a price, link every page image). Write only the updated stores into `/tmp/updates/All Items W.md`, in the All Items format (a `## Flyers` line per store and the `## Items` rows). Keep it out of the repo.
5. **Draft and review.** `npm run draft -- "/tmp/updates/All Items W.md"`, then work through UPDATING.md sections 4 and 5 on `drafts/W.json` for those stores only: fix the "Check by hand" list and suggested keys, look at skipped rows and `left_out`, set `vegetarian: false` where needed (`node scripts/veg-check.mjs drafts/W.json`). Highlights are optional in an update.
6. **Apply.** `node scripts/apply-store.mjs drafts/W.json "/tmp/updates/All Items W.md"`. It starts `W.json` by carrying the last week forward if needed, swaps in the stores' flyers and items, updates `notes/all-items/All Items W.md`, and prints checks into `drafts/W.flags.json`.
7. **Check.** `npm run check` must show 0 errors.
8. **Publish.**
   - No flags: commit `data/weeks/W.json`, `notes/all-items/All Items W.md` and any config changes on `main` with a message like `Lam's: new flyer Nov 6 to 12 (41 items)`, and push. The deploy announces the new flyers to people who picked those stores.
   - Any flag: push a branch `update/<store>-W` instead, open a pull request with the flags at the top, and don't merge it.
9. **Final message:** per store, what was read (dates, items) or why it was skipped, the flags if any, and whether it went to `main` or a pull request.

If a store's `watch` pattern stopped matching (the watcher reports an error for it), or its flyer moved, fix the store's `watch` entry and `how_to_read` notes in the same commit.

## Full-week modes

The prompt that starts the run says `MODE: live` or `MODE: dry-run`.

- **live:** branch `week/YYYY-MM-DD`, a normal pull request.
- **dry-run:** branch `dry-run/YYYY-MM-DD-<HHMM>`, a **draft** pull request whose title starts with `[Dry run]` and whose body says not to merge it. If a week file for that date already exists, overwrite it anyway, so the pull request diff compares this run against the existing file.

In both full-week modes: **never push to `main`, never merge, never close or edit other pull requests.**

## Steps

### 1. Set up

- The week is this Friday's Pacific date: `TZ=America/Los_Angeles date +%F` on a Friday. On any other day, use the most recent Friday, unless the prompt names a week.
- Run `npm ci`.
- A headless browser is needed for pages that only render with JavaScript. The cloud environment usually has Playwright and Chromium already: check with `node -e "require('playwright').chromium.launch().then(b => b.close())"`. Use that one; do not install another version over it. If there is none, try `npx -y playwright@latest install --with-deps chromium`, and if that fails too, carry on without a browser and say so in the pull request.
- Before reading stores, check the network: fetch one store's flyer page. If every store host is refused (for example a proxy 403), stop. Do not write a week file or open a pull request, because an empty week would replace the live one. Say in your final message which hosts were refused.
- **Read stores one at a time, in this session. Do not start subagents or parallel readers.** The second dry run used 11 parallel readers and hit the account's 5-hour usage limit after about 8 minutes, which also blocks the person's own use of Claude.
- Keep a run log as you go (what worked and what failed per store, and the reason). It goes in the pull request body.

### 2. Read every store

For each store in `config/stores.json` with `active: true`, follow its `how_to_read` notes. Skip stores whose notes say they are not part of the weekly routine.

- **Web pages:** fetch the page. If it is empty or clearly needs JavaScript, use the headless browser.
- **Flyer images:** download each image with `curl` into `work/` and read it with the Read tool. Read every image in full, zooming in by cropping if text is small (for example with Python and Pillow, if available). Link each image in the flyer line, using the image's own URL.
- **Flyer pages for the app:** the iPhone app shows each store's page images and PDFs in its own viewer (`flyer_pages` in `/api/week.json`, from these links). For stores whose ad is a web page or a catalogue viewer, look for the page images or PDF behind it (the image URLs in the page, a "Download PDF" link) and link those too, with the web page last. If there are none, the web page alone is fine.
- **Dates:** check the printed dates. If they are not this week, the flyer is `stale`: list it, with no items.
- **Unsure rows:** if you are not sure how to read a row (a multi-buy that might be per item or for the set, a price partly hidden), either leave it out or keep it with a note starting `CHECK:` while you work, then resolve every `CHECK:` before step 4. The validator rejects any `CHECK:` left in a week file.
- **Skip snacks and packaged convenience food while reading** (UPDATING.md section 3): snacks and frozen desserts, drinks, and ready-made meals such as frozen pizza, burritos, entrees and instant noodles. Dim sum, buns, spring rolls, cereal, granola, soup, creamers, yogurt drinks and bakery items stay. Don't write those rows at all; a page that is all snacks or frozen meals can be passed over. Keep everything else, and when unsure, keep it. Count what you skipped per store for the run log (a rough number is fine).
- Do not use flyer aggregators such as Flipp or their APIs. Read each store's own site.
- Spend at most about 15 minutes on any one store. If you cannot read it, mark it `unreadable` or `partial` with a short reason, and move on.

Write the store's rows in the All Items table format. Any price you cannot read clearly is left out.

### 3. The All Items note

Write `notes/all-items/All Items YYYY-MM-DD.md` in the format from UPDATING.md section 1: a `## Flyers` list with one line per active store (dates, links, `status: full`, `partial, <what was missed>`, `stale` or `unreadable, <why>`) and one `## Items` table with every row from step 2. This file is kept in the repo as the source for the week.

### 4. Draft, review and highlight

```
npm run draft -- "notes/all-items/All Items YYYY-MM-DD.md"
```

Then work through UPDATING.md sections 4 and 5 on `drafts/YYYY-MM-DD.json`:

- Fix every item in the "Check by hand" list. Add keys to `config/items.json` for items that will come up again; use `null` for one-offs.
- Look at every skipped row in `drafts/YYYY-MM-DD.report.json`. Fix the note and redraft if a row was skipped only because of formatting.
- Look at `left_out` in the report: rows the draft dropped as snacks or packaged food that you wrote anyway. If one is a cooking ingredient, add a phrase to `keep_words` in `config/leave-out.json` and redraft; otherwise leave it out.
- Add 3 to 6 highlights with reasons.
- Check the vegetarian filter: `node scripts/veg-check.mjs drafts/YYYY-MM-DD.json` lists the items outside meat and seafood that the site would show as vegetarian. Set `vegetarian: false` on any that contain meat, poultry or fish (UPDATING.md section 7).

### 5. Check

```
mv drafts/YYYY-MM-DD.json data/weeks/
npm run check
```

Fix every error. Then compare with last week's file and note anything surprising in the pull request:

- total items, and items per store, against last week (more than 40% fewer is worth a line; the week of Oct 30 is the first without snacks and packaged food, so expect about 35% fewer than Oct 23: redrafting Oct 23 this way goes from 860 items to 538, mostly at 99 Ranch, Red Apple, T&T and Smith Brothers);
- any item key whose unit price changed by more than 3 times from its last listing (likely a unit or pack mistake: fix it or drop the row);
- every flyer's dates cover this Friday, or the flyer is marked `stale`.

### 6. Pull request

Commit `data/weeks/YYYY-MM-DD.json`, the All Items note and any `config/items.json` changes on the branch for the mode, push it, and open the pull request against `main` with `gh pr create` (add `--draft` for a dry run).

Title: `Week of <Month D>: <N> items from <M> flyers` (prefixed `[Dry run] ` for a dry run).

Body:

1. One line: what this is, and for a dry run, "Do not merge."
2. A table: store, status, items, rows skipped as snacks or packaged food (rough count), how it was read (page, images, PDF, browser), and a note for anything not `full`.
3. The highlights.
4. Anything a reviewer should look at: rows left out because they could not be read clearly, sanity check findings, items the validator warned about.
5. The run log: what failed and why, including network or browser problems, so the routine can be improved.

If something blocks the pull request (no network, the repo cannot be pushed), finish what you can and put the run log in the final message of the session instead.
