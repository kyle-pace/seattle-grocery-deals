# Grocery Deals for Apple devices (SwiftUI)

The iPhone and iPad app (SwiftUI). It replaced an earlier Expo app (decided 2026-10-24: Apple devices first, so widgets, Siri, the Watch and Liquid Glass are native).

## Build and install on your iPhone

From anywhere on the Mac: `phone deals` (or `phone` for both apps; see KitchenUI's `tools/phone`). In this repo:

```bash
apple/install-on-iphone.sh            # build what's checked out, install, open it
apple/install-on-iphone.sh --no-open
```

It installs **Deals Dev**: bundle ID `deals.seattlegrocery.dev` (widget `.dev.widget`), the name "Deals Dev" and a DEV icon (`AppIconDev`), so it sits next to the TestFlight or App Store app with its own data. The build settings `BUNDLE_ID_SUFFIX`, `APP_NAME_SUFFIX` and `APP_ICON_SUFFIX` in `project.yml` are empty for everything else.

The phone can be plugged in or paired over Wi-Fi (Xcode, Devices and Simulators, "Connect via network"), unlocked and trusted. Needs the KitchenUI package checked out at `~/Developer/KitchenUI` (next to this repo), Xcode (the beta while the phone runs an iOS beta) and XcodeGen (`brew install xcodegen`). The Xcode project is generated from `GroceryDeals/project.yml`; edit that, not the `.xcodeproj`. Signed with the paid developer account, so a phone build keeps opening for a year.

## TestFlight (Xcode Cloud)

TestFlight builds come from Xcode Cloud, not this Mac. Commit and push, then:

```bash
apple/testflight.sh            # tag the pushed commit v<version> and push the tag
apple/testflight.sh --dry-run  # show the version and tag only
```

Xcode Cloud's **TestFlight** workflow starts on any tag beginning with `v`, so weekly data merges and everyday pushes to `main` never make a TestFlight build. It archives the `GroceryDeals` scheme (Release, so the bundle ID is `deals.seattlegrocery`, never `.dev`) on the latest release Xcode and uploads to App Store Connect for internal testers. The version is `MARKETING_VERSION` in `project.yml`; a second build of the same version is tagged `v<version>-2` and so on. **Xcode Cloud sets the build number** (its own counter), not the commit count the old local script used, so don't upload from this Mac any more: a local upload would collide with those numbers.

### External testers

A second Xcode Cloud workflow, **TestFlight External**, builds tags that start with `beta-` and sends them to the **External Testers** group. Apple reviews the first external build of each version (usually within a day); later builds of the same version mostly go straight out.

```bash
apple/testflight.sh --external            # tag beta-<version> and push
apple/testflight.sh --external --dry-run  # show the tag and the notes for testers
```

- Notes for testers ("What to Test") come from `GroceryDeals/TestFlight/WhatToTest.en-US.txt`, next to `ci_scripts`. Update it before each external build.
- The two workflows differ in three settings: the start condition (tags beginning with `v` or with `beta-`), the archive's distribution (**TestFlight (Internal Testing Only)** or **TestFlight and App Store**), and the post-action (**TestFlight Internal Testing** or **TestFlight External Testing** with the External Testers group). A build from the internal workflow can never be given to external testers, so external builds have to come from the second one.
- External testing also needs App Store Connect's Test Information (beta description, feedback email, privacy policy link) and a contact for Apple's reviewer.
- Each external build is a second Xcode Cloud run, on the same 25 free hours a month.

How it fits together:
- `GroceryDeals/ci_scripts/ci_post_clone.sh` clones KitchenUI's `main` next to the repo, where `project.yml` expects the local package (`../../../KitchenUI`). Push KitchenUI changes before tagging.
- The `GroceryDeals` scheme is shared (committed under `xcshareddata`) because Xcode Cloud only sees shared schemes; it's defined in `project.yml`.
- Packages resolve from the committed `Package.resolved` (Xcode Cloud turns automatic resolution off), so commit it after changing package versions.
- Free plan: 25 compute hours a month across all the account's apps.

App Store Connect: app "Seattle Grocery Deals", SKU `seattle-grocery-deals`. First build: 0.1.0 (1), 2026-10-26, uploaded from the Mac.

## Code

- `Sources/Models.swift`: the app feed (`/api/week.json`) types.
- `Sources/FeedStore.swift`: loads the live feed. This week's saved copy shows at once and is replaced when the fetch lands; with nothing recent saved (a first launch, or a week away) the app shows a loading screen until live deals arrive, and only falls back to an older saved week or `Resources/week.json` when the site can't be reached. Fetches again when the app comes back after ten minutes. Builds its lists and lookups once per change (`Derived`): add new lists there, don't filter `items` in a view. Xcode Cloud refreshes `Resources/week.json` from the site on every TestFlight build (`ci_post_clone.sh`).
- `Sources/Theme.swift`: brings in KitchenUI, the design language shared with the Pantry app (`~/Developer/KitchenUI`, a local Swift package that must sit next to this repo): Atkinson Hyperlegible Next scaling with Dynamic Type, `Palette` colors for light and dark, and shared components. Deals adds only the yellow sale tag and the tier badges. Accessibility rules: never color alone, 44-point targets, every screen readable at the largest text sizes, VoiceOver labels and actions on every control.
- `Sources/DealViews.swift`: price tag, deal row, deal sheet.
- `Sources/Screens.swift`: This week, Stores, store page (weekly ad card, search in the store), pinned bars.
- `Sources/Aisles.swift`: the Aisles tab and one page per aisle (store chips, sort, search).
- `Sources/Search.swift`: the Search tab (the field at the bottom on iPhone, in place of the tab bar; picking the tab opens the keyboard), Spotlight indexing of the week's deals, and the router Siri and Spotlight use.
- `Sources/Flyer.swift`: the full-screen weekly ad viewer (page images, PDFs) and Safari's viewer for page-only stores.
- `Sources/ListStore.swift`: the grocery list, in the app or in a Reminders list (EventKit); deal items carry price, store and the sale end date as the due date; whole-word matching of list items to deals.
- `Sources/ListScreens.swift`: List tab, Reminders list picker, Settings (privacy switch).
- `Sources/Analytics.swift`: Amplitude (Swift SDK), same project, events and privacy rules as the website: no IP, carrier, vendor ID or city. Off until the person says yes in onboarding (Amplitude isn't created before that); the switch in Settings changes the answer.
- `Sources/Push.swift`: Firebase Cloud Messaging, push only (no Firebase Analytics). Configures Firebase from `Resources/GoogleService-Info-Dev.plist` (and `-Prod` once that project exists), hands the APNs token over, and subscribes to `new-deals` when "New deals are in" is on (plus `new-deals-test` on the dev project). Tapping a push opens This week. Without a config file the app keeps the local Friday reminder.
- `Sources/Welcome.swift`: first-run onboarding, built on KitchenUI's `Onboarding`: welcome, your stores, alerts, how it works, then the usage question. Everything but the question can be skipped (Skip on a middle step skips that step only). Installs that ran 0.1.0 (sharing by default) skip onboarding and stay opted in; anyone who had turned the old switch off stays off. Settings has "Show the tour again". Simulator: `-onboarding question` jumps to the question on a fresh install.
- `Sources/DealsDevMenu.swift`: Settings, Developer (Debug and development-signed builds only, never TestFlight or the App Store; KitchenUI's `BuildKind`): onboarding and analytics tools from KitchenUI, plus reload or drop the saved week, ask where the list lives again, empty the in-app list, test notification, re-check or remove price watches, reset everything.
- `Sources/GroceryDealsApp.swift`: app entry, native tabs (Liquid Glass on iOS 26, sidebar on iPad), and Spotlight hand-off. The "where should your list live?" half sheet is in `ListScreens.swift`.

## Stages

1. **Done:** shell, live data, This week, Aisles, Stores, deal sheet, share.
2. **Done:** List (in the app or Reminders via EventKit), + and checkmark on every deal, Amplitude with private settings. (Trip plan dropped.)
2b. **Done:** alerts (`Sources/AlertsStore.swift`): new deals (a server push per store; a weekly local reminder without Firebase), ending soon, price watches.
3. **Done:** Siri and Shortcuts (`Sources/Intents.swift`: "Add to my grocery list in Deals", "What's on sale in Deals") and the Best This Week widget (`Widget/`).
4. With the paid Apple account: **TestFlight done** (2026-10-26). **Firebase push wired up** (2026-10-26): dev project `seattle-grocery-deals-dev`, APNs key `62XWUGPJN9`, sent from the deploy workflow. Then Universal Links. The bundle IDs are final (2026-10-26): each app's ID is its domain written backwards, nothing added.
