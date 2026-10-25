# Grocery Deals for Apple devices (SwiftUI)

The native app, replacing the Expo app in `mobile/` once it reaches parity (decided 2026-10-24: Apple devices first, so widgets, Siri, the Watch and Liquid Glass are native).

## Build and install

With the iPhone plugged in, unlocked and trusted, and Developer Mode on:

```bash
apple/install-on-iphone.sh
```

Needs Xcode (the beta while the phone runs an iOS beta) and XcodeGen (`brew install xcodegen`). The Xcode project is generated from `GroceryDeals/project.yml`; edit that, not the `.xcodeproj`. It installs as **Deals** (`deals.seattlegrocery.native`) next to the Expo app until parity. Free Apple ID builds stop opening after 7 days; rerun the script.

## Code

- `Sources/Models.swift`: the app feed (`/api/week.json`) types.
- `Sources/FeedStore.swift`: loads the live feed, falls back to the last saved copy, then `Resources/week.json`; Vegetarian only.
- `Sources/Theme.swift`: Newsprint tokens and fonts (Barlow Condensed, Atkinson Hyperlegible; both scale with Dynamic Type).
- `Sources/DealViews.swift`: price tag, deal row, deal sheet.
- `Sources/Screens.swift`: This week (search), Aisles, Stores, store page.
- `Sources/ListStore.swift`: the grocery list, in the app or in a Reminders list (EventKit); deal items carry price, store and the sale end date as the due date; whole-word matching of list items to deals.
- `Sources/ListScreens.swift`: List tab, Reminders list picker, Settings (privacy switch).
- `Sources/Analytics.swift`: Amplitude (Swift SDK), same project, events and privacy rules as the website and Expo app: no IP, carrier, vendor ID or city; off switch in Settings.
- `Sources/GroceryDealsApp.swift`: app entry, native tabs (Liquid Glass on iOS 26, sidebar on iPad), and the "where should your list live?" prompt on the first add.

## Stages

1. **Done:** shell, live data, This week, Aisles, Stores, deal sheet, share.
2. **Done:** List (in the app or Reminders via EventKit), + and checkmark on every deal, Amplitude with private settings. (Trip plan dropped.)
2b. Alerts: Friday reminder, ending soon, price watches.
3. Widget, Siri and Shortcuts (App Intents).
4. With the paid Apple account: TestFlight, Universal Links, Firebase push. Then remove `mobile/`.
