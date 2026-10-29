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
                    if let feed = store.feed { alerts.checkWatches(feed, storeName: store.storeName) }
                }
                // Pick up changes made in Reminders (Siri, a shared list) when coming back.
                .onChange(of: phase) { _, p in if p == .active { list.reload() } }
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
    @State private var onboarding = Welcome.start != nil
    @State private var router = DealsRouter.shared
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Environment(AlertsStore.self) private var alerts

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
        // A tapped "New deals are in": open This week with the latest week.
        .onChange(of: PushStore.shared.opens) {
            tab = .week
            Task { await store.refresh() }
        }
        // Keep "ends tomorrow" notifications in step with the list and the week.
        .task(id: "\(store.feed?.week ?? "")|\(list.openItems.map(\.text).joined(separator: ","))|\(alerts.endingSoon)") {
            let matches = list.openItems.compactMap { item -> (text: String, deal: Deal, store: String)? in
                let d = item.dealID.flatMap { id in store.items.first { $0.id == id } } ?? matchDeal(item.text, in: store.items)
                return d.map { (item.text, $0, store.storeName($0.store)) }
            }
            await alerts.scheduleEndingSoon(matches)
        }
        // This week's deals in Spotlight, refreshed when the week changes.
        .task(id: store.feed?.week ?? "") { DealsSpotlight.update(store) }
        .handlesSpotlight(router)
        .onChange(of: router.searchRequest, initial: true) { if router.searchRequest > 0 { tab = .search } }
        .onChange(of: router.dealID) { _, id in
            guard let id else { return }
            spotlightDeal = store.feed?.items.first { $0.id == id }
            router.dealID = nil
        }
        .sheet(item: $spotlightDeal) { DealDetail(deal: $0, openStore: openStore) }
        // First add anywhere: ask where the list should live, as a half sheet (it was a
        // confirmation dialog that floated mid-screen, see-through over the deals).
        .asksWhereListLives(inDealSheet: false)
        // The floating dev button (not on App Store builds).
        .devMenuButton { DealsDevMenu().environment(store).environment(list).environment(alerts) }
        // First run: welcome, your stores, how it works, then the usage question. Can't be swiped away.
        .fullScreenCover(isPresented: $onboarding) {
            Welcome.view(Welcome.start ?? .question) {
                onboarding = false
                Analytics.screen(tab.rawValue)
            }
            .environment(store)
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

/// The gear at the top right of every tab, opening Settings as a sheet.
private struct SettingsButton: ViewModifier {
    @State private var showing = false
    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Settings", systemImage: "gearshape") { showing = true }
                }
            }
            .sheet(isPresented: $showing) { SettingsView() }
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
