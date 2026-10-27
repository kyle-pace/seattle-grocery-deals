# Grocery Deals for Apple devices (SwiftUI)

The iPhone and iPad app (SwiftUI). It replaced an earlier Expo app (decided 2026-10-24: Apple devices first, so widgets, Siri, the Watch and Liquid Glass are native).

## Build and install

With the iPhone plugged in, unlocked and trusted, and Developer Mode on:

```bash
apple/install-on-iphone.sh
```

Needs the KitchenUI package checked out at `~/Developer/KitchenUI` (next to this repo), Xcode (the beta while the phone runs an iOS beta) and XcodeGen (`brew install xcodegen`). The Xcode project is generated from `GroceryDeals/project.yml`; edit that, not the `.xcodeproj`. It installs as **Deals** (`deals.seattlegrocery`, widget `deals.seattlegrocery.widget`). A free Apple ID allows only 3 of your own apps on a phone at once. Free Apple ID builds stop opening after 7 days; rerun the script.

## Code

- `Sources/Models.swift`: the app feed (`/api/week.json`) types.
- `Sources/FeedStore.swift`: loads the live feed, falls back to the last saved copy, then `Resources/week.json`; Vegetarian only.
- `Sources/Theme.swift`: brings in KitchenUI, the design language shared with the Pantry app (`~/Developer/KitchenUI`, a local Swift package that must sit next to this repo): Atkinson Hyperlegible Next scaling with Dynamic Type, `Palette` colors for light and dark, and shared components. Deals adds only the yellow sale tag and the tier badges. Accessibility rules: never color alone, 44-point targets, every screen readable at the largest text sizes, VoiceOver labels and actions on every control.
- `Sources/DealViews.swift`: price tag, deal row, deal sheet.
- `Sources/Screens.swift`: This week (search), Aisles, Stores, store page.
- `Sources/ListStore.swift`: the grocery list, in the app or in a Reminders list (EventKit); deal items carry price, store and the sale end date as the due date; whole-word matching of list items to deals.
- `Sources/ListScreens.swift`: List tab, Reminders list picker, Settings (privacy switch).
- `Sources/Analytics.swift`: Amplitude (Swift SDK), same project, events and privacy rules as the website: no IP, carrier, vendor ID or city; off switch in Settings.
- `Sources/GroceryDealsApp.swift`: app entry, native tabs (Liquid Glass on iOS 26, sidebar on iPad), and the "where should your list live?" prompt on the first add.

## Stages

1. **Done:** shell, live data, This week, Aisles, Stores, deal sheet, share.
2. **Done:** List (in the app or Reminders via EventKit), + and checkmark on every deal, Amplitude with private settings. (Trip plan dropped.)
2b. **Done:** alerts (`Sources/AlertsStore.swift`): Friday reminder, ending soon, price watches.
3. **Done:** Siri and Shortcuts (`Sources/Intents.swift`: "Add to my grocery list in Deals", "What's on sale in Deals") and the Best This Week widget (`Widget/`).
4. With the paid Apple account: TestFlight, Universal Links, Firebase push. The bundle IDs are final (2026-10-26): each app's ID is its domain written backwards, nothing added.
