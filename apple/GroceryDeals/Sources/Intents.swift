import AppIntents
import Foundation

/// "Hey Siri, add to my grocery list in Deals": adds an item and says if it's on sale this week.
struct AddToListIntent: AppIntent {
    static let title: LocalizedStringResource = "Add to Grocery List"
    static let description = IntentDescription("Adds an item to your Deals grocery list and tells you if it's on sale this week.")

    @Parameter(title: "Item", requestValueDialog: "What should I add?")
    var item: String

    static var parameterSummary: some ParameterSummary { Summary("Add \(\.$item) to my grocery list") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = item.trimmingCharacters(in: .whitespacesAndNewlines)
        let feed = FeedStore()
        let list = ListStore()
        // Before the person has chosen in the app, items go to the in-app list.
        list.add(text)
        if let d = matchDeal(text, in: feed.items) {
            return .result(dialog: "Added \(text). It's on sale: \(d.text) at \(feed.storeName(d.store)).")
        }
        return .result(dialog: "Added \(text) to \(list.title).")
    }
}

/// "What's on sale in Deals": the week's top three standouts.
struct BestDealsIntent: AppIntent {
    static let title: LocalizedStringResource = "Best Deals This Week"
    static let description = IntentDescription("Reads the three biggest standouts in this week's flyers.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let feed = FeedStore()
        await feed.refresh()
        let top = feed.standouts.prefix(3).map { "\(shortName($0.name)), \($0.text) at \(feed.storeName($0.store))" }
        guard !top.isEmpty else { return .result(dialog: "I couldn't load this week's deals.") }
        Analytics.track("Asked Siri for Deals")
        return .result(dialog: "This week's best: \(top.joined(separator: "; ")).")
    }
}

struct DealsShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddToListIntent(), phrases: [
            "Add to my grocery list in \(.applicationName)",
            "Add something to my list in \(.applicationName)",
        ], shortTitle: "Add to List", systemImageName: "plus.circle")
        AppShortcut(intent: BestDealsIntent(), phrases: [
            "What's on sale in \(.applicationName)",
            "Best deals in \(.applicationName)",
        ], shortTitle: "Best Deals", systemImageName: "tag")
    }
}
