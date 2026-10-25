import Foundation
import Observation

/// Loads this week's deals: the live feed first, then the last saved copy, then the copy
/// bundled with the app, so it always has something to show.
@MainActor @Observable
final class FeedStore {
    static let feedURL = URL(string: "https://seattlegrocery.deals/api/week.json")!

    private(set) var feed: Feed?
    private(set) var loading = false
    var vegetarianOnly: Bool {
        didSet { UserDefaults.standard.set(vegetarianOnly, forKey: "sgd.vegOnly") }
    }

    init() {
        vegetarianOnly = UserDefaults.standard.bool(forKey: "sgd.vegOnly")
        feed = Self.cached() ?? Self.bundled()
    }

    func refresh() async {
        loading = true
        defer { loading = false }
        do {
            let (data, response) = try await URLSession.shared.data(from: Self.feedURL)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            let fresh = try JSONDecoder().decode(Feed.self, from: data)
            if feed == nil || fresh.week >= feed!.week {
                feed = fresh
                try? data.write(to: Self.cacheURL, options: .atomic)
            }
        } catch {
            // Offline or the feed changed shape: keep what we have.
        }
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
    func search(_ query: String) -> [Deal] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return items.filter { $0.name.lowercased().contains(q) || storeName($0.store).lowercased().contains(q) }
    }

    // MARK: storage

    private static var cacheURL: URL {
        URL.applicationSupportDirectory.appending(path: "week.json")
    }
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
