# Handoff

Read this first if you are picking up the project, whether you are a person or a coding tool. The other docs cover how the site runs: [README.md](README.md), [UPDATING.md](UPDATING.md) (weekly data rules), [ROUTINE.md](ROUTINE.md) (the Friday cloud routine) and [ADDING-A-STORE.md](ADDING-A-STORE.md).

Keep the "Where we left off" section current. Work happens on a branch per task with a pull request; the owner merges.

## Where we left off

Updated 2026-10-24, evening.

- **Pull requests waiting for the owner:** #6 (this handoff file, `design/` mockups, product images plan) and #7 (`mobile-app` branch: the iPhone app, `/api/week.json` feed, `docs/architecture.svg`). Read both branches if they aren't merged yet.
- **Site:** redesign live (#5), "Vegetarian only" live (#4). The Friday routine runs at 10am Pacific as a Claude cloud routine.
- **iPhone app (`apple/`, SwiftUI; see `apple/README.md`):** native app replacing the old Expo app (removed 2026-10-24; Apple devices first). Installed on the owner's phone with `apple/install-on-iphone.sh` (Mac, Xcode beta, free Apple ID: 7-day builds, at most 3 free-profile apps on the phone). This week, Aisles, Stores, deal sheet, list in the app or a Reminders list (EventKit), alerts and price watches (local notifications), Siri and Shortcuts, a Best This Week widget, Amplitude with private settings.
- **Confluence** (owner's personal space, kylepace.atlassian.net): "Seattle Grocery Deals: architecture" (diagram, components, schema, Firebase plan with "New deals are in" as the first push, Amplitude events, build order) and "Recipe + pantry app: product brief". The architecture diagram image points at the `mobile-app` branch; repoint it to `main` after #7 merges.
- **Issues:** #8 product images (future).
- **Next:** confirm Reminders works; merge #6 and #7; paid Apple Developer account; then the backend (Neon, API, publish step) and Firebase "New deals are in" push; Amplitude.
- **A cloud session can't** build or install the iPhone app, read the owner's Obsidian vault, or reach the Mac. Do code, docs, backend and site work there; leave phone builds for the Mac.

## Future ideas

- **Recipe + pantry app** (separate app, "Mela plus pantry features"): see the Confluence product brief. Connects to Grocery Deals only through the Reminders list. The owner's Obsidian "Cooking Wiki" vault already runs the pantry model (one note per item with status have, low, out, unconfirmed). Leaning SwiftUI with CloudKit, no logins. Do not add pantry or recipes to Grocery Deals.
- **Mac bridge** for the vault: low and out pantry items to the Reminders list; checked-off items back to `have`.
- A Mac mini at home would make phone builds and Remote Control available any time.

## Decisions

- **Scope:** Seattle-area stores only. Specialty grocers the big chains' apps skip: Asian markets, seafood shops, co-ops. No mainstream chains (Grocery Outlet was dropped). No flyer aggregators such as Flipp: every store is read from its own site.
- **PCC:** its site blocks automated reading (Cloudflare). Do not try to get around the bot check. Options are asking PCC for a feed, reading it by hand, or marking it unreadable.
- **Design system:** "Newsprint". Tokens live at the top of `site/assets/style.css`.
  - Colors: evergreen header `#1d4d33`, cream paper `#f7f5f0`, ink `#141414`, muted `#57534c`, yellow standout tag `#ffe45c`, red for "% off" `#b3261e`. Dark mode is defined there too.
  - Type: Barlow Condensed 700 for prices and headings, Atkinson Hyperlegible Next for everything else. Both self-hosted, because the privacy notice says fonts come from the site.
  - Color carries meaning only (yellow = standout, red = discount). Rainbow and queer flair are saved for the app icon, not the interface.
  - Accessibility is a requirement: AA contrast in light and dark, 44px tap targets, prices read as "per pound" to screen readers, visible focus.
- **Removed in the redesign:** the "my stores" dialog and the category and tier filters. Bring "my stores" back if people miss it.
- **Parked:** a store "spotlight" card to encourage shopping at a store going through a hard time. Removed for now at the owner's request; the owner writes any such text.
- **Delivery notes** for Lam's and T&T come from the owner and were not confirmed online. Add delivery links when known.
- **Analytics:** Amplitude on the website, made private at the owner's request: autocapture, Session Replay for 5% of visits with all text and input masked (code loaded only for those visits), no IP, ID in localStorage (no cookies), off for Global Privacy Control, Do Not Track or the About page opt-out, and only on the live domain. Google Analytics removed. First event: `Viewed Home Page`. The app has its own private setup (no IP, ad ID or carrier; off switch on Alerts). Next: Amplitude in the app (React Native SDK), then the event plan on the Confluence architecture page. Do not run Firebase Analytics.

## The app

Mockups: [design/app-mockup.html](design/app-mockup.html) (open in a browser). Also [design/site-prototype.html](design/site-prototype.html) for the site structure and [design/directions.html](design/directions.html) for the design directions explored.

The owner wants to learn how a backend fits together, so prefer a conventional stack that shows the moving parts over a fully managed one.

- **App:** native SwiftUI in `apple/` (decided 2026-10-24: Apple devices only for now; widgets, Siri, the Watch and Liquid Glass are native). XcodeGen project (`apple/GroceryDeals/project.yml`). Android is not planned.
- **Look:** Apple's Liquid Glass (iOS 26) for the app's chrome: tab bar, navigation bars, sheets and buttons floating over content. Keep the content itself in the newsprint system (cream paper, ink, yellow tags) so prices stay readable; glass over busy content hurts contrast. In Expo, native tabs and `expo-glass-effect` give real Liquid Glass on iOS 26 (check current Expo docs). Plan fallbacks: older iOS and all of Android get solid newsprint surfaces, and the app must respect the Reduce Transparency and Increase Contrast settings. iPad gets Liquid Glass too, but its sidebar and wider layouts need their own pass; Android tablets use the fallback.
- **List:** sync with the iPhone Reminders app. The user picks a Reminders list (often a shared "Groceries" list). Uses EventKit. Match list items to this week's deals on the phone so the list is never uploaded. Apple's automatic grocery sections may not be settable from an app. Android has no Reminders API, so it gets an in-app list.
- **Push:** Firebase Cloud Messaging (the owner is evaluating FCM at scale for work). Topics for broadcasts (`friday-digest`, `store-<id>`), per-device messages for list matches and price watches, sent by a backend job with the Firebase Admin SDK after the week publishes. Remove dead tokens, batch sends, use iOS time-sensitive delivery for "ends tomorrow".
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

- Never push to `main` or merge without the owner's approval. Branch, open a pull request.
- Never put the owner's email address on the site.
- Weekly data: never guess a price; only use regular prices the store printed; food only; no em dashes. `npm run check` must pass.
