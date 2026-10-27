import SwiftUI
import UserNotifications

@main
struct GroceryDealsApp: App {
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
                    await store.refresh()
                    if let feed = store.feed { alerts.checkWatches(feed, storeName: store.storeName) }
                }
                // Pick up changes made in Reminders (Siri, a shared list) when coming back.
                .onChange(of: phase) { _, p in if p == .active { list.reload() } }
        }
    }
}

/// Native tabs, so the tab bar is Liquid Glass on iOS 26 and a sidebar on iPad. Search is its
/// own tab (aisles live there before you type); Settings is the gear in each header.
struct RootView: View {
    enum TabID: String, Hashable { case week = "This week", stores = "Stores", list = "List", search = "Search" }
    @State private var tab: TabID = DebugArgs.value("-tab").flatMap(TabID.init(rawValue:)) ?? .week
    @State private var storePath: [Store] = []
    @State private var choosingReminders = false
    @State private var onboarding = Welcome.start != nil
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Environment(AlertsStore.self) private var alerts

    var body: some View {
        @Bindable var list = list
        TabView(selection: $tab) {
            Tab("This week", systemImage: "newspaper", value: .week) { ThisWeekView(openStore: openStore) }
            Tab("Stores", systemImage: "storefront", value: .stores) { StoresView(path: $storePath) }
            Tab("List", systemImage: "checklist", value: .list) { ListView(openStore: openStore) }
                .badge(list.openItems.count)
            Tab(value: .search, role: .search) { SearchView(openStore: openStore) }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .listAccessory(show: tab != .list && !list.items.isEmpty) {
            ListProgressBar(list.title, done: list.items.filter(\.done).count, total: list.items.count) { tab = .list }
        }
        .tint(Palette.accent)
        .onChange(of: tab, initial: true) { _, t in Analytics.screen(t.rawValue) }
        // Keep "ends tomorrow" notifications in step with the list and the week.
        .task(id: "\(store.feed?.week ?? "")|\(list.openItems.map(\.text).joined(separator: ","))|\(alerts.endingSoon)") {
            let matches = list.openItems.compactMap { item -> (text: String, deal: Deal, store: String)? in
                let d = item.dealID.flatMap { id in store.items.first { $0.id == id } } ?? matchDeal(item.text, in: store.items)
                return d.map { (item.text, $0, store.storeName($0.store)) }
            }
            await alerts.scheduleEndingSoon(matches)
        }
        // First add anywhere: ask where the list should live.
        .confirmationDialog("Use your Reminders list?", isPresented: Binding(get: { list.pendingAdd != nil && !choosingReminders }, set: { if !$0 && !choosingReminders { list.pendingAdd = nil } }), titleVisibility: .visible) {
            Button("Use Reminders") {
                choosingReminders = true
                Task {
                    if await list.loadRemindersLists() { } else { choosingReminders = false; list.useApp(prompt: "first_add"); list.finishPendingAdd() }
                }
            }
            Button("Keep in this app") { list.useApp(prompt: "first_add"); list.finishPendingAdd() }
        } message: {
            Text("Items go into a Reminders list you pick, like a shared Groceries list, with the price and when the sale ends.")
        }
        .sheet(isPresented: $choosingReminders, onDismiss: { list.pendingAdd = nil }) { RemindersPicker(prompt: "first_add") }
        // The floating dev button (not on App Store builds).
        .devMenuButton { DealsDevMenu().environment(store).environment(list).environment(alerts) }
        // First run: welcome, tour, then the usage question. Can't be swiped away.
        .fullScreenCover(isPresented: $onboarding) {
            Welcome.view(Welcome.start ?? .question) {
                onboarding = false
                Analytics.screen(tab.rawValue)
            }
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
