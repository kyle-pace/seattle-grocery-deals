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
    @State private var share = !Analytics.isOff

    var body: some View {
        NavigationStack {
            Form {
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
                Section {
                    Text("Friday reminders, ending-soon alerts and price watches are coming in a later stage.")
                        .font(.body(15)).foregroundStyle(Theme.muted)
                } header: { Text("Alerts") }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle("Settings")
        }
    }
}
