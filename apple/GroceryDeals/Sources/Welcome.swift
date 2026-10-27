import SwiftUI

/// First-run onboarding (KitchenUI's `Onboarding`): welcome, a four-card tour, then the usage
/// question. Everything but the question can be skipped. Installs that ran 0.1.0 (analytics on
/// by default, before onboarding existed) skip it and stay opted in.
@MainActor
enum Welcome {
    /// Where onboarding starts at this launch, or `nil` when there's nothing to show. Worked out
    /// once, in the App's init, before the first feed load saves a week.
    static let start: Onboarding.Start? = {
        // "Forget the usage answer" in the dev menu: onboarding from the start, once.
        if UserDefaults.standard.bool(forKey: forceKey) {
            UserDefaults.standard.removeObject(forKey: forceKey)
            return .welcome
        }
        guard Analytics.choice == nil else { return nil }
        if DebugArgs.value("-onboarding") == "question" { return .question }
        if FeedStore.hasSavedWeek {
            // Already used 0.1.0, which shared by default: keep that, no onboarding.
            Analytics.setSharing(true)
            return nil
        }
        return .welcome
    }()

    static let forceKey = "sgd.dev.showOnboarding"

    static let pages = [
        TourPage("week", systemImage: "newspaper", title: "The week's best deals",
                 message: "Every Friday, the standout sales at Seattle's specialty grocers, read from each store's own site."),
        TourPage("search", systemImage: "magnifyingglass", title: "Find it fast",
                 message: "Search for anything, or browse by aisle. Each store has a page with all of its deals."),
        TourPage("list", systemImage: "checklist", title: "Build your list",
                 message: "Tap + on any deal. Keep the list here, or in a Reminders list you share, with the price and when the sale ends."),
        TourPage("alerts", systemImage: "bell.badge", title: "Catch the sales you want",
                 message: "Tap Watch price on a deal, or turn on the Friday reminder in Settings. There's a Best This Week widget too."),
    ]

    static let question = UsageQuestion(
        title: "Help make Deals better?",
        message: "With your OK, Deals sends anonymous usage, so it's clear which features get used and what to fix next. It isn't linked to you.",
        shared: [
            "Screens you open and features you use",
            "Which deals you open, add or watch",
            "App version, iPhone model and iOS version",
        ],
        neverShared: [
            "Anything you type, like list items or searches",
            "Your name, email, contacts or location",
            "Your IP address or advertising ID",
        ]
    )

    static func view(_ start: Onboarding.Start, onDone: @escaping () -> Void) -> some View {
        Onboarding(buddy: .persimmon, appName: "Deals",
                   tagline: "This week's best sales at Seattle's specialty grocers.",
                   pages: pages, question: question, start: start) { result in
            if let share = result.shareUsage { Analytics.setSharing(share) }
            // Only reaches Amplitude after a yes.
            Analytics.track(result.shareUsage == nil ? "Replayed Tour" : "Completed Onboarding",
                            ["tour": result.tour.rawValue, "pages_seen": result.pagesSeen, "start": "\(start)"])
            onDone()
        }
    }
}
