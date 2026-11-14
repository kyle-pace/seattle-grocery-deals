import SwiftUI
import UserNotifications

@main
struct GroceryDealsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = FeedStore()
    @State private var list = ListStore()
    @State private var alerts = AlertsStore()
    @Environment(\.scenePhase) private var phase
    private let presenter = NotificationPresenter()

    init() {
        KitchenUI.registerFonts()
        Palette.use(.rain, neutrals: .harbor)    // Deals' "Puget evening": rain blue on harbor neutrals, with the crow
        _ = Welcome.start          // decide before the first feed load saves a week
        Analytics.start()          // does nothing until the usage question gets a yes
        UNUserNotificationCenter.current().delegate = presenter
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .kitchenAppearance()
                .environment(store)
                .environment(list)
                .environment(alerts)
                .task {
                    PushStore.shared.sync(newDeals: alerts.friday)
                    await store.refresh()
                }
                // Pick up changes made in Reminders (Siri, a shared list) when coming back.
                .onChange(of: phase) { _, p in
                    if p == .active {
                        list.reload()
                        MessageStore.shared.refresh()
                        Task { await store.refreshIfStale() }
                    }
                }
        }
    }
}

/// Native tabs, so the tab bar is Liquid Glass on iOS 26 and a sidebar on iPad: This week,
/// Aisles, Stores and List, with Search as its own glass button at the end of the bar. Search
/// also reaches into each aisle and store page, Spotlight and Siri (Search.swift). Settings is
/// the gear in each header.
struct RootView: View {
    enum TabID: String, Hashable { case week = "This week", aisles = "Aisles", stores = "Stores", list = "List", search = "Search" }
    @State private var tab: TabID = DebugArgs.value("-tab").flatMap(TabID.init(rawValue:)) ?? .week
    @State private var storePath: [Store] = []
    @State private var aislePath: [AisleRoute] = []
    @State private var spotlightDeal: Deal?
    @State private var openSeason: Season?
    @State private var onboarding = Welcome.start != nil
    @State private var router = DealsRouter.shared
    @State private var opener = StoreOpener()
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Environment(AlertsStore.self) private var alerts

    /// Changes whenever the deals do: a new week, or a store's new flyer added partway through one.
    private var feedVersion: String {
        guard let f = store.feed else { return "" }
        return "\(f.week)|\(f.updated ?? "")|\(f.items.count)"
    }

    /// Changes whenever something the widgets show does.
    private var sharedVersion: String {
        let lines = list.openItems.map { "\($0.id)\($0.text)" }.joined(separator: ",")
        return "\(feedVersion)|\(store.favoriteStores.sorted().joined(separator: ","))|\(store.vegetarianOnly)|\(store.hideEndingToday)|\(list.title)|\(lines)"
    }

    var body: some View {
        @Bindable var list = list
        // Every tab gets the same closure each time this view is redrawn. A fresh closure
        // looks like a change to SwiftUI, so all five tabs were rebuilt on every tab switch
        // and every list change (this view reads `tab` and the list).
        let open = opener.passing(self.openStore)
        TabView(selection: $tab) {
            Tab("This week", systemImage: "newspaper", value: .week) { ThisWeekView(openStore: open) }
            Tab("Aisles", systemImage: "square.grid.2x2", value: .aisles) { AislesView(path: $aislePath, openStore: open) }
            Tab("Stores", systemImage: "storefront", value: .stores) { StoresView(path: $storePath, openStore: open) }
            Tab("List", systemImage: "checklist", value: .list) { ListView(openStore: open) }
                .badge(list.openItems.count)
            Tab(value: .search, role: .search) { SearchView(router: router, openStore: open) }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        // Picking the Search tab puts the cursor in the field and brings up the keyboard;
        // closing search goes back to the tab you came from.
        .tabViewSearchActivation(.searchTabSelection)
        .listAccessory(show: tab != .list && !list.items.isEmpty) {
            ListProgressBar(list.title, done: list.items.filter(\.done).count, total: list.items.count) { tab = .list }
        }
        .tint(Palette.accent)
        .onChange(of: tab, initial: true) { _, t in
            Analytics.screen(t.rawValue)
            if t == .search, UIDevice.current.userInterfaceIdiom == .pad { router.searchFocusRequest += 1 }
        }
        // A tapped "New deals are in": fetch the latest deals, then open the store when the
        // push was about one store's new flyer, or This week when it was about several.
        // Initial too: a push that launches the app is tapped before this view exists, and a
        // change that happened before it was watching never counted.
        .onChange(of: PushStore.shared.opens, initial: true) {
            guard PushStore.shared.opens > 0 else { return }
            tab = .week
            let stores = PushStore.shared.openedStores
            Task {
                await store.refresh()
                if stores.count == 1 { openStore(stores[0]) }
            }
        }
        // Stores post new flyers on their own days, so the deals change through the week, not
        // just on Fridays. Price watches and Spotlight follow every change, not only a new week.
        .task(id: feedVersion) {
            guard let feed = store.feed else { return }
            alerts.checkWatches(feed, storeName: store.storeName)
            DealsSpotlight.update(store)
        }
        // Keep "ends tomorrow" notifications in step with the list and the deals.
        .task(id: "\(feedVersion)|\(list.openItems.map(\.text).joined(separator: ","))|\(alerts.endingSoon)") {
            let matches = list.openItems.compactMap { item -> (text: String, deal: Deal, store: String)? in
                let d = store.deal(item.dealID) ?? matchDeal(item.text, in: store.items)
                return d.map { (item.text, $0, store.storeName($0.store)) }
            }
            await alerts.scheduleEndingSoon(matches)
        }
        // Widgets, Siri's store names, links and store opens from outside the app.
        .modifier(Outside(sharedVersion: sharedVersion, openPendingStore: { openPendingStore(dropIfMissing: false) }))
        .handlesSpotlight(router)
        .onChange(of: router.searchRequest, initial: true) { if router.searchRequest > 0 { tab = .search } }
        // A deal from Spotlight can be newer than the deals saved on the phone: it waits for the
        // refresh instead of being dropped (it was, when the app opened from Spotlight).
        .onChange(of: router.dealID, initial: true) { openPendingDeal(dropIfMissing: false) }
        .onChange(of: feedVersion) {
            openPendingStore(dropIfMissing: true)
            openPendingDeal(dropIfMissing: true)
            openPendingSeason(dropIfMissing: true)
        }
        .sheet(item: $spotlightDeal) { DealDetail(deal: $0, openStore: openStore) }
        // A season screen, from a This week card, Search or Spotlight (Seasons.swift).
        .onChange(of: router.seasonID, initial: true) { openPendingSeason(dropIfMissing: false) }
        .sheet(item: $openSeason) { SeasonScreen(season: $0, openStore: openStore) }
        // Simulator screenshots: -season <id> opens that season's screen at launch.
        .task(id: store.feed?.week ?? "") { if let id = DebugArgs.value("-season"), openSeason == nil { router.openSeason(id) } }
        .simulatorChecks(store, router)
        // In-app messages (Messages.swift): a link like deals://tab/aisles, and the sheet style.
        .onChange(of: router.tabRequest, initial: true) { _, name in
            guard let name else { return }
            let tabs: [String: TabID] = ["week": .week, "aisles": .aisles, "stores": .stores, "list": .list, "search": .search]
            if let t = tabs[name.lowercased()] { tab = t }
            router.tabRequest = nil
        }
        .inAppMessageSheet(enabled: !onboarding)
        // First add anywhere: ask where the list should live, as a half sheet (it was a
        // confirmation dialog that floated mid-screen, see-through over the deals).
        .asksWhereListLives(inDealSheet: false)
        // The floating dev button (not on App Store builds).
        .devMenuButton { DealsDevMenu().environment(store).environment(list).environment(alerts) }
        // First run: welcome, your stores, alerts, how it works, then the usage question. Can't be swiped away.
        .fullScreenCover(isPresented: $onboarding) {
            Welcome.view(Welcome.start ?? .question) {
                onboarding = false
                Analytics.screen(tab.rawValue)
            }
            .environment(store)
            .environment(alerts)
        }
        .alert("Something went wrong", isPresented: Binding(get: { list.lastError != nil }, set: { if !$0 { list.lastError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(list.lastError ?? "") }
    }

    private func openPendingDeal(dropIfMissing: Bool) {
        guard let id = router.dealID else { return }
        if let deal = store.feed?.items.first(where: { $0.id == id }) {
            spotlightDeal = deal
            router.dealID = nil
        } else if dropIfMissing {
            router.dealID = nil   // ended, or gone from the latest deals
        }
    }

    private func openPendingStore(dropIfMissing: Bool) {
        guard let id = router.storeID else { return }
        if store.store(id) != nil {
            openStore(id)
            router.storeID = nil
        } else if dropIfMissing {
            router.storeID = nil
        }
    }

    private func openPendingSeason(dropIfMissing: Bool) {
        guard let id = router.seasonID else { return }
        if let season = store.season(id) {
            openSeason = season
            router.seasonID = nil
        } else if dropIfMissing {
            router.seasonID = nil
        }
    }

    private func openStore(_ id: String) {
        guard let s = store.store(id) else { return }
        storePath = [s]
        tab = .stores
    }
}

/// What reaches the app from outside it, kept out of RootView's body (one more modifier there
/// and the compiler gives up type-checking it).
private struct Outside: ViewModifier {
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    let sharedVersion: String
    let openPendingStore: () -> Void

    func body(content: Content) -> some View {
        let router = DealsRouter.shared
        content
            // The widgets follow Your stores, the filters and the list (Shared/SharedState.swift).
            .task(id: sharedVersion) { Sharing.publish(store, list) }
            // "What's on sale at Uwajimaya in Deals": Siri learns the store names from the feed.
            .task(id: store.feed?.stores.map(\.id).joined(separator: ",") ?? "") {
                if store.feed != nil { DealsShortcuts.updateAppShortcutParameters() }
            }
            // grocerydeals:// links from the widgets and from a deal's Reminders item.
            .onOpenURL { router.open($0) }
            // A store page, from Siri's Open Store or a link.
            .onChange(of: router.storeID, initial: true) { openPendingStore() }
    }
}

extension View {
    /// Simulator checks (Debug builds): -link grocerydeals://store/uwajimaya opens a link at
    /// launch (simctl's openurl stops at an "Open in Deals?" prompt nothing can tap), and
    /// -trip "eggs, tofu" prints the trip plan for those items once the deals are in.
    @MainActor
    fileprivate func simulatorChecks(_ store: FeedStore, _ router: DealsRouter) -> some View {
        self
            .task { if let link = DebugArgs.value("-link").flatMap(URL.init(string:)) { router.open(link) } }
            .task(id: store.feed?.week ?? "") {
                guard let items = DebugArgs.value("-trip"), store.feed != nil else { return }
                let plan = store.planTrip(splitItems(items))
                var lines = plan.stores.prefix(4).map { s in
                    "TRIP \(s.store.name): \(s.covers) of \(plan.asks.count): " + s.picks.map { "\($0.asked)=\($0.deal.name) \($0.deal.text)" }.joined(separator: "; ")
                }
                let other = plan.elsewhere.map { "\($0.store.name) \($0.covers)" } ?? "none"
                lines.append("TRIP elsewhere: \(other) | nowhere: \(plan.nowhere.joined(separator: ", "))")
                // Standard error, which isn't held back the way print is when it goes to a file.
                FileHandle.standardError.write(Data((lines.joined(separator: "\n") + "\n").utf8))
            }
    }
}

/// Holds one "open this store" closure for the life of the root view, so the tabs are handed
/// the very same closure on every redraw and SwiftUI can tell nothing changed for them. It
/// calls whatever the root view passed in last.
@MainActor
private final class StoreOpener {
    private var latest: (String) -> Void = { _ in }
    private lazy var stable: (String) -> Void = { [unowned self] id in self.latest(id) }

    func passing(_ open: @escaping (String) -> Void) -> (String) -> Void {
        latest = open
        return stable
    }
}

/// The heart and the gear at the top right of every tab. The heart opens Feedback (below) for
/// now; it becomes the place to chip in once tips are set up. The gear opens Settings.
private struct SettingsButton: ViewModifier {
    @State private var showing = false
    @State private var feedback = false
    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Send feedback", systemImage: "heart") {
                        feedback = true
                        Analytics.track("Opened Feedback")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Settings", systemImage: "gearshape") { showing = true }
                }
            }
            .sheet(isPresented: $showing) { SettingsView() }
            .sheet(isPresented: $feedback) { FeedbackSheet() }
    }
}

/// What the heart opens: a note from the person who makes the app and a way to write back, by
/// email to the site's public address with the app version filled in. If there's no mail app,
/// it shows the address to copy instead.
struct FeedbackSheet: View {
    static let address = "hello@seattlegrocery.deals"
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var noMail = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Space.l) {
                    Buddy(.crow, mood: .happy, size: 72).hiddenWhenTextIsLarge()
                        .accessibilityHidden(true)
                    VStack(spacing: Space.s) {
                        Text("Thanks for using Grocery Deals")
                            .font(.app(.title2, .bold)).foregroundStyle(Palette.ink)
                            .accessibilityAddTraits(.isHeader)
                        Text("It's free and made by one person in Seattle. Tell me what's working, what isn't, or which store to add next.")
                            .font(.app(.body)).foregroundStyle(Palette.body)
                    }
                    .multilineTextAlignment(.center)
                    Button { write() } label: {
                        Label("Send feedback", systemImage: "envelope")
                            .font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Palette.accent)
                    if noMail {
                        VStack(spacing: Space.xs) {
                            Text("No mail app is set up here. You can write to")
                                .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                            Text(Self.address).font(.app(.headline)).foregroundStyle(Palette.ink).textSelection(.enabled)
                            Button("Copy address", systemImage: "doc.on.doc") {
                                UIPasteboard.general.string = Self.address
                                Announce.say("Copied")
                            }
                            .font(.app(.subheadline, .semibold))
                            .frame(minHeight: 44)
                        }
                        .multilineTextAlignment(.center)
                    }
                }
                .padding(Space.l)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.ground)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func write() {
        Analytics.track("Started Feedback Email")
        guard let url = FeedbackSheet.mailURL(app: "Grocery Deals", to: Self.address) else { noMail = true; return }
        openURL(url) { opened in if !opened { withAnimation { noMail = true } } }
    }

    /// mailto: with a subject and the version and iOS at the bottom of the body.
    static func mailURL(app: String, to address: String) -> URL? {
        let info = Bundle.main.infoDictionary
        let version = "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
        let os = ProcessInfo.processInfo.operatingSystemVersion
        var c = URLComponents()
        c.scheme = "mailto"
        c.path = address
        c.queryItems = [
            URLQueryItem(name: "subject", value: "\(app) feedback"),
            URLQueryItem(name: "body", value: "\n\n\n\(app) \(version) · iOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"),
        ]
        return c.url
    }
}

/// The shopping-list bar above the tab bar, only while there's a list (iOS 26.1 and later can
/// hide it; 26.0 keeps it whenever the list has items).
private struct ListAccessory<Bar: View>: ViewModifier {
    let show: Bool
    let bar: Bar
    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: show) { bar }
        } else {
            content.tabViewBottomAccessory { bar }
        }
    }
}

extension View {
    func settingsButton() -> some View { modifier(SettingsButton()) }
    fileprivate func listAccessory<Bar: View>(show: Bool, @ViewBuilder _ bar: () -> Bar) -> some View {
        modifier(ListAccessory(show: show, bar: bar()))
    }
}

/// Launch arguments for simulator screenshots: -tab "Search".
enum DebugArgs {
    static func value(_ flag: String) -> String? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: flag), i + 1 < args.count { return args[i + 1] }
        #endif
        return nil
    }
}
