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
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Environment(AlertsStore.self) private var alerts

    /// Changes whenever the deals do: a new week, or a store's new flyer added partway through one.
    private var feedVersion: String {
        guard let f = store.feed else { return "" }
        return "\(f.week)|\(f.updated ?? "")|\(f.items.count)"
    }

    var body: some View {
        @Bindable var list = list
        TabView(selection: $tab) {
            Tab("This week", systemImage: "newspaper", value: .week) { ThisWeekView(openStore: openStore) }
            Tab("Aisles", systemImage: "square.grid.2x2", value: .aisles) { AislesView(path: $aislePath, openStore: openStore) }
            Tab("Stores", systemImage: "storefront", value: .stores) { StoresView(path: $storePath, openStore: openStore) }
            Tab("List", systemImage: "checklist", value: .list) { ListView(openStore: openStore) }
                .badge(list.openItems.count)
            Tab(value: .search, role: .search) { SearchView(router: router, openStore: openStore) }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .listAccessory(show: tab != .list && !list.items.isEmpty) {
            ListProgressBar(list.title, done: list.items.filter(\.done).count, total: list.items.count) { tab = .list }
        }
        .tint(Palette.accent)
        .onChange(of: tab, initial: true) { _, t in Analytics.screen(t.rawValue) }
        // A tapped "New deals are in": fetch the latest deals, then open the store when the
        // push was about one store's new flyer, or This week when it was about several.
        .onChange(of: PushStore.shared.opens) {
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
                let d = item.dealID.flatMap { id in store.items.first { $0.id == id } } ?? matchDeal(item.text, in: store.items)
                return d.map { (item.text, $0, store.storeName($0.store)) }
            }
            await alerts.scheduleEndingSoon(matches)
        }
        .handlesSpotlight(router)
        .onChange(of: router.searchRequest, initial: true) { if router.searchRequest > 0 { tab = .search } }
        .onChange(of: router.dealID) { _, id in
            guard let id else { return }
            spotlightDeal = store.feed?.items.first { $0.id == id }
            router.dealID = nil
        }
        .sheet(item: $spotlightDeal) { DealDetail(deal: $0, openStore: openStore) }
        // A season screen, from a This week card, Search or Spotlight (Seasons.swift).
        .onChange(of: router.seasonID) { _, id in
            guard let id else { return }
            openSeason = store.season(id)
            router.seasonID = nil
        }
        .sheet(item: $openSeason) { SeasonScreen(season: $0, openStore: openStore) }
        // Simulator screenshots: -season <id> opens that season's screen at launch.
        .task(id: store.feed?.week ?? "") { if let id = DebugArgs.value("-season"), openSeason == nil { router.openSeason(id) } }
        // In-app messages (Messages.swift): a link like deals://tab/aisles, and the sheet style.
        .onChange(of: router.tabRequest) { _, name in
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

    private func openStore(_ id: String) {
        guard let s = store.store(id) else { return }
        storePath = [s]
        tab = .stores
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
