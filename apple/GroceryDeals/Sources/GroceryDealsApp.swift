import SwiftUI

@main
struct GroceryDealsApp: App {
    @State private var store = FeedStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .task { await store.refresh() }
        }
    }
}

/// Native tabs, so the tab bar is Liquid Glass on iOS 26 and a sidebar on iPad.
struct RootView: View {
    enum TabID: Hashable { case week, aisles, stores, list, alerts }
    @State private var tab: TabID = .week
    @State private var storePath: [Store] = []
    @Environment(FeedStore.self) private var store

    var body: some View {
        TabView(selection: $tab) {
            Tab("This week", systemImage: "house", value: .week) { ThisWeekView(openStore: openStore) }
            Tab("Aisles", systemImage: "square.grid.2x2", value: .aisles) { AislesView(openStore: openStore) }
            Tab("Stores", systemImage: "storefront", value: .stores) { StoresView(path: $storePath) }
            Tab("List", systemImage: "checklist", value: .list) {
                ComingSoon(title: "List", text: "Your grocery list, kept in the app or in Reminders, with this week's best price for each item. Coming in the next stage.")
            }
            Tab("Alerts", systemImage: "bell", value: .alerts) {
                ComingSoon(title: "Alerts", text: "Friday reminders, ending-soon alerts and price watches. Coming in the next stage.")
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(Theme.brand)
    }

    private func openStore(_ id: String) {
        guard let s = store.store(id) else { return }
        storePath = [s]
        tab = .stores
    }
}
