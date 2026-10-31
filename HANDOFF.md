# Handoff

Read this first if you are picking up the project, whether you are a person or a coding tool. The other docs cover how the site runs: [README.md](README.md), [UPDATING.md](UPDATING.md) (weekly data rules), [ROUTINE.md](ROUTINE.md) (the Friday cloud routine) and [ADDING-A-STORE.md](ADDING-A-STORE.md).

Keep the "Where we left off" section current. Work happens on a branch per task with a pull request; the owner merges.

## Where we left off

Updated 2026-10-31.

- **Pull requests waiting for the owner:** #6 (this handoff file, `design/` mockups, product images plan) and #7 (`mobile-app` branch: the iPhone app, `/api/week.json` feed, `docs/architecture.svg`). Read both branches if they aren't merged yet.
- **Site:** redesign live (#5), "Vegetarian only" live (#4). Deals update per store as flyers come out (see below).
- **iPhone app (`apple/`, SwiftUI; see `apple/README.md`):** native app replacing the old Expo app (removed 2026-10-24; Apple devices first). Installed on the owner's phone with `apple/install-on-iphone.sh` (Mac, Xcode beta, free Apple ID: 7-day builds, at most 3 free-profile apps on the phone). This week, Aisles, Stores, deal sheet, list in the app or a Reminders list (EventKit), alerts and price watches (local notifications), Siri and Shortcuts, a Best This Week widget, Amplitude with private settings.
- **Confluence** (owner's personal space, kylepace.atlassian.net): "Seattle Grocery Deals: architecture" (diagram, components, schema, Firebase plan with "New deals are in" as the first push, Amplitude events, build order) and "Recipe + pantry app: product brief". The architecture diagram image points at the `mobile-app` branch; repoint it to `main` after #7 merges.
- **Ranking by popularity (2026-10-25):** deals people buy most come first. Each deal's popularity (everyday, common, specialty) comes from the shared KitchenCatalog (copy in `vendor/kitchen-catalog/`, refresh with `npm run sync-catalog` after editing `~/Developer/KitchenCatalog`), found by `item_key` or a strong name match; the bonus per level is `ranking.popularity_bonus` in `config/criteria.json`. It changes order only, not tiers. Tag more items in the catalog to improve it.
- **Snacks and packaged food left out (2026-10-26):** the runs now cover cooking ingredients only. The Friday reader skips snacks, sweets, drinks and ready-made meals (UPDATING.md section 3); `scripts/draft-week.mjs` drops any that slip through, using `config/leave-out.json` (the `snacks-drinks` and `prepared` categories, a word list with keep words, and KitchenCatalog items marked `product`), and lists them under `left_out` in the report. The owner put back frozen dim sum and buns, spring rolls, cereal and granola, soup, coffee creamers, yogurt drinks and everything from the bakery. The validator warns on any left in a week file from 2026-10-30. Past weeks are unchanged. Redrafting Oct 23 this way: 860 items to 538.
- **Onboarding (2026-10-26, PR #20, needs kitchen-ui PR #1):** welcome, skippable tour, then the usage question; analytics send nothing until a yes. On Hand gets the same flow (on-hand PR #1).
- **UI fixes from the Oct 28 phone recording (branch `ui-fixes-oct28`, on top of `onboarding`; written in a cloud session, not compiled yet):** tabs are now This week, Aisles, Stores, List plus Search as its own button; Aisles tab (`Aisles.swift`) with store chips, sort and search per aisle; Search tab with recents, popular searches, suggestions and results by aisle, Spotlight indexing of the week's deals and a "Search Deals" Siri action (`Search.swift`); weekly ads open in a full-screen flyer viewer (`Flyer.swift`) fed by the new `flyer_pages` in `/api/week.json` (from each week's `flyers[].links`), Safari's viewer for page-only stores; pinned chips and the store page use `safeAreaBar` so rows stop showing under the title; deal sheet header and actions fixed; "Where should your list live?" half sheet replaces the confirmation dialog; List tab add field and options menu; onboarding reworked (real top picks, "Where do you shop?" stores and vegetarian, How it works, then the usage question); "Your stores" in Settings sort first everywhere. KitchenUI's `pinnedChips` should get the same `safeAreaBar` change.
- **People are adding (2026-10-28):** the build writes `/api/popular.json` from Amplitude (`scripts/popular.mjs`): unique people per deal for "Added Deal to List" this week, only deals added by at least 3 people, counts only. The site rebuilds hourly for it. Needs the `AMPLITUDE_API_KEY` and `AMPLITUDE_SECRET_KEY` repo secrets; without them the list is empty and the app shows top picks. The app shows it on This week and in Search ("People are adding", "12 people added this"), and uses it first for popular searches. App events now carry `item_key`.
- **Flyer updates as they come out (2026-10-31):** the weekly Friday run is replaced by per-store updates. `.github/workflows/watch-flyers.yml` runs `scripts/watch-flyers.mjs` every 30 minutes: it fingerprints each store's flyer page (the `watch` entry in `config/stores.json`: a page plus a regex for flyer image or PDF addresses, or printed sale dates) and keeps the fingerprints on the `flyer-watch` branch (`state.json`). A changed fingerprint starts the Claude routine through its API trigger (secrets `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN`) with `Stores: <ids>`; the routine runs MODE: update in ROUTINE.md, which reads just those stores, merges them into the current week with `scripts/apply-store.mjs` (it starts a new week file on Fridays by carrying the last one forward), and pushes to `main` unless a check flags something (then a pull request). The deploy's notify job (`scripts/new-flyers.mjs`) sends "New deals are in" per store: to `store-<id>` for people who picked that store, and `new-deals` for people who picked none; `notified/<store>/<date>` tags stop repeats. The app joins topics from "Your stores". Red Apple, T&T and Seafood City (`watch.desktop`) can't be read from the cloud and need a desktop browser. The header now says "Updated Oct 30 · 576 deals · Most run through Thursday, some end Tuesday" (`ends` in `/api/week.json`).
- **One row per deal, not per flavor (2026-10-31):** flavors and varieties sold at one price (Zoi Greek Yogurt in four flavors, seven Stumptown and Nossa Familia coffees) showed up as near-duplicate rows. `collapseVariants` in `scripts/lib.mjs` joins same-store rows with the same deal whose names start with the same brand into one row ("Zoi Greek Yogurt, Honey / Lemon Cream / ..."); `npm run draft` runs it and lists the joins under `merged_variants` in the report, and the validator warns on any left from 2026-10-30. The Oct 30 week went from 576 to 557 items. Earlier weeks are unchanged.
- **Issues:** #8 product images (future).
- **Next:** confirm Reminders works; merge #6 and #7; paid Apple Developer account; then the backend (Neon, API, publish step) and Firebase "New deals are in" push; Amplitude.
- **A cloud session can't** build or install the iPhone app, read the owner's Obsidian vault, or reach the Mac. Do code, docs, backend and site work there; leave phone builds for the Mac.

## Future ideas

- **Recipe + pantry app** (separate app, "Mela plus pantry features"): see the Confluence product brief. Connects to Grocery Deals only through the Reminders list. The owner's Obsidian "Cooking Wiki" vault already runs the pantry model (one note per item with status have, low, out, unconfirmed). Leaning SwiftUI with CloudKit, no logins. Do not add pantry or recipes to Grocery Deals.
- **Mac bridge** for the vault: low and out pantry items to the Reminders list; checked-off items back to `have`.
- A Mac mini at home would make phone builds and Remote Control available any time.

## Decisions

- **What's listed:** food for cooking. Snacks, drinks, sweets and ready-made meals are left out (2026-10-26); when unsure, keep it.
- **Scope:** Seattle-area stores only. Specialty grocers the big chains' apps skip: Asian markets, seafood shops, co-ops. No mainstream chains (Grocery Outlet was dropped). No flyer aggregators such as Flipp: every store is read from its own site.
- **PCC:** its site blocks automated reading (Cloudflare). Do not try to get around the bot check. Options are asking PCC for a feed, reading it by hand, or marking it unreadable. Since 2026-10-29 the Friday routine skips PCC entirely (owner's call); it stays on the site's store list.
- **Design system:** "Newsprint". Tokens live at the top of `site/assets/style.css`.
  - Colors: evergreen header `#1d4d33`, cream paper `#f7f5f0`, ink `#141414`, muted `#57534c`, yellow standout tag `#ffe45c`, red for "% off" `#b3261e`. Dark mode is defined there too.
  - Type: Barlow Condensed 700 for prices and headings, Atkinson Hyperlegible Next for everything else. Both self-hosted, because the privacy notice says fonts come from the site.
  - Color carries meaning only (yellow = standout, red = discount). Rainbow and queer flair are saved for the app icon, not the interface.
  - Accessibility is a requirement: AA contrast in light and dark, 44px tap targets, prices read as "per pound" to screen readers, visible focus.
- **Removed in the redesign:** the "my stores" dialog and the category and tier filters. Bring "my stores" back if people miss it.
- **Parked:** a store "spotlight" card to encourage shopping at a store going through a hard time. Removed for now at the owner's request; the owner writes any such text.
- **Delivery notes** for Lam's and T&T come from the owner and were not confirmed online. Add delivery links when known.
- **Analytics:** Amplitude on the website, made private at the owner's request: autocapture, Session Replay for 5% of visits with all text and input masked (code loaded only for those visits), no IP, ID in localStorage (no cookies), off for Global Privacy Control, Do Not Track or the About page opt-out, and only on the live domain. Google Analytics removed. First event: `Viewed Home Page`. The app has its own private setup (no IP, ad ID or carrier) and asks first: nothing is sent until the person says yes in onboarding (2026-10-26), and Settings changes the answer. Next: Amplitude in the app (React Native SDK), then the event plan on the Confluence architecture page. Do not run Firebase Analytics.

## The app

Mockups: [design/app-mockup.html](design/app-mockup.html) (open in a browser). Also [design/site-prototype.html](design/site-prototype.html) for the site structure and [design/directions.html](design/directions.html) for the design directions explored.

The owner wants to learn how a backend fits together, so prefer a conventional stack that shows the moving parts over a fully managed one.

- **App:** native SwiftUI in `apple/` (decided 2026-10-24: Apple devices only for now; widgets, Siri, the Watch and Liquid Glass are native). XcodeGen project (`apple/GroceryDeals/project.yml`). Android is not planned.
- **Look:** Apple's Liquid Glass (iOS 26) for the app's chrome: tab bar, navigation bars, sheets and buttons floating over content. Keep the content itself in the newsprint system (cream paper, ink, yellow tags) so prices stay readable; glass over busy content hurts contrast. In Expo, native tabs and `expo-glass-effect` give real Liquid Glass on iOS 26 (check current Expo docs). Plan fallbacks: older iOS and all of Android get solid newsprint surfaces, and the app must respect the Reduce Transparency and Increase Contrast settings. iPad gets Liquid Glass too, but its sidebar and wider layouts need their own pass; Android tablets use the fallback.
- **List:** sync with the iPhone Reminders app. The user picks a Reminders list (often a shared "Groceries" list). Uses EventKit. Match list items to this week's deals on the phone so the list is never uploaded. Apple's automatic grocery sections may not be settable from an app. Android has no Reminders API, so it gets an in-app list.
- **Push:** Firebase Cloud Messaging topics sent from GitHub Actions, no API or database (decided 2026-10-25). The `notify` job in `pages.yml` runs `scripts/send-push.mjs` after a deploy to main and sends "New deals are in" to `new-deals` once per week (`notified/<week>` tag). It signs in as `push-sender@seattle-grocery-deals-dev` (Cloud Messaging only) through Workload Identity Federation, pool `github`, provider `seattle-grocery-deals`, limited to this repo: no stored key. Test with Actions > Build and deploy > Run workflow, `push_topic: new-deals-test`. To send a custom message by hand: Firebase console > Messaging > New campaign > Notifications, target **Topic** (`new-deals-test` or `new-deals`), optional custom data `kind` = `new_deals` so a tap opens This week. Don't target the whole app. Not built yet: title and message inputs on the Run workflow button. Watch hits and list matches stay on the phone. The iOS API key in `GoogleService-Info-Dev.plist` is restricted to the `deals.seattlegrocery` bundle ID. Prod Firebase project: not made yet. First push reached Kyle's iPhone 2026-10-26.
- **Backend:** TypeScript API, Postgres on Neon, a scheduled Friday job. Stores device tokens and watched item keys only.
- **Needs:** Apple Developer account ($99/year) for the push key and TestFlight; Google Play account for Android testers.

### Product images (not started)

Don't copy photos from store flyers, brand sites or Wikipedia articles on a fair use theory: thumbnails in an app are a weak fair use case. The plan instead:

- Generic foods (produce, seafood, meat cuts) get one photo per `item_key` from **Wikimedia Commons**, only files under public domain, CC0, CC BY or CC BY-SA, fetched with their license and author through the Commons API and shown on a credits screen. Not Wikipedia's "non-free" images.
- Packaged and branded products get no photo; use a department illustration.
- Department and store art: commissioned or drawn illustrations the project owns. Store names, not store logos.

### Build order

1. Done: native app that reads the site's weekly JSON (`/data/weeks/<week>.json`, schema at `/schema/week.schema.json`): This week, deal detail, stores. No backend.
2. Reminders list matching and "Add to list", all on the phone.
3. Backend (Neon, API, Friday job) and push through Firebase Cloud Messaging. Amplitude for app analytics.
4. Price watches, widgets, then Android with the in-app list.

Ideas for later: plan-my-trip (fewest stores covering your sale items), in-store mode, share a deal, Apple Watch, Siri.

## House rules

- Pushing straight to `main` is fine (owner's call, 2026-10-28). Use a branch and a pull request for bigger or riskier work the owner should look at first.
- Never put the owner's email address on the site.
- Weekly data: never guess a price; only use regular prices the store printed; food for cooking only (no snacks or packaged convenience food); no em dashes. `npm run check` must pass.
