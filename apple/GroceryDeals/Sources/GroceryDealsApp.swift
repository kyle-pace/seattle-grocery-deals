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
        Analytics.start()
        UNUserNotificationCenter.current().delegate = presenter
    }

    var body: some Scene {
        WindowGroup {
            RootView()
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

/// Native tabs, so the tab bar is Liquid Glass on iOS 26 and a sidebar on iPad.
struct RootView: View {
    enum TabID: String, Hashable { case week = "This week", aisles = "Aisles", stores = "Stores", list = "List", settings = "Settings" }
    @State private var tab: TabID = .week
    @State private var storePath: [Store] = []
    @State private var choosingReminders = false
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Environment(AlertsStore.self) private var alerts

    var body: some View {
        @Bindable var list = list
        TabView(selection: $tab) {
            Tab("This week", systemImage: "house", value: .week) { ThisWeekView(openStore: openStore) }
            Tab("Aisles", systemImage: "square.grid.2x2", value: .aisles) { AislesView(openStore: openStore) }
            Tab("Stores", systemImage: "storefront", value: .stores) { StoresView(path: $storePath) }
            Tab("List", systemImage: "checklist", value: .list) { ListView(openStore: openStore) }
                .badge(list.openItems.count)
            Tab("Settings", systemImage: "gearshape", value: .settings) { SettingsView() }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(Theme.brand)
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
