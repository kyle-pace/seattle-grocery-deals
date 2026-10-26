import Foundation

/// Deals' voice in one place: a local paper's grocery page. Short headlines, a wink, the odd
/// pun, and always the useful fact. Where there are variants, one is picked per day so the
/// app doesn't repeat itself but also doesn't flicker.
enum Lines {
    static func pick(_ options: [String]) -> String {
        let day = Calendar.current.ordinality(of: .day, in: .era, for: .now) ?? 0
        return options[day % options.count]
    }

    static let loading = ["Reading this week's flyers…", "Inking the prices…", "Rolling the presses…"]
    static let freshTitle = "Fresh off the press"
    static func freshDetail(_ date: String, deals: Int, stores: Int) -> String {
        "The \(date) edition: \(deals) deals from \(stores) stores."
    }
    static let nextTitle = "Next edition lands Friday"
    static let nextDetail = "Fresh flyers usually post by mid-morning."
    static let staleTitle = "New flyers are on their way"
    static let staleDetail = "This week's sales have ended. The next edition posts Friday."
    static func offline(_ date: String) -> String { "You're offline. Showing the \(date) edition." }
    static let noFeedTitle = "Couldn't get this week's deals"
    static let noFeedDetail = "Check your connection and try again."
    static let noResultsTitle = ["Not on sale this week", "Nothing in the paper for that", "Not in this week's flyers"]
    static func noResultsDetail(_ q: String) -> String {
        "Add \u{201C}\(q)\u{201D} to your list and it'll show up there when it goes on sale."
    }
    static let emptyListTitle = "Your list is empty"
    static let emptyListDetail = "Tap + on any deal, or add your own with the + below."
    static func tripDone(_ n: Int) -> String { n == 1 ? "Trip done. 1 for 1." : "Trip done. \(n) for \(n)." }
    static let watchesTitle = "Your price watches"
}
