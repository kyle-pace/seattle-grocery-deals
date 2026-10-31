import SwiftUI
import UserNotifications

/// Deals' developer menu (Settings, Developer): KitchenUI's shared onboarding, analytics and
/// build tools, plus the week, the list and alerts. Hidden on App Store builds.
struct DealsDevMenu: View {
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Environment(AlertsStore.self) private var alerts
    @State private var showing = false
    @State private var start: Onboarding.Start = .welcome
    @State private var pending = 0
    @State private var note: String?

    var body: some View {
        DevMenu(
            onboarding: DevOnboarding(present: { start = $0; showing = true }, forget: Analytics.forget),
            analytics: { DevAnalytics(sharing: Analytics.choice, hasKey: Analytics.hasKey, deviceID: Analytics.deviceID, flush: Analytics.flush) },
            resetAll: resetAll
        ) {
            if let note {
                Section { Text(note).foregroundStyle(Palette.muted) }
            }

            Section {
                LabeledContent("Week", value: store.feed?.week ?? "None")
                LabeledContent("Deals", value: "\(store.items.count)")
                LabeledContent("From", value: store.devSource)
                DevAction("Reload from the site", detail: FeedStore.feedURL.absoluteString) {
                    Task { await store.refresh(); done(store.offline ? "Couldn't reach the site." : "Loaded week \(store.feed?.week ?? "?").") }
                }
                DevAction("Use the bundled week", detail: "Deletes the saved week. The next launch also counts as a new install.") {
                    store.devClearSavedWeek(); done("Showing the bundled week.")
                }
            } header: { Text("This week") }

            Section {
                @Bindable var store = store
                LabeledContent("In the feed", value: (store.feed?.seasons?.items ?? []).map(\.label).joined(separator: ", ").nilIfEmpty ?? "None")
                LabeledContent("Showing", value: store.seasons.map(\.label).joined(separator: ", ").nilIfEmpty ?? "None")
                Picker("Sample seasons", selection: $store.devSampleSeasons) {
                    Text("Off (the feed's)").tag(0)
                    Text("One").tag(1)
                    Text("Two (a row of cards)").tag(2)
                }
                DevAction("Open the first season", detail: "The season screen, as if you tapped the card.") {
                    if let s = store.allSeasons.first { DealsRouter.shared.openSeason(s.id); done("Opening \(s.name).") } else { done("No season this week. Turn on a sample.") }
                }
                DevAction("Show hidden seasons again", detail: "\(store.hiddenSeasons.count) hidden with \u{201C}Hide for this season\u{201D}.") {
                    store.hiddenSeasons = []; done("Hidden seasons are back.")
                }
            } header: { Text("Seasons") } footer: {
                Text("Samples are made from this week's produce, so the card, the row of cards and the season screen can be tried any time of year.")
            }

            Section {
                LabeledContent("Lives in", value: list.usesReminders ? "Reminders: \(list.title)" : "This app")
                LabeledContent("Items", value: "\(list.items.count) (\(list.openItems.count) open)")
                DevAction("Ask where the list lives again", detail: "The next add shows the Reminders question. Reminders isn't changed.") {
                    list.devForgetSource(); done("The next add will ask.")
                }
                DevAction("Empty the in-app list", role: .destructive) { list.devClearAppList(); done("In-app list emptied.") }
            } header: { Text("List") }

            Section {
                LabeledContent("Scheduled notifications", value: "\(pending)")
                LabeledContent("Price watches", value: "\(alerts.watches.count)")
                DevAction("Send a test notification", detail: "Arrives in 5 seconds. Go to the Home Screen to see it.") {
                    Task { done(await alerts.devTestNotification() ? "Test notification on its way." : "Notifications are off for Deals in iOS Settings.") }
                }
                DevAction("Check price watches now", detail: "Lets every watch alert again for this week, then checks.") {
                    alerts.devResetWatchAlerts()
                    if let feed = store.feed { alerts.checkWatches(feed, storeName: store.storeName) }
                    done("Checked \(alerts.watches.count) watches.")
                }
                DevAction("Remove all price watches", role: .destructive) { alerts.devRemoveWatches(); done("Watches removed.") }
            } header: { Text("Alerts") }
        }
        .task { pending = await AlertsStore.devPendingCount() }
        .fullScreenCover(isPresented: $showing) {
            Welcome.view(start) { showing = false }
        }
    }

    private func done(_ message: String) {
        note = message
        Announce.say(message)
        Task { pending = await AlertsStore.devPendingCount() }
    }

    /// Everything Deals keeps on this iPhone: settings, list, watches, the saved week and
    /// scheduled notifications. Onboarding shows at the next launch.
    private func resetAll() {
        if let id = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: id) }
        store.devClearSavedWeek()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UserDefaults.standard.set(true, forKey: Welcome.forceKey)
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
