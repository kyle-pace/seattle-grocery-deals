import Foundation
import WidgetKit

// Plan my trip: which one store has the most of a list on sale this week. The same rules as the
// MCP server's `plan_trip` (mcp/src/deals.js, planTrip), so Siri, the app and an AI assistant
// give the same answer: only your stores are compared when you've picked some, one store you
// didn't pick is named when it covers more, and prices are passed through as printed.

/// "Chicken Thighs" -> ["chicken", "thigh"]: lowercase, no accents or punctuation, and a light
/// trim of plurals so "tomatoes" finds "tomato" (deals.js, words()).
func dealWords(_ text: String) -> [String] {
    text.lowercased()
        .folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US"))
        .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
        .split(separator: " ")
        .map { w -> String in
            if w.count > 4, w.hasSuffix("ies") { return String(w.dropLast(3)) + "y" }
            if w.count > 4, w.hasSuffix("oes") { return String(w.dropLast(2)) }
            if w.count > 3, w.hasSuffix("s"), !w.hasSuffix("ss"), !w.hasSuffix("us") { return String(w.dropLast()) }
            return String(w)
        }
}

/// "eggs, oat milk and tofu" -> ["eggs", "oat milk", "tofu"]
func splitItems(_ text: String) -> [String] {
    text.replacingOccurrences(of: #"\s+(and|&)\s+"#, with: ",", options: [.regularExpression, .caseInsensitive])
        .split(whereSeparator: { ",;\n".contains($0) })
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
}

struct TripPlan: Sendable {
    struct Pick: Sendable, Identifiable {
        let asked: String
        let deal: Deal
        var id: String { asked }
    }
    struct StorePlan: Sendable, Identifiable {
        let store: Store
        let picks: [Pick]
        /// Asked for, but not in this store's flyer. It likely still sells them at regular price.
        let missing: [String]
        var id: String { store.id }
        var covers: Int { picks.count }
        fileprivate var quality: Int { picks.reduce(0) { $0 + ($1.deal.tier == .standout ? 2 : $1.deal.tier == .good ? 1 : 0) } }
    }

    let asks: [String]
    /// Your stores (or every store with something, when none are picked), best first.
    let stores: [StorePlan]
    /// One store you didn't pick that has more of the list on sale than your best.
    let elsewhere: StorePlan?
    /// Not on sale at any store this week.
    let nowhere: [String]
    let pickedStores: Bool

    /// The store to go to, or nil when nothing on the list is on sale at the stores compared.
    var best: StorePlan? { stores.first.flatMap { $0.covers > 0 ? $0 : nil } }
}

extension FeedStore {
    /// Whether a deal is the thing asked for, by the server's plan_trip matching: every word
    /// of the ask has to be in the deal's name or item key, and a word of four letters or more
    /// can be the start of a name word ("persim" finds persimmons). The aisle and the store
    /// don't count: a list's "eggs" means eggs, not everything in Dairy & eggs.
    private func matcher(for deal: Deal) -> ([String]) -> Bool {
        Self.has(dealWords("\(deal.name) \(deal.key ?? "")"))
    }

    /// The same test against the main name only (up to the first comma or bracket). A deal that
    /// passes it ("Baby Bok Choy") beats one that only mentions the item further along
    /// ("Wontons, Pork / Spinach / Bok Choy"), even when the mention ranks higher.
    private func mainMatcher(for deal: Deal) -> ([String]) -> Bool {
        Self.has(dealWords(String(deal.name.split(whereSeparator: { $0 == "," || $0 == "(" }).first ?? "")))
    }

    private static func has(_ words: [String]) -> ([String]) -> Bool {
        let all = Set(words)
        return { ask in ask.allSatisfy { w in all.contains(w) || (w.count >= 4 && words.contains { $0.hasPrefix(w) }) } }
    }

    /// Which one store has the most of `items` on sale. Follows Vegetarian and "Not ending
    /// today" like every other screen (it reads `live`).
    func planTrip(_ items: [String]) -> TripPlan {
        // The same thing asked twice ("eggs", "Eggs") counts once.
        var seen = Set<String>()
        let asks = items.map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !dealWords($0).isEmpty && seen.insert($0.lowercased()).inserted }
            .map { (text: $0, words: dealWords($0)) }

        var byStore: [String: [String: Deal]] = [:]
        var mainHit = Set<String>()
        for deal in live.sorted(by: { $0.rank < $1.rank }) {
            let has = matcher(for: deal), main = mainMatcher(for: deal)
            for a in asks where has(a.words) {
                let key = "\(deal.store)|\(a.text)", isMain = main(a.words)
                if byStore[deal.store]?[a.text] == nil || (isMain && !mainHit.contains(key)) {
                    byStore[deal.store, default: [:]][a.text] = deal
                }
                if isMain { mainHit.insert(key) }
            }
        }

        func plan(_ s: Store) -> TripPlan.StorePlan {
            let got = byStore[s.id] ?? [:]
            return TripPlan.StorePlan(store: s,
                                      picks: asks.compactMap { a in got[a.text].map { TripPlan.Pick(asked: a.text, deal: $0) } },
                                      missing: asks.filter { got[$0.text] == nil }.map(\.text))
        }
        let all = (feed?.stores ?? []).map(plan).sorted {
            if $0.covers != $1.covers { return $0.covers > $1.covers }
            if $0.quality != $1.quality { return $0.quality > $1.quality }
            return (rank($0.store.id)?.score ?? 0) > (rank($1.store.id)?.score ?? 0)
        }
        let picked = !favoriteStores.isEmpty
        let compared = picked ? all.filter { favoriteStores.contains($0.store.id) } : all.filter { $0.covers > 0 }
        var elsewhere: TripPlan.StorePlan?
        if picked, let other = all.first(where: { !favoriteStores.contains($0.store.id) }), other.covers > (compared.first?.covers ?? 0) {
            elsewhere = other
        }
        let nowhere = asks.filter { a in !all.contains { $0.picks.contains { $0.asked == a.text } } }.map(\.text)
        return TripPlan(asks: asks.map(\.text), stores: compared, elsewhere: elsewhere, nowhere: nowhere, pickedStores: picked)
    }

    /// The best deal for one thing ("chicken thighs"): at your stores first, then anywhere.
    /// `yours` says which it was.
    func bestDeal(for item: String) -> (deal: Deal, yours: Bool)? {
        let ask = dealWords(item)
        guard !ask.isEmpty else { return nil }
        let hits = live.sorted { $0.rank < $1.rank }.filter { matcher(for: $0)(ask) }
        // The item itself before a product that mentions it; your stores before the rest.
        let main = hits.filter { mainMatcher(for: $0)(ask) }
        for pool in [main, hits] {
            if let mine = pool.first(where: { favoriteStores.contains($0.store) }) { return (mine, true) }
        }
        return (main.first ?? hits.first).map { ($0, favoriteStores.isEmpty) }
    }
}

// MARK: sharing with the widgets

/// Writes what the widgets need (Shared/SharedState.swift) and reloads them when it changed.
@MainActor
enum Sharing {
    static func publish(_ feed: FeedStore, _ list: ListStore) {
        let lines = list.openItems.prefix(30).map { item -> SharedState.Line in
            let deal = feed.deal(item.dealID).flatMap { $0.ended ? nil : $0 } ?? matchDeal(item.text, in: feed.live)
            return SharedState.Line(id: item.id, text: item.text,
                                    sale: deal.map { "\($0.text) at \(feed.storeName($0.store))" }, ends: deal?.ends)
        }
        let state = SharedState(stores: feed.favoriteStores.sorted(), vegetarianOnly: feed.vegetarianOnly,
                                hideEndingToday: feed.hideEndingToday, listTitle: list.title, list: Array(lines))
        if state.write() { WidgetCenter.shared.reloadAllTimelines() }
    }
}
