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

    private(set) var feed: Feed? { didSet { cache = nil } }
    private(set) var loading = false
    /// The last refresh couldn't reach the site, so we're showing a saved week.
    private(set) var offline = false
    /// Hides deals that end today (and ended ones) everywhere, like Vegetarian. The website's
    /// "Not ending today" filter does the same (app.js, sgd.endsMin).
    var hideEndingToday: Bool {
        didSet {
            cache = nil
            UserDefaults.standard.set(hideEndingToday, forKey: "sgd.hideEndingToday")
            Analytics.track("Toggled Hide Ending Today", ["on": hideEndingToday])
        }
    }
    var vegetarianOnly: Bool {
        didSet {
            cache = nil
            UserDefaults.standard.set(vegetarianOnly, forKey: "sgd.vegOnly")
            Analytics.track("Toggled Vegetarian Only", ["on": vegetarianOnly])
            Analytics.setUser(["veg_only": vegetarianOnly])
        }
    }

    /// The stores someone picked in onboarding or Settings. They come first everywhere; no
    /// store is ever hidden.
    var favoriteStores: Set<String> {
        didSet {
            cache = nil
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
        let d = derived
        return popular.compactMap { p in d.liveByID[p.deal_id].map { ($0, p.people) } }
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
        let stores = derived.byStore.count
        return "\(items.count) deals from \(stores) \(stores == 1 ? "store" : "stores")"
    }

    // MARK: lookups

    /// The lists and lookups every screen asks for, worked out once per change instead of on
    /// every ask. Before this, `items`, `live`, `aisles` and `rankedStores` each went through
    /// all the week's deals again every time a view read them, often inside a loop over stores
    /// or aisles, and every tab did that on every tab switch: about half a second of work each
    /// time with 640 deals (the Nov 12 recording). Built on first use; thrown away when the
    /// feed, a filter or Your stores changes, and at midnight (what has ended depends on today).
    private final class Derived {
        let goodUntil: Date
        /// After the filters, best first, with ended sales after the ones still on.
        let items: [Deal]
        let live: [Deal]
        let standouts: [Deal]
        let liveStandouts: [Deal]
        let byID: [String: Deal]
        let liveByID: [String: Deal]
        let byStore: [String: [Deal]]
        let liveByStore: [String: [Deal]]
        let byCategory: [String: [Deal]]
        /// Every deal in the feed by item key, before the filters (for "Also on sale").
        let byKey: [String: [Deal]]
        /// Stores with anything in the feed at all, before the filters.
        let listed: Set<String>
        let stores: [String: Store]
        let aisles: [Category]
        let rankedStores: [Store]
        /// Filled in the first time This week asks (`storeWeek`).
        var storeWeek: StoreWeek?

        init(feed: Feed?, vegetarianOnly: Bool, hideEndingToday: Bool, favorites: Set<String>) {
            let cal = Calendar.current
            let today = cal.startOfDay(for: .now)
            goodUntil = cal.date(byAdding: .day, value: 1, to: today) ?? today.addingTimeInterval(86_400)

            var live: [Deal] = [], ended: [Deal] = []
            var byKey: [String: [Deal]] = [:]
            var listed = Set<String>()
            for d in feed?.items ?? [] {
                listed.insert(d.store)
                if let key = d.key { byKey[key, default: []].append(d) }
                let left = d.daysLeft
                guard !vegetarianOnly || d.veg, !hideEndingToday || (left ?? 99) >= 2 else { continue }
                if (left ?? 1) <= 0 { ended.append(d) } else { live.append(d) }
            }
            // A sale that has ended stays on store, aisle and search pages until the store's
            // next flyer, but under the ones you can still buy (the website does the same).
            let items = live + ended

            var byID: [String: Deal] = [:], liveByID: [String: Deal] = [:]
            var byStore: [String: [Deal]] = [:], liveByStore: [String: [Deal]] = [:]
            var byCategory: [String: [Deal]] = [:]
            var standoutCount: [String: Int] = [:]
            for d in items {
                if byID[d.id] == nil { byID[d.id] = d }
                byStore[d.store, default: []].append(d)
                byCategory[d.category, default: []].append(d)
                if d.tier == .standout { standoutCount[d.store, default: 0] += 1 }
            }
            for d in live {
                if liveByID[d.id] == nil { liveByID[d.id] = d }
                liveByStore[d.store, default: []].append(d)
            }

            var stores: [String: Store] = [:]
            for s in feed?.stores ?? [] where stores[s.id] == nil { stores[s.id] = s }

            self.items = items
            self.live = live
            standouts = items.filter { $0.tier == .standout }
            liveStandouts = live.filter { $0.tier == .standout }
            self.byID = byID
            self.liveByID = liveByID
            self.byStore = byStore
            self.liveByStore = liveByStore
            self.byCategory = byCategory
            self.byKey = byKey
            self.listed = listed
            self.stores = stores
            aisles = (feed?.categories ?? []).filter { byCategory[$0.id] != nil }
            // Your stores first, then most standouts, then most deals.
            rankedStores = (feed?.stores ?? []).sorted {
                let fa = favorites.contains($0.id), fb = favorites.contains($1.id)
                if fa != fb { return fa }
                let sa = standoutCount[$0.id] ?? 0, sb = standoutCount[$1.id] ?? 0
                return sa != sb ? sa > sb : (byStore[$0.id]?.count ?? 0) > (byStore[$1.id]?.count ?? 0)
            }
        }
    }

    /// Not observed: it's filled in while views are reading, and only ever holds what the
    /// observed properties below it already decide.
    @ObservationIgnored private var cache: Derived?

    private var derived: Derived {
        // Reading these is what gets a view redrawn when one of them changes, cache or no cache.
        let feed = self.feed, veg = vegetarianOnly, hide = hideEndingToday, favorites = favoriteStores
        if let cache, Date.now < cache.goodUntil { return cache }
        let fresh = Derived(feed: feed, vegetarianOnly: veg, hideEndingToday: hide, favorites: favorites)
        cache = fresh
        return fresh
    }

    /// Deals after the vegetarian and "Not ending today" filters, best first, ended sales last.
    var items: [Deal] { derived.items }
    /// Deals still on sale today. This week (the home screen) only shows these: a sale that
    /// ended stays in the feed until its store's next flyer, and stays on store and aisle
    /// pages (marked Ended, under the rest), but it's no use at the top of the app.
    var live: [Deal] { derived.live }
    var standouts: [Deal] { derived.standouts }
    /// Standouts still on sale today.
    var liveStandouts: [Deal] { derived.liveStandouts }
    func store(_ id: String) -> Store? { derived.stores[id] }
    func storeName(_ id: String) -> String { store(id)?.name ?? id }
    func label(forCategory id: String) -> String { feed?.categories.first { $0.id == id }?.label ?? id }
    func deals(inCategory id: String) -> [Deal] { derived.byCategory[id] ?? [] }
    func deals(atStore id: String) -> [Deal] { derived.byStore[id] ?? [] }
    /// A store's deals that are still on sale today.
    func liveDeals(atStore id: String) -> [Deal] { derived.liveByStore[id] ?? [] }
    /// A deal from this week by id, after the filters.
    func deal(_ id: String?) -> Deal? {
        guard let id else { return nil }
        return derived.byID[id]
    }
    /// The same item on sale elsewhere this week (matched by item key).
    func alsoOnSale(_ d: Deal) -> [Deal] {
        guard let key = d.key else { return [] }
        return (derived.byKey[key] ?? []).filter { $0.id != d.id }
    }
    /// The best standouts, at most `perStore` from any one store so no store takes over.
    func topPicks(_ limit: Int = 10, perStore: Int = 2) -> [Deal] {
        var taken: [String: Int] = [:]
        return Array(liveStandouts.filter { d in
            taken[d.store, default: 0] += 1
            return taken[d.store]! <= perStore
        }.prefix(limit))
    }
    /// Your stores first, then most standouts, then most deals.
    var rankedStores: [Store] { derived.rankedStores }
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
        let d = derived
        if let known = d.storeWeek { return known }
        var w = StoreWeek()
        var all: [RankedStore] = []
        for s in feed?.stores ?? [] {
            if let r = rank(s.id), r.deals > 0, d.liveByStore[s.id] != nil { all.append(RankedStore(store: s, rank: r)) }
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
        w.unread = (feed?.stores ?? []).filter { favoriteStores.contains($0.id) && !d.listed.contains($0.id) }
        d.storeWeek = w
        return w
    }
    /// The deals a store card shows: its top deals from the feed, still on sale and after filters.
    func topDeals(_ r: RankNumbers, at id: String) -> [Deal] {
        let d = derived
        let top = r.top.compactMap { d.liveByID[$0] }
        return top.isEmpty ? Array((d.liveByStore[id] ?? []).prefix(3)) : top
    }
    /// True when the store's current flyer started today: "New flyer today".
    func isNewFlyer(_ s: Store) -> Bool { Dates.date(s.from).map(Calendar.current.isDateInToday) ?? false }

    /// Aisles that have deals this week, in the feed's order.
    var aisles: [Category] { derived.aisles }

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
