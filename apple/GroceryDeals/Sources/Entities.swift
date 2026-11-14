import AppIntents
import CoreSpotlight
import Foundation

// Deals and stores as things Siri, Shortcuts and Spotlight can hold on to: each has typed
// properties (price, store, when it ends), so an answer is data and not only a sentence.
// Everything here is the public weekly feed; nothing personal.

/// The week as Siri sees it: the copy saved on the phone, refreshed from the site when that's
/// quick. Each call makes its own FeedStore, so it reads the current Your stores, Vegetarian
/// and "Not ending today" settings.
@MainActor
enum SiriData {
    /// For answers: the saved week at once, replaced by the live one if the site answers
    /// within a few seconds. With nothing recent saved it waits for the site.
    static func feed() async -> FeedStore {
        let store = FeedStore()
        if store.feed == nil {
            await store.refresh()
        } else {
            let refresh = Task { await store.refresh() }
            Task { try? await Task.sleep(for: .seconds(3)); refresh.cancel() }
            await refresh.value
        }
        return store
    }

    /// For looking up entities by id or name: no waiting on the network.
    static func saved() -> FeedStore {
        let store = FeedStore()
        store.useSavedWeek()
        return store
    }
}

enum DealRating: String, AppEnum {
    case standout, good, sale

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Deal Rating" }
    static var caseDisplayRepresentations: [DealRating: DisplayRepresentation] {
        [.standout: "Standout", .good: "Good deal", .sale: "On sale"]
    }
    init(_ tier: Deal.Tier) {
        switch tier {
        case .standout: self = .standout
        case .good: self = .good
        case .sale: self = .sale
        }
    }
}

/// One deal from this week's flyers.
struct DealEntity: IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Deal" }
    static var defaultQuery: DealQuery { DealQuery() }

    let id: String
    let storeID: String

    @Property(title: "Item") var name: String
    /// As the flyer printed it: "$1.28/lb", "2 for $5".
    @Property(title: "Price") var price: String
    @Property(title: "Store") var store: String
    @Property(title: "Aisle") var aisle: String
    @Property(title: "Rating") var rating: DealRating
    @Property(title: "Sale Ends") var ends: Date?
    @Property(title: "Vegetarian") var vegetarian: Bool
    @Property(title: "Why It's Good") var why: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(price) · \(store)")
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let set = CSSearchableItemAttributeSet(contentType: .content)
        set.title = "\(name) \(price)"
        set.contentDescription = store
        set.keywords = [name, store, aisle]
        return set
    }

    @MainActor
    init(_ deal: Deal, in feed: FeedStore) {
        id = deal.id
        storeID = deal.store
        name = shortName(deal.name)
        price = deal.text
        store = feed.storeName(deal.store)
        aisle = feed.label(forCategory: deal.category)
        rating = DealRating(deal.tier)
        ends = Dates.date(deal.ends)
        vegetarian = deal.veg
        why = deal.why
    }
}

struct DealQuery: EntityStringQuery {
    @MainActor
    func entities(for identifiers: [String]) async throws -> [DealEntity] {
        let feed = SiriData.saved()
        return identifiers.compactMap { feed.deal($0) }.map { DealEntity($0, in: feed) }
    }

    /// Sales still on, best first.
    @MainActor
    func entities(matching string: String) async throws -> [DealEntity] {
        let feed = SiriData.saved()
        return feed.search(string).filter { !$0.ended }.prefix(25).map { DealEntity($0, in: feed) }
    }

    @MainActor
    func suggestedEntities() async throws -> [DealEntity] {
        let feed = SiriData.saved()
        return feed.topPicks(12).map { DealEntity($0, in: feed) }
    }
}

/// A store the app covers, with how its week looks.
struct StoreEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Store" }
    static var defaultQuery: StoreQuery { StoreQuery() }

    let id: String

    @Property(title: "Name") var name: String
    @Property(title: "Where") var towns: String
    @Property(title: "One of Your Stores") var yours: Bool
    @Property(title: "Deals This Week") var deals: Int
    @Property(title: "Standouts This Week") var standouts: Int
    /// "A good week for produce, seafood and pantry staples."
    @Property(title: "This Week") var summary: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(towns)")
    }

    @MainActor
    init(_ s: Store, in feed: FeedStore) {
        id = s.id
        name = s.name
        towns = s.towns
        yours = feed.isFavorite(s.id)
        let rank = feed.rank(s.id)
        deals = feed.liveDeals(atStore: s.id).count
        standouts = rank?.standouts ?? 0
        summary = rank?.reason ?? ""
    }
}

struct StoreQuery: EntityStringQuery {
    @MainActor
    func entities(for identifiers: [String]) async throws -> [StoreEntity] {
        let feed = SiriData.saved()
        return identifiers.compactMap { feed.store($0) }.map { StoreEntity($0, in: feed) }
    }

    /// By name or town, loosely: "ranch 99" finds 99 Ranch Market.
    @MainActor
    func entities(matching string: String) async throws -> [StoreEntity] {
        let feed = SiriData.saved()
        let ask = dealWords(string)
        guard !ask.isEmpty else { return [] }
        return feed.rankedStores.filter { s in
            let words = dealWords("\(s.name) \(s.id) \(s.towns)")
            return ask.allSatisfy { w in words.contains { $0.hasPrefix(w) } }
        }
        .map { StoreEntity($0, in: feed) }
    }

    /// Your stores first.
    @MainActor
    func suggestedEntities() async throws -> [StoreEntity] {
        let feed = SiriData.saved()
        return feed.rankedStores.map { StoreEntity($0, in: feed) }
    }
}
