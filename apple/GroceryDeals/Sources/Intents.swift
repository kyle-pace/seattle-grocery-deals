import AppIntents
import SwiftUI

// Siri and Shortcuts. Every answer follows Your stores, Vegetarian and "Not ending today", the
// same as the app's screens, and returns the deals as entities (Entities.swift) as well as a
// sentence. The questions mirror the MCP server's tools (mcp/src/deals.js): this week at your
// stores, one store's deals, whether something is on sale, and which one store to go to.
// The Siri AI tool conformances are in SiriTools.swift; its skills in Skills.skillsbundle.

struct DealsShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddToListIntent(), phrases: [
            "Add to my grocery list in \(.applicationName)",
            "Add something to my list in \(.applicationName)",
        ], shortTitle: "Add to List", systemImageName: "plus.circle")
        AppShortcut(intent: BestDealsIntent(), phrases: [
            "What's on sale in \(.applicationName)",
            "Best deals in \(.applicationName)",
            "What's good at my stores in \(.applicationName)",
        ], shortTitle: "This Week", systemImageName: "tag")
        AppShortcut(intent: StoreDealsIntent(), phrases: [
            "What's on sale at \(\.$store) in \(.applicationName)",
            "\(.applicationName) at \(\.$store)",
        ], shortTitle: "Deals at a Store", systemImageName: "storefront")
        AppShortcut(intent: ListOnSaleIntent(), phrases: [
            "What on my list is on sale in \(.applicationName)",
            "Check my list in \(.applicationName)",
        ], shortTitle: "List on Sale", systemImageName: "checklist")
        AppShortcut(intent: PlanTripIntent(), phrases: [
            "Plan my trip in \(.applicationName)",
            "Where should I shop in \(.applicationName)",
            "Which store for my list in \(.applicationName)",
        ], shortTitle: "Plan My Trip", systemImageName: "cart")
        AppShortcut(intent: SearchDealsIntent(), phrases: [
            "Search \(.applicationName)",
            "Find a deal in \(.applicationName)",
        ], shortTitle: "Search Deals", systemImageName: "magnifyingglass")
    }
}

// MARK: the list

/// "Hey Siri, add to my grocery list in Deals": adds items and says which are on sale this week.
struct AddToListIntent: AppIntent {
    static let title: LocalizedStringResource = "Add to Grocery List"
    static let description = IntentDescription(
        "Adds things to buy to the grocery list in Deals, and says which of them are on sale this week and where.",
        searchKeywords: ["groceries", "buy", "need", "shopping list"])

    @Parameter(title: "Items", description: "The things to buy, separated by commas or \u{201C}and,\u{201D} like \u{201C}eggs and tofu.\u{201D}", requestValueDialog: "What should I add?")
    var item: String

    static var parameterSummary: some ParameterSummary { Summary("Add \(\.$item) to my grocery list") }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[DealEntity]> & ProvidesDialog {
        let names = splitItems(item)
        guard !names.isEmpty else { return .result(value: [], dialog: "I didn't catch anything to add.") }
        let feed = SiriData.saved()
        let list = ListStore()
        // Before the person has chosen in the app, items go to the in-app list.
        for name in names { list.add(name) }
        await list.loadNow()
        Sharing.publish(feed, list)

        let onSale = names.compactMap { name in feed.bestDeal(for: name).map { (name: name, deal: $0.deal) } }
        let added = "Added \(Spoken.list(names)) to \(list.title)."
        let entities = onSale.map { DealEntity($0.deal, in: feed) }
        guard let first = onSale.first else { return .result(value: [], dialog: "\(added)") }
        if onSale.count == 1 {
            let lead = names.count == 1 ? "It's" : "\(first.name.capitalizedFirst) is"
            return .result(value: entities, dialog: "\(added) \(lead) on sale: \(first.deal.text) at \(feed.storeName(first.deal.store)).")
        }
        let sales = onSale.prefix(3).map { "\($0.name), \($0.deal.text) at \(feed.storeName($0.deal.store))" }
        return .result(value: entities, dialog: "\(added) On sale this week: \(sales.joined(separator: "; ")).")
    }
}

/// "What on my list is on sale in Deals"
struct ListOnSaleIntent: AppIntent {
    static let title: LocalizedStringResource = "What's on Sale from My List"
    static let description = IntentDescription(
        "Checks the grocery list in Deals against this week's flyers and returns the best deal for each item that's on sale, at the person's stores first.",
        searchKeywords: ["grocery list", "shopping list", "on sale"])

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[DealEntity]> & ProvidesDialog & ShowsSnippetView {
        let feed = await SiriData.feed()
        let list = ListStore()
        await list.loadNow()
        let items = list.openItems
        guard !items.isEmpty else { return .result(value: [], dialog: "Your list is empty.", view: DealsSnippet(title: list.title, rows: [])) }
        let hits = items.compactMap { item -> (text: String, deal: Deal)? in
            let pinned = feed.deal(item.dealID).flatMap { $0.ended ? nil : $0 }
            return (pinned ?? feed.bestDeal(for: item.text)?.deal).map { (item.text, $0) }
        }
        Analytics.track("Asked Siri for List Deals", ["items": items.count, "on_sale": hits.count])
        guard !hits.isEmpty else {
            return .result(value: [], dialog: "Nothing on your list is in this week's flyers.", view: DealsSnippet(title: list.title, rows: []))
        }
        let spoken = hits.prefix(4).map { "\($0.text), \($0.deal.text) at \(feed.storeName($0.deal.store))" }
        let more = hits.count > 4 ? ", and \(hits.count - 4) more" : ""
        return .result(value: hits.map { DealEntity($0.deal, in: feed) },
                       dialog: "\(hits.count) of \(items.count) on your list \(hits.count == 1 ? "is" : "are") on sale: \(spoken.joined(separator: "; "))\(more).",
                       view: DealsSnippet(title: "On sale from \(list.title)", rows: hits.prefix(6).map { .init($0.deal, in: feed, label: $0.text) }))
    }
}

// MARK: the week

/// "What's on sale in Deals": the best of your stores this week and its top deals.
struct BestDealsIntent: AppIntent {
    static let title: LocalizedStringResource = "This Week at My Stores"
    static let description = IntentDescription(
        "Says which of the person's grocery stores has the best deals this week and why, and returns that store's top deals. With no stores picked in the app, it ranks every store.",
        searchKeywords: ["best deals", "on sale", "this week", "flyers"])

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[DealEntity]> & ProvidesDialog & ShowsSnippetView {
        let feed = await SiriData.feed()
        let week = feed.storeWeek
        Analytics.track("Asked Siri for Deals", ["stores_picked": feed.favoriteStores.count])
        guard let top = week.ranked.first else {
            // Nothing at your stores: say so, and name the one store that's worth it if there is one.
            if let other = week.elsewhere {
                let deals = feed.topDeals(other.rank, at: other.store.id)
                return .result(value: deals.map { DealEntity($0, in: feed) },
                               dialog: "Nothing is listed at your stores right now. \(other.store.name) has \(other.rank.standouts) standouts this week.",
                               view: DealsSnippet(title: other.store.name, rows: deals.map { .init($0, in: feed) }))
            }
            return .result(value: [], dialog: feed.feed == nil ? "I couldn't load this week's deals." : "Nothing is listed at your stores right now.",
                           view: DealsSnippet(title: "This week", rows: []))
        }
        let deals = feed.topDeals(top.rank, at: top.store.id)
        let picked = !feed.favoriteStores.isEmpty
        var lead = week.quiet ? "It's a quiet week\(picked ? " at your stores" : ""). The best is \(top.store.name)."
            : picked && week.ranked.count > 1 ? "The best of your stores this week is \(top.store.name)."
            : picked ? "This week at \(top.store.name)." : "The best store this week is \(top.store.name)."
        if !week.quiet, !top.rank.reason.isEmpty { lead += " \(top.rank.reason)" }
        let names = deals.map { "\(shortName($0.name)), \($0.text)" }
        var said = names.isEmpty ? lead : "\(lead) Top deals: \(names.joined(separator: "; "))."
        if let other = week.elsewhere { said += " \(other.store.name) isn't one of yours, but it has \(other.rank.standouts) standouts." }
        return .result(value: deals.map { DealEntity($0, in: feed) }, dialog: "\(said)",
                       view: DealsSnippet(title: top.store.name, note: top.rank.reason, rows: deals.map { .init($0, in: feed) }))
    }
}

/// "What's on sale at Uwajimaya in Deals"
struct StoreDealsIntent: AppIntent {
    static let title: LocalizedStringResource = "Deals at a Store"
    static let description = IntentDescription(
        "Returns one grocery store's best deals this week, standouts first.",
        searchKeywords: ["store", "flyer", "weekly ad", "on sale"])

    @Parameter(title: "Store", description: "The grocery store", requestValueDialog: "Which store?")
    var store: StoreEntity

    @Parameter(title: "How many", description: "How many deals to return, best first", default: 5, inclusiveRange: (1, 20))
    var limit: Int

    static var parameterSummary: some ParameterSummary { Summary("Best deals at \(\.$store)") { \.$limit } }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[DealEntity]> & ProvidesDialog & ShowsSnippetView {
        let feed = await SiriData.feed()
        let all = feed.liveDeals(atStore: store.id)
        let deals = Array(all.prefix(limit))
        let name = feed.storeName(store.id)
        Analytics.track("Asked Siri for Store Deals", ["store": store.id])
        guard !deals.isEmpty else {
            let unread = feed.store(store.id)?.read_by_hand == true ? "Its new flyer hasn't been read yet." : "Its new flyer isn't up yet."
            return .result(value: [], dialog: "Nothing is listed at \(name) right now. \(unread)", view: DealsSnippet(title: name, rows: []))
        }
        let spoken = deals.prefix(3).map { "\(shortName($0.name)), \($0.text)" }
        let reason = feed.rank(store.id)?.reason ?? ""
        return .result(value: deals.map { DealEntity($0, in: feed) },
                       dialog: "\(name) has \(all.count) deals this week. The best: \(spoken.joined(separator: "; ")).",
                       view: DealsSnippet(title: name, note: reason, rows: deals.prefix(6).map { .init($0, in: feed) }))
    }
}

/// "Is salmon on sale?": the best deal for each thing asked about, at your stores first.
struct CheckSaleIntent: AppIntent {
    static let title: LocalizedStringResource = "Check If Items Are on Sale"
    static let description = IntentDescription(
        "Checks whether grocery items are in this week's flyers and returns the best deal for each, at the person's stores first. Not on sale doesn't mean a store doesn't sell it.",
        searchKeywords: ["on sale", "price", "cheapest", "deal"])

    @Parameter(title: "Items", description: "One or more grocery items, separated by commas, like \u{201C}salmon, tofu.\u{201D}", requestValueDialog: "What are you looking for?")
    var items: String

    static var parameterSummary: some ParameterSummary { Summary("Check if \(\.$items) is on sale") }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[DealEntity]> & ProvidesDialog & ShowsSnippetView {
        let feed = await SiriData.feed()
        let names = splitItems(items)
        let hits = names.compactMap { name in feed.bestDeal(for: name).map { (name: name, deal: $0.deal, yours: $0.yours) } }
        let missing = names.filter { name in !hits.contains { $0.name == name } }
        Analytics.track("Asked Siri to Check Sale", ["items": names.count, "on_sale": hits.count])
        guard !hits.isEmpty else {
            return .result(value: [], dialog: "\(Spoken.list(names).capitalizedFirst) \(names.count == 1 ? "isn't" : "aren't") in this week's flyers.",
                           view: DealsSnippet(title: "Not on sale this week", rows: []))
        }
        var parts = hits.prefix(4).map { h in
            "\(h.name.capitalizedFirst): \(h.deal.text) at \(feed.storeName(h.deal.store))\(h.yours ? "" : ", which isn't one of your stores")"
        }
        if !missing.isEmpty { parts.append("Not on sale: \(Spoken.list(missing))") }
        return .result(value: hits.map { DealEntity($0.deal, in: feed) }, dialog: "\(parts.joined(separator: ". ")).",
                       view: DealsSnippet(title: "On sale this week", rows: hits.prefix(6).map { .init($0.deal, in: feed, label: $0.name) }))
    }
}

/// "Plan my trip in Deals": the one store with the most of the list on sale.
struct PlanTripIntent: AppIntent {
    static let title: LocalizedStringResource = "Plan My Grocery Trip"
    static let description = IntentDescription(
        "Finds the one grocery store with the most of a shopping list on sale this week, comparing the person's stores. Uses the grocery list in Deals unless items are given. Items not on sale are usually still sold there at regular price.",
        searchKeywords: ["which store", "where to shop", "trip", "one stop"])

    @Parameter(title: "Items", description: "The things to buy, separated by commas. Leave empty to use the grocery list in Deals.")
    var items: String?

    static var parameterSummary: some ParameterSummary { Summary("Plan my grocery trip") { \.$items } }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[DealEntity]> & ProvidesDialog & ShowsSnippetView {
        let feed = await SiriData.feed()
        var asks = splitItems(items ?? "")
        let fromList = asks.isEmpty
        if fromList {
            let list = ListStore()
            await list.loadNow()
            asks = list.openItems.map(\.text)
        }
        guard !asks.isEmpty else {
            return .result(value: [], dialog: "Your list is empty. Add a few things and I can say which store has the most of them on sale.",
                           view: DealsSnippet(title: "Plan my trip", rows: []))
        }
        let plan = feed.planTrip(asks)
        Analytics.track("Asked Siri to Plan Trip", ["items": plan.asks.count, "covers": plan.best?.covers ?? 0, "from_list": fromList])
        guard let best = plan.best else {
            if let other = plan.elsewhere {
                return .result(value: other.picks.map { DealEntity($0.deal, in: feed) },
                               dialog: "None of that is on sale at your stores this week. \(other.store.name) has \(other.covers) of \(plan.asks.count).",
                               view: DealsSnippet(title: other.store.name, note: "\(other.covers) of \(plan.asks.count) on sale", rows: other.picks.prefix(6).map { .init($0.deal, in: feed, label: $0.asked) }))
            }
            return .result(value: [], dialog: "None of that is in this week's flyers\(plan.pickedStores ? " at your stores" : "").",
                           view: DealsSnippet(title: "Plan my trip", rows: []))
        }
        let spoken = best.picks.prefix(3).map { "\($0.asked), \($0.deal.text)" }
        var said = "\(best.store.name) has \(best.covers) of your \(plan.asks.count) \(plan.asks.count == 1 ? "item" : "items") on sale: \(spoken.joined(separator: "; "))"
        said += best.covers > 3 ? ", and \(best.covers - 3) more." : "."
        if let next = plan.stores.dropFirst().first, next.covers > 0 { said += " Next is \(next.store.name) with \(next.covers)." }
        if let other = plan.elsewhere { said += " \(other.store.name) isn't one of yours, but it has \(other.covers)." }
        return .result(value: best.picks.map { DealEntity($0.deal, in: feed) }, dialog: "\(said)",
                       view: DealsSnippet(title: best.store.name, note: "\(best.covers) of \(plan.asks.count) on sale", rows: best.picks.prefix(6).map { .init($0.deal, in: feed, label: $0.asked) }))
    }
}

// MARK: opening the app

/// "Search Deals for pork belly": opens the app on the Search tab with that search.
struct SearchDealsIntent: AppIntent {
    static let title: LocalizedStringResource = "Search Deals"
    static let description = IntentDescription("Opens Deals and searches this week's deals, stores and aisles.")
    static let openAppWhenRun = true

    @Parameter(title: "Search for", requestValueDialog: "What are you looking for?")
    var query: String

    static var parameterSummary: some ParameterSummary { Summary("Search Deals for \(\.$query)") }

    @MainActor
    func perform() async throws -> some IntentResult {
        DealsRouter.shared.search(query.trimmingCharacters(in: .whitespacesAndNewlines))
        return .result()
    }
}

/// Opens a store's page: its deals by aisle and its weekly ad.
struct OpenStoreIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open Store"
    static let description = IntentDescription("Opens a store's page in Deals, with this week's deals by aisle and its weekly ad.")

    @Parameter(title: "Store") var target: StoreEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        DealsRouter.shared.storeID = target.id
        return .result()
    }
}

/// Opens one deal: the price, how it compares, and the same item at other stores.
struct OpenDealIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open Deal"
    static let description = IntentDescription("Opens a deal in Deals, with how the price compares and the same item at other stores.")

    @Parameter(title: "Deal") var target: DealEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        DealsRouter.shared.dealID = target.id
        return .result()
    }
}

// MARK: saying and showing

enum Spoken {
    /// "eggs", "eggs and tofu", "eggs, tofu and rice"
    static func list(_ items: [String]) -> String {
        switch items.count {
        case 0: return ""
        case 1: return items[0]
        case 2: return "\(items[0]) and \(items[1])"
        default: return "\(items.dropLast().joined(separator: ", ")) and \(items[items.count - 1])"
        }
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// What Siri shows under its answer: a store or a heading, and a few deals with their prices.
struct DealsSnippet: View {
    struct Row: Identifiable {
        let id: String
        let name: String
        let detail: String
        let price: String
        let spoken: String

        /// `label` is what the person asked for ("eggs"), shown over the flyer's name for it.
        @MainActor
        init(_ deal: Deal, in feed: FeedStore, label: String? = nil) {
            id = deal.id + (label ?? "")
            name = label?.capitalizedFirst ?? shortName(deal.name)
            var parts = label == nil ? [] : [shortName(deal.name)]
            parts.append(feed.storeName(deal.store))
            if let ends = deal.endsBadge ?? deal.endsDetail { parts.append(ends) }
            detail = parts.joined(separator: " · ")
            price = deal.text
            spoken = deal.spoken
        }
    }

    let title: String
    var note: String = ""
    let rows: [Row]

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.app(.headline)).foregroundStyle(Palette.ink)
                if !note.isEmpty { Text(note).font(.app(.subheadline)).foregroundStyle(Palette.muted) }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.name).font(.app(.callout, .semibold)).foregroundStyle(Palette.ink)
                        Text(row.detail).font(.app(.footnote)).foregroundStyle(Palette.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.price).font(.app(.callout, .bold)).foregroundStyle(Palette.ink).monospacedDigit()
                        .fixedSize(horizontal: true, vertical: false)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(row.name), \(row.detail), \(row.spoken)")
            }
        }
        .padding(Space.l)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
