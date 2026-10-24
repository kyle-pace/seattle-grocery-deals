# The Friday routine

A cloud routine runs this every Friday morning, Pacific time. It reads every active store's flyer, writes the week file, and opens a pull request. A person reviews and merges the pull request; merging deploys the site. Nothing here needs a local computer or the Obsidian vault.

Read [UPDATING.md](UPDATING.md) first. Its rules on what goes in (section 3), highlights (section 5) and fields (section 7) all apply. The short version: never guess a price, only use regular prices the store printed, food only, no em dashes.

## Mode

The prompt that starts the run says `MODE: live` or `MODE: dry-run`.

- **live:** branch `week/YYYY-MM-DD`, a normal pull request.
- **dry-run:** branch `dry-run/YYYY-MM-DD-<HHMM>`, a **draft** pull request whose title starts with `[Dry run]` and whose body says not to merge it. If a week file for that date already exists, overwrite it anyway, so the pull request diff compares this run against the existing file.

In both modes: **never push to `main`, never merge, never close or edit other pull requests.**

## Steps

### 1. Set up

- The week is this Friday's Pacific date: `TZ=America/Los_Angeles date +%F` on a Friday. On any other day, use the most recent Friday, unless the prompt names a week.
- Run `npm ci`.
- Try to get a headless browser for pages that only render with JavaScript: `npx -y playwright@latest install --with-deps chromium`. If that fails, carry on without it and say so in the pull request.
- Keep a run log as you go (what worked and what failed per store, and the reason). It goes in the pull request body.

### 2. Flipp stores

```
node scripts/fetch-flipp.mjs YYYY-MM-DD
```

This writes `work/flipp-YYYY-MM-DD.md` for every store with a `flipp` entry in `config/stores.json`. Every row came from Flipp's listing of the store's printed flyer. Before using the rows:

- Fill in `Category` for every row.
- Drop non-food rows (flowers, household, pet, alcohol) and rows that are not a sale price (everyday prices, "download the app" tiles).
- Resolve every `CHECK:` note. Open the item image linked in the note and read the printed price. Set the `Sale price` cell to the printed form (`4/$5.00` when it is 4 for $5, `$1.25` with `ea` when it is $1.25 each), then delete the `CHECK:` sentence. If you cannot tell, drop the row. The validator rejects any `CHECK:` left in a week file.
- Check pack sizes in item names against the unit (a "1 lb" pack priced `ea` is fine as is).

If the script fails or finds no flyer for a store, read that store directly as in step 3.

### 3. Every other active store

For each store in `config/stores.json` with `active: true` and no `flipp` entry, follow its `how_to_read` notes. Skip stores whose notes say they are not part of the weekly routine.

- **Web pages:** fetch the page. If it is empty or clearly needs JavaScript, use the headless browser.
- **Flyer images:** download each image with `curl` into `work/` and read it with the Read tool. Read every image in full, zooming in by cropping if text is small (for example with Python and Pillow, if available). Link each image in the flyer line.
- **Dates:** check the printed dates. If they are not this week, the flyer is `stale`: list it, with no items.
- Spend at most about 15 minutes on any one store. If you cannot read it, mark it `unreadable` or `partial` with a short reason, and move on.

Write the store's rows in the All Items table format. Any price you cannot read clearly is left out.

### 4. The All Items note

Write `notes/all-items/All Items YYYY-MM-DD.md` in the format from UPDATING.md section 1: a `## Flyers` list with one line per active store (dates, links, `status: full`, `partial, <what was missed>`, `stale` or `unreadable, <why>`) and one `## Items` table with every row from steps 2 and 3. This file is kept in the repo as the source for the week.

### 5. Draft, review and highlight

```
npm run draft -- "notes/all-items/All Items YYYY-MM-DD.md"
```

Then work through UPDATING.md sections 4 and 5 on `drafts/YYYY-MM-DD.json`:

- Fix every item in the "Check by hand" list. Add keys to `config/items.json` for items that will come up again; use `null` for one-offs.
- Look at every skipped row in `drafts/YYYY-MM-DD.report.json`. Fix the note and redraft if a row was skipped only because of formatting.
- Add 3 to 6 highlights with reasons.

### 6. Check

```
mv drafts/YYYY-MM-DD.json data/weeks/
npm run check
```

Fix every error. Then compare with last week's file and note anything surprising in the pull request:

- total items, and items per store, against last week (more than 40% fewer is worth a line);
- any item key whose unit price changed by more than 3 times from its last listing (likely a unit or pack mistake: fix it or drop the row);
- every flyer's dates cover this Friday, or the flyer is marked `stale`.

### 7. Pull request

Commit `data/weeks/YYYY-MM-DD.json`, the All Items note and any `config/items.json` changes on the branch for the mode, push it, and open the pull request against `main` with `gh pr create` (add `--draft` for a dry run).

Title: `Week of <Month D>: <N> items from <M> flyers` (prefixed `[Dry run] ` for a dry run).

Body:

1. One line: what this is, and for a dry run, "Do not merge."
2. A table: store, status, items, how it was read (Flipp, page, images, browser), and a note for anything not `full`.
3. The highlights.
4. Anything a reviewer should look at: CHECK rows that were dropped, sanity check findings, items the validator warned about.
5. The run log: what failed and why, including network or browser problems, so the routine can be improved.

If something blocks the pull request (no network, the repo cannot be pushed), finish what you can and put the run log in the final message of the session instead.
