import Foundation

/// What the widgets need to know about the person's choices: Your stores, the Vegetarian and
/// "Not ending today" switches, and the open items on the list. The app writes it to the App
/// Group whenever any of it changes (RootView and the Siri intents call `Sharing.publish`);
/// the widgets only read it. The deals themselves aren't in here: the widget loads the public
/// feed on its own.
///
/// Without the App Group (a build signed without it) nothing is shared, and the widgets fall
/// back to the week's best deals for everyone and an empty list.
struct SharedState: Codable, Sendable, Equatable {
    struct Line: Codable, Sendable, Identifiable, Equatable {
        var id: String
        var text: String
        /// "$1.28/lb at T&T Supermarket" when the item is on sale this week.
        var sale: String?
        /// The sale's last day, "2026-11-19", so the widget stops saying it once it's over.
        var ends: String?
    }

    var stores: [String] = []
    var vegetarianOnly = false
    var hideEndingToday = false
    var listTitle = "Groceries"
    /// Open items only, in the list's order.
    var list: [Line] = []

    static var groupID: String {
        Bundle.main.object(forInfoDictionaryKey: "DealsAppGroup") as? String ?? "group.deals.seattlegrocery"
    }
    private static let key = "sgd.shared"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: groupID) }

    static func read() -> SharedState {
        guard let data = defaults?.data(forKey: key), let state = try? JSONDecoder().decode(SharedState.self, from: data) else { return SharedState() }
        return state
    }

    /// True when something changed, so the caller knows to reload the widgets.
    @discardableResult
    func write() -> Bool {
        guard Self.read() != self, let data = try? JSONEncoder().encode(self) else { return false }
        Self.defaults?.set(data, forKey: Self.key)
        return true
    }
}

/// Links the widgets and Reminders open: grocerydeals://tab/list, grocerydeals://deal/<id>,
/// grocerydeals://store/<id>, grocerydeals://add (the List tab with the keyboard up).
enum DealsLink {
    static let scheme = "grocerydeals"
    static func tab(_ name: String) -> URL { URL(string: "\(scheme)://tab/\(name)")! }
    static func deal(_ id: String) -> URL { URL(string: "\(scheme)://deal/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")! }
    static func store(_ id: String) -> URL { URL(string: "\(scheme)://store/\(id)")! }
}
