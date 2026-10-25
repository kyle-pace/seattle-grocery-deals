import EventKit
import SwiftUI

// MARK: List

struct ListView: View {
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @State private var newItem = ""
    @State private var selected: Deal?
    @State private var choosing = false
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(list.usesReminders ? "Synced with Reminders. \(onSale) on sale this week." : "Saved in this app. \(onSale) on sale this week.")
                        .font(.body(15)).foregroundStyle(Theme.muted)
                    HStack {
                        TextField("Add an item, like bok choy", text: $newItem)
                            .font(.body(17)).submitLabel(.done).onSubmit(add)
                        Button("Add", action: add).font(.body(17, bold: true)).disabled(newItem.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                .listRowBackground(Theme.surface)

                Section {
                    ForEach(list.items) { item in
                        row(item)
                            .swipeActions { Button("Remove", role: .destructive) { list.remove(item) } }
                    }
                    if list.items.isEmpty {
                        Text("Nothing on your list yet. Tap + on any deal, or add an item above.")
                            .font(.body(16)).foregroundStyle(Theme.muted)
                    }
                }
                .listRowBackground(Theme.surface)

                Section {
                    Button(list.usesReminders ? "Change Reminders list" : "Use a Reminders list") { pickReminders() }
                    if list.usesReminders {
                        Button("Keep the list in this app instead") { list.useApp(prompt: "list_tab") }
                    }
                }
                .font(.body(17, bold: true))
                .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle(list.title)
            .refreshable { list.reload() }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
            .sheet(isPresented: $choosing) { RemindersPicker(prompt: "list_tab") }
        }
    }

    private var onSale: Int { list.openItems.filter { deal(for: $0) != nil }.count }

    private func deal(for item: ListStore.Item) -> Deal? {
        if let id = item.dealID, let d = store.items.first(where: { $0.id == id }) { return d }
        return matchDeal(item.text, in: store.items)
    }

    private func row(_ item: ListStore.Item) -> some View {
        let d = item.done ? nil : deal(for: item)
        return HStack(spacing: 12) {
            Button { list.toggle(item) } label: {
                Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24)).foregroundStyle(item.done ? Theme.brand : Theme.lineUI)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.text).accessibilityValue(item.done ? "Done" : "Not done")
            VStack(alignment: .leading, spacing: 2) {
                Text(item.text).font(.body(17, bold: true)).strikethrough(item.done).foregroundStyle(item.done ? Theme.muted : Theme.ink)
                if let d { Text("\(store.storeName(d.store)) · \(d.name)").font(.body(14)).foregroundStyle(Theme.muted).lineLimit(1) }
            }
            Spacer()
            if let d { PriceTag(deal: d, size: 22) }
        }
        .contentShape(Rectangle())
        .onTapGesture { if let d { selected = d } }
    }

    private func add() {
        let t = newItem.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        list.request(t)
        newItem = ""
    }

    private func pickReminders() {
        Task { if await list.loadRemindersLists() { choosing = true } else { list.lastError = list.lastError ?? "Allow Reminders access in Settings > Deals." } }
    }
}

/// Pick which Reminders list holds the grocery list.
struct RemindersPicker: View {
    @Environment(ListStore.self) private var list
    @Environment(\.dismiss) private var dismiss
    let prompt: String

    var body: some View {
        NavigationStack {
            List(list.remindersLists, id: \.calendarIdentifier) { cal in
                Button {
                    list.use(cal, prompt: prompt)
                    list.finishPendingAdd()
                    dismiss()
                } label: {
                    HStack {
                        Circle().fill(Color(cgColor: cal.cgColor)).frame(width: 14, height: 14)
                        Text(cal.title).font(.body(17, bold: true)).foregroundStyle(Theme.ink)
                    }
                }
            }
            .navigationTitle("Which Reminders list?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { list.pendingAdd = nil; dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: Settings

struct SettingsView: View {
    @Environment(AlertsStore.self) private var alerts
    @Environment(FeedStore.self) private var store
    @State private var share = !Analytics.isOff

    var body: some View {
        @Bindable var alerts = alerts
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: Binding(get: { alerts.friday }, set: { on in Task { let ok = on ? await alerts.allow() : true; if ok { alerts.friday = on } } })) {
                        labeled("Friday reminder", "When new deals post, about 10:30 AM")
                    }
                    Toggle(isOn: Binding(get: { alerts.endingSoon }, set: { on in Task { let ok = on ? await alerts.allow() : true; if ok { alerts.endingSoon = on } } })) {
                        labeled("Ending soon", "The day before a list item's sale ends")
                    }
                } header: { Text("Notify me") }
                .tint(Theme.brand)

                Section {
                    if alerts.watches.isEmpty {
                        Text("Open any deal and tap \"Watch price\". You'll get an alert when it's cheaper than it is now.")
                            .font(.body(15)).foregroundStyle(Theme.muted)
                    }
                    ForEach(alerts.watches) { w in
                        let hit = store.feed.flatMap { alerts.hit(w, in: $0.items) }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(w.name).font(.body(17, bold: true))
                            Text("Under \(w.label)" + (hit.map { " · now \($0.text) at \(store.storeName($0.store))" } ?? " · not yet"))
                                .font(.body(14)).foregroundStyle(hit == nil ? Theme.muted : Theme.brand)
                        }
                        .swipeActions { Button("Stop watching", role: .destructive) { alerts.unwatch(w) } }
                    }
                } header: { Text("Price watches") } footer: {
                    Text("Watches are checked when the app loads a new week. Push notifications from a server come later.")
                }

                Section {
                    Toggle(isOn: $share) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Share anonymous usage data").font(.body(17, bold: true))
                            Text("Which screens and features get used, to improve the app. No name, no IP address, never your list.")
                                .font(.body(14)).foregroundStyle(Theme.muted)
                        }
                    }
                    .tint(Theme.brand)
                    .onChange(of: share) { _, on in Analytics.isOff = !on }
                } header: { Text("Privacy") }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle("Settings")
        }
    }

    private func labeled(_ title: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.body(17, bold: true))
            Text(sub).font(.body(14)).foregroundStyle(Theme.muted)
        }
    }
}
