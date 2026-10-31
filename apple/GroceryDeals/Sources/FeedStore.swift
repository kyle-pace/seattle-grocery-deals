import Foundation
import Observation

/// Loads this week's deals: the live feed first, then the last saved copy, then the copy
/// bundled with the app, so it always has something to show.
@MainActor @Observable
final class FeedStore {
    static let feedURL = URL(string: "https://seattlegrocery.deals/api/week.json")!
    static let popularURL = URL(string: "https://seattlegrocery.deals/api/popular.json")!

    /// What people are adding this week; empty until enough people have added the same deals.
    private(set) var popular: [Popular.Item] = []

    private(set) var feed: Feed?
    private(set) var loading = false
    /// The last refresh couldn't reach the site, so we're showing a saved week.
    private(set) var offline = false
    var vegetarianOnly: Bool {
        didSet {
            UserDefaults.standard.set(vegetarianOnly, forKey: "sgd.vegOnly")
            Analytics.track("Toggled Vegetarian Only", ["on": vegetarianOnly])
            Analytics.setUser(["veg_only": vegetarianOnly])
        }
    }

    /// The stores someone picked in onboarding or Settings. They come first everywhere; no
    /// store is ever hidden.
    var favoriteStores: Set<String> {
        didSet {
            UserDefaults.standard.set(Array(favoriteStores).sorted(), forKey: "sgd.favoriteStores")
            Analytics.setUser(["favorite_stores": favoriteStores.count])
            // "New deals are in" follows the stores someone picked.
            PushStore.shared.storesChanged(favoriteStores)
        }
    }

    init() {
        favoriteStores = Set(UserDefaults.standard.stringArray(forKey: "sgd.favoriteStores") ?? [])
        vegetarianOnly = UserDefaults.standard.bool(forKey: "sgd.vegOnly")
        feed = Self.cached() ?? Self.bundled()
    }

    func refresh() async {
        loading = true
        defer { loading = false }
        Task { await refreshPopular() }
        do {
            let (data, response) = try await URLSession.shared.data(from: Self.feedURL)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { offline = true; return }
            let fresh = try JSONDecoder().decode(Feed.self, from: data)
            offline = false
            if feed == nil || fresh.week >= feed!.week {
                feed = fresh
                try? data.write(to: Self.cacheURL, options: .atomic)
            }
        } catch is URLError {
            offline = true // keep what we have, and say so
        } catch {
            // The feed changed shape: keep what we have.
        }
    }

    /// Fetches /api/popular.json (rebuilt hourly). Quietly keeps the last list on failure.
    func refreshPopular() async {
        guard let (data, response) = try? await URLSession.shared.data(from: Self.popularURL),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let fresh = try? JSONDecoder().decode(Popular.self, from: data) else { return }
        popular = fresh.items
    }

    /// Popular deals that are in this week's feed (and pass the vegetarian filter), with counts.
    var popularDeals: [(deal: Deal, people: Int)] {
        popular.compactMap { p in items.first { $0.id == p.deal_id }.map { ($0, p.people) } }
    }

    // MARK: the edition

    /// Days until this week's sales end, counting today: 0 means it ended.
    var daysLeft: Int? {
        guard let end = Dates.date(feed?.end) else { return nil }
        let cal = Calendar.current
        return (cal.dateComponents([.day], from: cal.startOfDay(for: .now), to: cal.startOfDay(for: end)).day ?? 0) + 1
    }

    /// "Updated Oct 30 · 576 deals · Most run through Thursday, some end Tuesday" for the This
    /// week header. Stores' sales end on different days, and each store is updated when its
    /// next flyer comes out.
    var editionLine: String {
        guard let feed else { return "" }
        var parts = ["Updated \(Dates.short(feed.updated ?? feed.week, weekday: false))", "\(items.count) deals"]
        let most = feed.ends?.most ?? feed.end
        if let left = Self.daysUntil(most) {
            if left <= 0 { parts.append("Most have ended") }
            else {
                var text = left == 1 ? "Most end today" : "Most run through \(Self.dayWord(most, left: left))"
                if let some = feed.ends?.some, let s = Self.daysUntil(some), s >= 1, let m = most, some < m {
                    text += ", some end \(Self.dayWord(some, left: s))"
                }
                parts.append(text)
            }
        }
        return parts.joined(separator: " · ")
    }

    /// Days until a date's sales end, counting today: 1 means today, 0 means it ended.
    private static func daysUntil(_ iso: String?) -> Int? {
        guard let date = Dates.date(iso) else { return nil }
        let cal = Calendar.current
        return (cal.dateComponents([.day], from: cal.startOfDay(for: .now), to: cal.startOfDay(for: date)).day ?? 0) + 1
    }

    private static func dayWord(_ iso: String?, left: Int) -> String {
        if left == 1 { return "today" }
        if left == 2 { return "tomorrow" }
        return Dates.date(iso)?.formatted(.dateTime.weekday(.wide)) ?? ""
    }

    // MARK: lookups

    /// Deals after the vegetarian filter, best first.
    var items: [Deal] { (feed?.items ?? []).filter { !vegetarianOnly || $0.veg } }
    var standouts: [Deal] { items.filter { $0.tier == .standout } }
    func store(_ id: String) -> Store? { feed?.stores.first { $0.id == id } }
    func storeName(_ id: String) -> String { store(id)?.name ?? id }
    func label(forCategory id: String) -> String { feed?.categories.first { $0.id == id }?.label ?? id }
    func deals(inCategory id: String) -> [Deal] { items.filter { $0.category == id } }
    func deals(atStore id: String) -> [Deal] { items.filter { $0.store == id } }
    /// The same item on sale elsewhere this week (matched by item key).
    func alsoOnSale(_ d: Deal) -> [Deal] {
        guard let key = d.key else { return [] }
        return (feed?.items ?? []).filter { $0.key == key && $0.id != d.id }
    }
    /// The best standouts, at most `perStore` from any one store so no store takes over.
    func topPicks(_ limit: Int = 10, perStore: Int = 2) -> [Deal] {
        var taken: [String: Int] = [:]
        return Array(standouts.filter { d in
            taken[d.store, default: 0] += 1
            return taken[d.store]! <= perStore
        }.prefix(limit))
    }
    /// Your stores first, then most standouts, then most deals.
    var rankedStores: [Store] {
        (feed?.stores ?? []).sorted {
            let fa = favoriteStores.contains($0.id), fb = favoriteStores.contains($1.id)
            if fa != fb { return fa }
            let a = deals(atStore: $0.id), b = deals(atStore: $1.id)
            let sa = a.filter { $0.tier == .standout }.count, sb = b.filter { $0.tier == .standout }.count
            return sa != sb ? sa > sb : a.count > b.count
        }
    }
    func isFavorite(_ id: String) -> Bool { favoriteStores.contains(id) }
    func toggleFavorite(_ id: String) {
        if favoriteStores.contains(id) { favoriteStores.remove(id) } else { favoriteStores.insert(id) }
    }

    /// Aisles that have deals this week, in the feed's order.
    var aisles: [Category] { (feed?.categories ?? []).filter { c in items.contains { $0.category == c.id } } }

    /// What people might be typing: aisles, stores and short deal names that start with (or
    /// contain) the query, best deals first. For `.searchSuggestions`.
    func suggestions(_ query: String, limit: Int = 6) -> [String] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard q.count >= 2 else { return [] }
        var seen = Set<String>()
        var out: [String] = []
        func offer(_ s: String) {
            let key = s.lowercased()
            guard key.contains(q), !seen.contains(key) else { return }
            seen.insert(key)
            out.append(s)
        }
        for c in aisles where c.label.lowercased().hasPrefix(q) { offer(c.label) }
        for d in items where shortName(d.name).lowercased().hasPrefix(q) { offer(shortName(d.name)) }
        for d in items { offer(shortName(d.name)) }
        return Array(out.prefix(limit))
    }

    /// A few things worth searching for: what people are adding this week when there's enough
    /// of it, topped up with the week's top standouts.
    var popularSearches: [String] {
        var seen = Set<String>()
        let names = popularDeals.map { shortName($0.deal.name) } + topPicks(20, perStore: 3).map { shortName($0.name) }
        return names.filter { seen.insert($0.lowercased()).inserted }.prefix(8).map { $0 }
    }
    func searchStores(_ query: String) -> [Store] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return rankedStores.filter { $0.name.lowercased().contains(q) || $0.towns.lowercased().contains(q) }
    }
    func search(_ query: String) -> [Deal] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return items.filter { $0.name.lowercased().contains(q) || storeName($0.store).lowercased().contains(q) }
    }

    // MARK: dev menu

    /// Where the week on screen came from.
    var devSource: String {
        if offline { return "Saved copy (offline)" }
        return Self.hasSavedWeek ? "Live, saved on this iPhone" : "Bundled with the app"
    }

    /// Deletes the saved week and shows the bundled one until the next refresh.
    func devClearSavedWeek() {
        try? FileManager.default.removeItem(at: Self.cacheURL)
        feed = Self.bundled()
    }

    // MARK: storage

    private static var cacheURL: URL {
        URL.applicationSupportDirectory.appending(path: "week.json")
    }
    /// True once any week has been saved, so the app has been opened before.
    static var hasSavedWeek: Bool { FileManager.default.fileExists(atPath: cacheURL.path(percentEncoded: false)) }
    private static func cached() -> Feed? {
        try? FileManager.default.createDirectory(at: URL.applicationSupportDirectory, withIntermediateDirectories: true)
        guard let data = try? Data(contentsOf: cacheURL) else { return nil }
        return try? JSONDecoder().decode(Feed.self, from: data)
    }
    private static func bundled() -> Feed? {
        guard let url = Bundle.main.url(forResource: "week", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Feed.self, from: data)
    }
}
