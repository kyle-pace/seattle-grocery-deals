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
- Add 3 to 6 highlights with reasons.
- Check the vegetarian filter: `node scripts/veg-check.mjs drafts/YYYY-MM-DD.json` lists the items outside meat and seafood that the site would show as vegetarian. Set `vegetarian: false` on any that contain meat, poultry or fish (UPDATING.md section 7).

### 5. Check

```
mv drafts/YYYY-MM-DD.json data/weeks/
npm run check
```

Fix every error. Then compare with last week's file and note anything surprising in the pull request:

- total items, and items per store, against last week (more than 40% fewer is worth a line);
- any item key whose unit price changed by more than 3 times from its last listing (likely a unit or pack mistake: fix it or drop the row);
- every flyer's dates cover this Friday, or the flyer is marked `stale`.

### 6. Pull request

Commit `data/weeks/YYYY-MM-DD.json`, the All Items note and any `config/items.json` changes on the branch for the mode, push it, and open the pull request against `main` with `gh pr create` (add `--draft` for a dry run).

Title: `Week of <Month D>: <N> items from <M> flyers` (prefixed `[Dry run] ` for a dry run).

Body:

1. One line: what this is, and for a dry run, "Do not merge."
2. A table: store, status, items, how it was read (page, images, PDF, browser), and a note for anything not `full`.
3. The highlights.
4. Anything a reviewer should look at: rows left out because they could not be read clearly, sanity check findings, items the validator warned about.
5. The run log: what failed and why, including network or browser problems, so the routine can be improved.

If something blocks the pull request (no network, the repo cannot be pushed), finish what you can and put the run log in the final message of the session instead.
