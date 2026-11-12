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
    /// Hides deals that end today (and ended ones) everywhere, like Vegetarian. The website's
    /// "Not ending today" filter does the same (app.js, sgd.endsMin).
    var hideEndingToday: Bool {
        didSet {
            UserDefaults.standard.set(hideEndingToday, forKey: "sgd.hideEndingToday")
            Analytics.track("Toggled Hide Ending Today", ["on": hideEndingToday])
        }
    }
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

    /// Seasons someone hid from This week ("Hide for this season"), as "<id>@<last day>", so a
    /// hidden card comes back next year. Kept on this iPhone only.
    var hiddenSeasons: Set<String> {
        didSet { UserDefaults.standard.set(Array(hiddenSeasons).sorted(), forKey: "sgd.hiddenSeasons") }
    }

    /// Dev menu: 0 shows the feed's seasons, 1 and 2 show that many sample seasons made from this
    /// week's deals, so the card and screen can be tried any time of year.
    var devSampleSeasons: Int {
        didSet { UserDefaults.standard.set(devSampleSeasons, forKey: "sgd.dev.sampleSeasons") }
    }

    init() {
        hiddenSeasons = Set(UserDefaults.standard.stringArray(forKey: "sgd.hiddenSeasons") ?? [])
        devSampleSeasons = UserDefaults.standard.integer(forKey: "sgd.dev.sampleSeasons")
        favoriteStores = Set(UserDefaults.standard.stringArray(forKey: "sgd.favoriteStores") ?? [])
        vegetarianOnly = UserDefaults.standard.bool(forKey: "sgd.vegOnly")
        hideEndingToday = UserDefaults.standard.bool(forKey: "sgd.hideEndingToday")
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
        popular.compactMap { p in live.first { $0.id == p.deal_id }.map { ($0, p.people) } }
    }

    // MARK: the edition

    /// Days until this week's sales end, counting today: 0 means it ended.
    var daysLeft: Int? {
        guard let end = Dates.date(feed?.end) else { return nil }
        let cal = Calendar.current
        return (cal.dateComponents([.day], from: cal.startOfDay(for: .now), to: cal.startOfDay(for: end)).day ?? 0) + 1
    }

    /// "576 deals from 12 stores" for the This week header. Each store updates as soon as its
    /// new flyer comes out, so there's no one date for the week; every row says when it ends.
    var editionLine: String {
        guard feed != nil else { return "" }
        let stores = Set(items.map(\.store)).count
        return "\(items.count) deals from \(stores) \(stores == 1 ? "store" : "stores")"
    }

    // MARK: lookups

    /// Deals after the vegetarian filter, best first.
    var items: [Deal] {
        (feed?.items ?? []).filter { (!vegetarianOnly || $0.veg) && (!hideEndingToday || ($0.daysLeft ?? 99) >= 2) }
    }
    /// Deals still on sale today. This week (the home screen) only shows these: a sale that
    /// ended stays in the feed until its store's next flyer, and stays on store and aisle
    /// pages (faded, marked Ended), but it's no use at the top of the app.
    var live: [Deal] { items.filter { !$0.ended } }
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
            guard !d.ended else { return false }
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
    /// Adds or removes a store from Your stores. `source` says where (onboarding, sheet,
    /// settings, store page) for the "Changed Your Stores" event.
    func toggleFavorite(_ id: String, source: String = "store_page") {
        let added = !favoriteStores.contains(id)
        if added { favoriteStores.insert(id) } else { favoriteStores.remove(id) }
        Analytics.track("Changed Your Stores", ["store": id, "added": added, "count": favoriteStores.count, "source": source])
    }

    // MARK: Best of your stores

    /// A store's rank numbers for this week, vegetarian ones when Vegetarian is on. Feeds from
    /// before 2026-11-07 have none: the numbers are then worked out roughly from the deals.
    func rank(_ id: String) -> RankNumbers? {
        if let r = feed?.store_ranks?[id] { return vegetarianOnly ? (r.veg ?? r.all) : r.all }
        let mine = deals(atStore: id)
        guard !mine.isEmpty else { return nil }
        let st = mine.filter { $0.tier == .standout }.count, good = mine.filter { $0.tier == .good }.count
        return RankNumbers(score: Double(st) * 4 + Double(good) * 0.8, standouts: st, good: good, deals: mine.count,
                           aisles: Set(mine.map(\.category)).count, quiet: st < 3 && good < 6, reason: "",
                           top: mine.filter { $0.tier != .sale }.prefix(3).map(\.id))
    }

    /// This week's store ranking (ThisWeekView, the site's app.js does the same):
    /// - `ranked`: your stores best first, or every store when you haven't picked any;
    /// - `quiet`: the best of them is having a quiet week;
    /// - `elsewhere`: one store you didn't pick, when it's clearly ahead of all of yours;
    /// - `unread`: picked stores with no deals listed this week (flyer not read yet).
    struct RankedStore: Identifiable {
        let store: Store
        let rank: RankNumbers
        var id: String { store.id }
    }
    struct StoreWeek {
        var ranked: [RankedStore] = []
        var quiet = false
        var elsewhere: RankedStore?
        var unread: [Store] = []
    }
    var storeWeek: StoreWeek {
        var w = StoreWeek()
        var all: [RankedStore] = []
        for s in feed?.stores ?? [] {
            if let r = rank(s.id), r.deals > 0, live.contains(where: { $0.store == s.id }) { all.append(RankedStore(store: s, rank: r)) }
        }
        all.sort { $0.rank.score > $1.rank.score }
        w.ranked = favoriteStores.isEmpty ? all : all.filter { favoriteStores.contains($0.store.id) }
        w.quiet = w.ranked.first?.rank.quiet ?? false
        if !favoriteStores.isEmpty, let other = all.first(where: { !favoriteStores.contains($0.store.id) }),
           other.rank.standouts >= 5, !other.rank.quiet,
           w.ranked.isEmpty || w.quiet || other.rank.score >= 1.5 * (w.ranked.first?.rank.score ?? 0) {
            w.elsewhere = other
        }
        // Only stores with nothing in the feed at all: one hidden by Vegetarian isn't "unread".
        let listed = Set((feed?.items ?? []).map(\.store))
        w.unread = (feed?.stores ?? []).filter { favoriteStores.contains($0.id) && !listed.contains($0.id) }
        return w
    }
    /// The deals a store card shows: its top deals from the feed, still on sale and after filters.
    func topDeals(_ r: RankNumbers, at id: String) -> [Deal] {
        let top = r.top.compactMap { t in live.first { $0.id == t } }
        return top.isEmpty ? Array(live.filter { $0.store == id }.prefix(3)) : top
    }
    /// True when the store's current flyer started today: "New flyer today".
    func isNewFlyer(_ s: Store) -> Bool { Dates.date(s.from).map(Calendar.current.isDateInToday) ?? false }

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
