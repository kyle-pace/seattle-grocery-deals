# Seattle Grocery Deals app

An Expo (React Native) app for iPhone, and later Android. Step 1 of the plan in [../HANDOFF.md](../HANDOFF.md): it reads this week's deals from the site, with no backend.

## Try it on your iPhone

1. Install **Expo Go** from the App Store.
2. On your Mac, in this folder:
   ```bash
   npm install
   npx expo start
   ```
3. Scan the QR code with the iPhone camera. The phone and the Mac must be on the same Wi-Fi (or run `npx expo start --tunnel`).

## Install it on your iPhone as a real app

With the phone plugged in, unlocked and trusted, and Developer Mode on:

```bash
./install-on-iphone.sh
```

It builds a standalone release (no Mac or Expo Go needed to run it) and installs it. With a free Apple ID the app stops opening after 7 days; run the script again. If the phone runs an iOS beta, the matching Xcode beta is needed: the script uses the one in `~/Downloads`, or set `XCODE=/path/to/Xcode.app`.

The free Apple ID can't sign push notifications, so `plugins/without-push-entitlement.js` removes that capability. Delete it from `app.json` once there's a paid Apple Developer account.

## What's in it

- **This week:** search, Vegetarian only, the items on your list that are on sale, and the week's standouts. Pull down to refresh.
- **Departments** and **Stores:** every deal, best first. Store pages lead with a button to the store's own weekly ad, plus delivery notes.
- **Deal detail:** price, why it's a deal, the same item at other stores, add to list.
- **List:** a grocery list saved on the phone. Each item shows its best deal this week. Tap + on any deal to add it. Long-press to remove.
- **Reminders:** the first time you add to the list (or with "Use a Reminders list" on the List tab), the app offers to keep the list in a Reminders list you pick, including shared lists and Siri. Items added from a deal carry the price and store in the notes and the sale end date as the due date. Check-offs sync both ways; changes made in Reminders show up when you return to the app. `src/reminders.ts`.
- **Plan my trip** (on the list): the fewest stores that cover your sale items.
- **Alerts:** a Friday reminder and "ends tomorrow" reminders for list items, as local notifications. **Watch price** on any deal; the app alerts you when the same item is cheaper. Watches are checked when the app opens; server push (Firebase) will replace that.
- **Share** a deal from its detail sheet.
- **Amplitude** analytics (`src/analytics.ts`), same project as the website: screens, deals viewed, list adds and removals, list connected, weekly ads opened, searches, price watches, alert settings, shares. Private by default: anonymous device ID, no IP address, no advertising ID or carrier, never the list contents, and a "Share anonymous usage data" switch on the Alerts tab.
- **Liquid Glass** tab bar on iOS 26, with a solid fallback when Reduce Transparency is on, on older iOS and on Android.

## Data

The app loads `https://seattlegrocery.deals/api/week.json`, which `scripts/build.mjs` writes on every site build (`appFeed()`). If that fails, it uses the last copy it saved, then the copy bundled in `assets/week.json`. Refresh the bundled copy with `npm run build` at the repo root and `cp dist/api/week.json mobile/assets/week.json`.

## Code

- `App.tsx`: fonts, tabs, the deal sheet.
- `src/screens.tsx`: the four tabs and the deal detail.
- `src/ui.tsx`: shared pieces (Liquid Glass wrapper, price, deal row).
- `src/state.tsx`: feed, list and Vegetarian only, saved with AsyncStorage.
- `src/data.ts`: loading the feed, matching list items to deals (whole words), and trip planning.
- `src/alerts.ts`: local notifications and price watches.
- `src/theme.ts`: the Newsprint design tokens.

Navigation is plain React state for now. Moving to Expo Router (the template's recommendation in `AGENTS.md`) is a good next step once there are deep links or more screens.

## Next

Reminders sync (`expo-calendar`, needs a development build), then the backend and Firebase Cloud Messaging push. See [../HANDOFF.md](../HANDOFF.md).
