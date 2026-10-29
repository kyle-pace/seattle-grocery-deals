import Foundation
import Observation
import UserNotifications

/// Local notifications: a Friday "new deals" reminder, "ends tomorrow" for list items, and
/// price watches checked when the app loads the week. When Firebase is set up, "New deals are
/// in" comes as a server push instead of the local Friday reminder (see Push.swift).
@MainActor @Observable
final class AlertsStore {
    struct Watch: Codable, Identifiable, Hashable {
        var id = UUID().uuidString
        var name: String
        var key: String?
        var target: Double
        var per: String
        var label: String
        var notifiedWeek: String?
    }

    var friday: Bool { didSet { save(); PushStore.shared.sync(newDeals: friday); Task { await scheduleFriday() }; Analytics.track("Changed Alert Setting", ["setting": "friday", "on": friday]) } }
    var endingSoon: Bool { didSet { save(); Analytics.track("Changed Alert Setting", ["setting": "ending", "on": endingSoon]) } }
    private(set) var watches: [Watch]

    init() {
        let d = UserDefaults.standard
        friday = d.bool(forKey: "sgd.alerts.friday")
        endingSoon = d.bool(forKey: "sgd.alerts.ending")
        watches = (d.data(forKey: "sgd.watches")).flatMap { try? JSONDecoder().decode([Watch].self, from: $0) } ?? []
    }

    /// True until the person has been asked about notifications, so the app can show what an
    /// alert looks like first.
    func needsAsking() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .notDetermined
    }

    /// Ask once; false if the person said no.
    func allow() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional { return true }
        return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    // MARK: Friday reminder

    private func scheduleFriday() async {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["friday"])
        // The server push replaces the guess at 10:30 when Firebase is available.
        guard friday, !PushStore.shared.available else { return }
        let content = UNMutableNotificationContent()
        content.title = "New deals are in"
        content.body = "This week's flyers are up. See what's on sale from your list."
        var when = DateComponents()
        when.weekday = 6; when.hour = 10; when.minute = 30 // Friday 10:30, after the week usually posts
        try? await center.add(UNNotificationRequest(identifier: "friday", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: true)))
    }

    // MARK: ending soon

    /// One notification at 9 AM the day before each list item's sale ends.
    func scheduleEndingSoon(_ matches: [(text: String, deal: Deal, store: String)]) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix("ends-") }
        center.removePendingNotificationRequests(withIdentifiers: pending)
        guard endingSoon else { return }
        for m in matches {
            guard let ends = Dates.date(m.deal.ends),
                  let dayBefore = Calendar.current.date(byAdding: .day, value: -1, to: ends) else { continue }
            var when = Calendar.current.dateComponents([.year, .month, .day], from: dayBefore)
            when.hour = 9
            guard let fire = Calendar.current.date(from: when), fire > .now else { continue }
            let content = UNMutableNotificationContent()
            content.title = "\(m.text): sale ends tomorrow"
            content.body = "\(m.deal.name), \(m.deal.text) at \(m.store)."
            content.interruptionLevel = .timeSensitive
            try? await center.add(UNNotificationRequest(identifier: "ends-\(m.deal.id)", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: false)))
        }
    }

    // MARK: price watches

    func watching(_ d: Deal) -> Watch? { watches.first { $0.key != nil ? $0.key == d.key : $0.name == d.name } }

    func watch(_ d: Deal, week: String?) {
        guard let u = unitValue(d) else { return }
        let label = (u.value < 1 ? "\(Int((u.value * 100).rounded()))¢" : String(format: "$%.2f", u.value)) + (u.per == "item" ? "" : u.per == "each" ? " each" : "/\(u.per)")
        watches.removeAll { $0.key != nil ? $0.key == d.key : $0.name == d.name }
        watches.insert(Watch(name: d.name, key: d.key, target: u.value, per: u.per, label: label, notifiedWeek: week), at: 0)
        save()
        Analytics.track("Created Price Watch", ["item_key": d.key ?? "", "store": d.store, "per": u.per, "target": u.value])
        Analytics.setUser(["watches_count": watches.count])
    }

    func unwatch(_ w: Watch) {
        watches.removeAll { $0.id == w.id }
        save()
        Analytics.track("Removed Price Watch")
        Analytics.setUser(["watches_count": watches.count])
    }

    /// The cheapest deal this week that beats a watch, if any.
    func hit(_ w: Watch, in items: [Deal]) -> Deal? {
        items.filter { w.key != nil ? $0.key == w.key : $0.name == w.name }
            .compactMap { d in unitValue(d).flatMap { $0.per == w.per && $0.value < w.target ? (d, $0.value) : nil } }
            .min { $0.1 < $1.1 }?.0
    }

    /// Called when a week loads: one notification per watch per week.
    func checkWatches(_ feed: Feed, storeName: (String) -> String) {
        var changed = false
        for i in watches.indices {
            guard watches[i].notifiedWeek != feed.week, let d = hit(watches[i], in: feed.items) else { continue }
            watches[i].notifiedWeek = feed.week
            changed = true
            Analytics.track("Hit Price Watch", ["item_key": watches[i].key ?? "", "store": d.store, "week": feed.week])
            let content = UNMutableNotificationContent()
            content.title = "Price drop: \(watches[i].name)"
            content.body = "\(d.text) at \(storeName(d.store)), under your \(watches[i].label) watch."
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "watch-\(watches[i].id)-\(feed.week)", content: content, trigger: nil))
        }
        if changed { save() }
    }

    // MARK: dev menu

    func devRemoveWatches() { watches = []; save() }

    /// Lets every watch alert again for the current week.
    func devResetWatchAlerts() {
        for i in watches.indices { watches[i].notifiedWeek = nil }
        save()
    }

    /// A sample notification in 5 seconds (lock the phone or go home to see it).
    func devTestNotification() async -> Bool {
        guard await allow() else { return false }
        let content = UNMutableNotificationContent()
        content.title = "Test from the dev menu"
        content.body = "Notifications from Deals are working."
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(
            identifier: "dev-test", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)))
        return true
    }

    static func devPendingCount() async -> Int { await UNUserNotificationCenter.current().pendingNotificationRequests().count }

    private func save() {
        let d = UserDefaults.standard
        d.set(friday, forKey: "sgd.alerts.friday")
        d.set(endingSoon, forKey: "sgd.alerts.ending")
        d.set(try? JSONEncoder().encode(watches), forKey: "sgd.watches")
    }
}

/// "$1.48/lb" -> (1.48, "lb"); "99¢ each" -> (0.99, "each").
func unitValue(_ d: Deal) -> (value: Double, per: String)? {
    let t = d.unit_price ?? d.text
    guard let m = t.firstMatch(of: /^\$?([\d.]+)(¢)?\s*(?:\/(\w+)|\s(each))?/), let v = Double(m.1) else { return nil }
    return (m.2 != nil ? v / 100 : v, String(m.3 ?? m.4 ?? "item"))
}

/// Shows notifications even while the app is open.
final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    /// Tapping a server push ("kind" and "week" in its data) opens This week.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let kind = info["kind"] as? String else { return }
        let week = info["week"] as? String
        await MainActor.run { PushStore.shared.opened(kind: kind, week: week) }
    }
}
