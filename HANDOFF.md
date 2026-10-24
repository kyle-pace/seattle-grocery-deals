# Handoff

Read this first if you are picking up the project, whether you are a person or a coding tool. The other docs cover how the site runs: [README.md](README.md), [UPDATING.md](UPDATING.md) (weekly data rules), [ROUTINE.md](ROUTINE.md) (the Friday cloud routine) and [ADDING-A-STORE.md](ADDING-A-STORE.md).

Keep the "Where we left off" section current. Work happens on a branch per task with a pull request; the owner merges.

## Where we left off

Updated 2026-10-24.

- The site redesign is live (pull request #5): newsprint look, menu (This week, Departments, Stores, Compare, About), department, standouts and compare pages, store pages that lead with the store's own weekly ad, and a `delivery` note per store.
- The "Vegetarian only" switch is live (pull request #4).
- The Friday routine runs every Friday at 10am Pacific as a Claude cloud routine and opens a pull request for the week. It needs the owner's Claude account.
- **Next:** step 1 of the app (below).

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
- **Analytics:** the site uses Google Analytics today. The plan is Amplitude for the app and, eventually, the web. Do not run Firebase Analytics.

## The app

Mockups: [design/app-mockup.html](design/app-mockup.html) (open in a browser). Also [design/site-prototype.html](design/site-prototype.html) for the site structure and [design/directions.html](design/directions.html) for the design directions explored.

The owner wants to learn how a backend fits together, so prefer a conventional stack that shows the moving parts over a fully managed one.

- **App:** Expo (React Native) with TypeScript, one codebase for iPhone and Android. Styling to match the design system; NativeWind with React Native Reusables was the suggested kit.
- **Look:** Apple's Liquid Glass (iOS 26) for the app's chrome: tab bar, navigation bars, sheets and buttons floating over content. Keep the content itself in the newsprint system (cream paper, ink, yellow tags) so prices stay readable; glass over busy content hurts contrast. In Expo, native tabs and `expo-glass-effect` give real Liquid Glass on iOS 26 (check current Expo docs). Plan fallbacks: older iOS and all of Android get solid newsprint surfaces, and the app must respect the Reduce Transparency and Increase Contrast settings. iPad gets Liquid Glass too, but its sidebar and wider layouts need their own pass; Android tablets use the fallback.
- **List:** sync with the iPhone Reminders app. The user picks a Reminders list (often a shared "Groceries" list). Use `expo-calendar` (iOS only, needs a development build, not Expo Go). Match list items to this week's deals on the phone so the list is never uploaded. Apple's automatic grocery sections may not be settable from an app. Android has no Reminders API, so it gets an in-app list.
- **Push:** Firebase Cloud Messaging (chosen over Expo's push service because the owner is evaluating FCM at scale for work). Topics for broadcasts (`friday-digest`, `store-<id>`), per-device messages for list matches and price watches, sent by a backend job with the Firebase Admin SDK after the week publishes. Remove dead tokens, batch sends, use iOS time-sensitive delivery for "ends tomorrow".
- **Backend:** TypeScript API, Postgres on Neon, a scheduled Friday job. Stores device tokens and watched item keys only.
- **Needs:** Apple Developer account ($99/year) for the push key and TestFlight; Google Play account for Android testers.

### Product images (not started)

Don't copy photos from store flyers, brand sites or Wikipedia articles on a fair use theory: thumbnails in an app are a weak fair use case. The plan instead:

- Generic foods (produce, seafood, meat cuts) get one photo per `item_key` from **Wikimedia Commons**, only files under public domain, CC0, CC BY or CC BY-SA, fetched with their license and author through the Commons API and shown on a credits screen. Not Wikipedia's "non-free" images.
- Packaged and branded products get no photo; use a department illustration.
- Department and store art: commissioned or drawn illustrations the project owns. Store names, not store logos.

### Build order

1. Expo app that reads the site's weekly JSON (`/data/weeks/<week>.json`, schema at `/schema/week.schema.json`): This week, deal detail, stores. No backend.
2. Reminders list matching and "Add to list", all on the phone.
3. Backend (Neon, API, Friday job) and push through Firebase Cloud Messaging. Amplitude for app analytics.
4. Price watches, widgets, then Android with the in-app list.

Ideas for later: plan-my-trip (fewest stores covering your sale items), in-store mode, share a deal, Apple Watch, Siri.

## House rules

- Never push to `main` or merge without the owner's approval. Branch, open a pull request.
- Never put the owner's email address on the site.
- Weekly data: never guess a price; only use regular prices the store printed; food only; no em dashes. `npm run check` must pass.
