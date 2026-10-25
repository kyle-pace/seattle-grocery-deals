import EventKit
import Foundation
import Observation

/// The grocery list, kept in the app or in a Reminders list the person picks (shared lists and
/// Siri included). Items added from a deal carry the price and store in the notes and the sale
/// end date as the due date, so Reminders shows when the deal expires.
@MainActor @Observable
final class ListStore {
    struct Item: Codable, Identifiable, Hashable {
        var id: String
        var text: String
        var done = false
        var dealID: String?
    }
    enum Source: Codable, Equatable {
        case app
        case reminders(id: String, title: String)
    }

    /// nil until the person chooses, which happens on their first add.
    private(set) var source: Source?
    private(set) var items: [Item] = []
    private(set) var remindersLists: [EKCalendar] = []
    var lastError: String?

    /// An add waiting for the person to choose where the list lives (first add only).
    struct PendingAdd { let text: String; let deal: Deal?; let storeName: String? }
    var pendingAdd: PendingAdd?

    private let events = EKEventStore()
    private static let dealURL = "grocerydeals://deal/"

    init() {
        if let data = UserDefaults.standard.data(forKey: "sgd.listSource") {
            source = try? JSONDecoder().decode(Source.self, from: data)
        }
        if case .reminders = source { reload() } else { items = Self.savedAppItems() }
    }

    var title: String {
        if case .reminders(_, let title) = source { return title }
        return "Groceries"
    }
    var usesReminders: Bool { if case .reminders = source { return true } else { return false } }
    var openItems: [Item] { items.filter { !$0.done } }
    func contains(_ deal: Deal) -> Bool { openItems.contains { $0.dealID == deal.id } }

    // MARK: choosing where the list lives

    /// Ask for Reminders access and load the lists to pick from. False if access was refused.
    func loadRemindersLists() async -> Bool {
        do {
            guard try await events.requestFullAccessToReminders() else { return false }
            remindersLists = events.calendars(for: .reminder)
                .filter(\.allowsContentModifications)
                .sorted { a, b in
                    let ga = a.title.range(of: "grocer|shopping", options: [.regularExpression, .caseInsensitive]) != nil
                    let gb = b.title.range(of: "grocer|shopping", options: [.regularExpression, .caseInsensitive]) != nil
                    return ga != gb ? ga : a.title < b.title
                }
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func use(_ list: EKCalendar, prompt: String) {
        setSource(.reminders(id: list.calendarIdentifier, title: list.title))
        Analytics.track("Connected List", ["source": "reminders", "prompt": prompt])
        reload()
    }

    func useApp(prompt: String) {
        setSource(.app)
        items = Self.savedAppItems()
        Analytics.track("Connected List", ["source": "app", "prompt": prompt])
    }

    private func setSource(_ s: Source) {
        source = s
        UserDefaults.standard.set(try? JSONEncoder().encode(s), forKey: "sgd.listSource")
        Analytics.setUser(["list_source": usesReminders ? "reminders" : "app"])
    }

    // MARK: editing

    /// Add, or on the very first add, ask where the list should live first.
    func request(_ text: String, deal: Deal? = nil, storeName: String? = nil) {
        if source == nil { pendingAdd = PendingAdd(text: text, deal: deal, storeName: storeName) }
        else { add(text, deal: deal, storeName: storeName) }
    }

    func finishPendingAdd() {
        guard let p = pendingAdd else { return }
        pendingAdd = nil
        if source != nil { add(p.text, deal: p.deal, storeName: p.storeName) }
    }

    func add(_ text: String, deal: Deal? = nil, storeName: String? = nil) {
        Analytics.track(deal == nil ? "Added Item to List" : "Added Deal to List",
                        (deal.map(Analytics.deal) ?? [:]).merging(["list_source": usesReminders ? "reminders" : "app"]) { a, _ in a })
        switch source {
        case .reminders(let id, _):
            guard let list = events.calendar(withIdentifier: id) else { lastError = "That Reminders list no longer exists. Pick another."; return }
            let r = EKReminder(eventStore: events)
            r.calendar = list
            r.title = text
            if let deal {
                r.notes = "\(deal.text) at \(storeName ?? deal.store)" + (deal.ends.map { ". Sale ends \(Dates.short($0))." } ?? ".")
                r.url = URL(string: Self.dealURL + deal.id)
                if let ends = Dates.date(deal.ends) {
                    r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day], from: ends)
                }
            }
            do { try events.save(r, commit: true) } catch { lastError = error.localizedDescription }
            reload()
        default:
            items.insert(Item(id: UUID().uuidString, text: text, dealID: deal?.id), at: 0)
            saveAppItems()
        }
    }

    func toggle(_ item: Item) {
        guard let i = items.firstIndex(of: item) else { return }
        items[i].done.toggle()
        if usesReminders, let r = events.calendarItem(withIdentifier: item.id) as? EKReminder {
            r.isCompleted = items[i].done
            try? events.save(r, commit: true)
        } else { saveAppItems() }
    }

    func remove(_ item: Item) {
        items.removeAll { $0.id == item.id }
        if usesReminders, let r = events.calendarItem(withIdentifier: item.id) as? EKReminder {
            try? events.remove(r, commit: true)
        } else { saveAppItems() }
    }

    /// Undo "add" for a deal: tapping its checkmark again.
    func remove(deal: Deal) {
        Analytics.track("Removed Deal from List", ["deal_id": deal.id, "store": deal.store, "list_source": usesReminders ? "reminders" : "app"])
        for item in openItems where item.dealID == deal.id { remove(item) }
    }

    /// Re-read Reminders (Siri or someone sharing the list may have changed it).
    func reload() {
        // The in-app list may have changed from Siri (another ListStore instance).
        if !usesReminders { items = Self.savedAppItems(); return }
        guard case .reminders(let id, _) = source, let list = events.calendar(withIdentifier: id) else { return }
        let predicate = events.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [list])
        events.fetchReminders(matching: predicate) { reminders in
            let fetched = (reminders ?? []).map { r in
                Item(id: r.calendarItemIdentifier, text: r.title ?? "", done: false,
                     dealID: r.url?.absoluteString.hasPrefix(Self.dealURL) == true ? String(r.url!.absoluteString.dropFirst(Self.dealURL.count)) : nil)
            }
            Task { @MainActor in self.items = fetched }
        }
    }

    // MARK: in-app storage

    private func saveAppItems() {
        UserDefaults.standard.set(try? JSONEncoder().encode(items), forKey: "sgd.list")
    }
    private static func savedAppItems() -> [Item] {
        guard let data = UserDefaults.standard.data(forKey: "sgd.list"),
              let items = try? JSONDecoder().decode([Item].self, from: data) else { return [] }
        return items
    }
}

/// The best deal this week for a list entry such as "persimmons" or "green onions".
/// Whole words only, so "eggs" doesn't match "eggplant" and "rice" doesn't match "price".
func matchDeal(_ entry: String, in deals: [Deal]) -> Deal? {
    let words = entry.lowercased()
        .replacingOccurrences(of: "[^a-z0-9 ]", with: " ", options: .regularExpression)
        .split(separator: " ").map(String.init).filter { $0.count > 1 }
        .map { w -> String in
            if w.count > 3, w.hasSuffix("es"), !w.hasSuffix("oes") { return String(w.dropLast(2)) }
            if w.count > 3, w.hasSuffix("s") { return String(w.dropLast()) }
            return w
        }
    guard !words.isEmpty else { return nil }
    let patterns = words.map { try? NSRegularExpression(pattern: "\\b\(NSRegularExpression.escapedPattern(for: $0))(e?s)?\\b", options: .caseInsensitive) }
    return deals.filter { d in
        let range = NSRange(d.name.startIndex..., in: d.name)
        return patterns.allSatisfy { $0?.firstMatch(in: d.name, range: range) != nil }
    }
    .min { $0.rank < $1.rank }
}
