import SwiftUI

@main
struct GroceryDealsApp: App {
    @State private var store = FeedStore()
    @State private var list = ListStore()
    @Environment(\.scenePhase) private var phase

    init() { Analytics.start() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(list)
                .task { await store.refresh() }
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
