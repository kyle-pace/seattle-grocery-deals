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

## What's in it

- **This week:** search, Vegetarian only, the items on your list that are on sale, and the week's standouts. Pull down to refresh.
- **Departments** and **Stores:** every deal, best first. Store pages lead with a button to the store's own weekly ad, plus delivery notes.
- **Deal detail:** price, why it's a deal, the same item at other stores, add to list.
- **List:** a grocery list saved on the phone. Each item shows its best deal this week. Tap + on any deal to add it. Long-press to remove.
- **Plan my trip** (on the list): the fewest stores that cover your sale items.
- **Alerts:** a Friday reminder and "ends tomorrow" reminders for list items, as local notifications. **Watch price** on any deal; the app alerts you when the same item is cheaper. Watches are checked when the app opens; server push (Firebase) will replace that.
- **Share** a deal from its detail sheet.
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
