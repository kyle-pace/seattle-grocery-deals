import EventKit
import SwiftUI

// MARK: List

struct ListView: View {
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @State private var newItem = ""
    @State private var selected: Deal?
    @State private var choosing = false
    @State private var celebrate = false
    @AppStorage("sgd.list.byStore") private var byStore = false
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(list.usesReminders ? "Synced with Reminders." : "Saved in this app.")
                        .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                    HStack {
                        TextField("Add an item, like bok choy", text: $newItem)
                            .font(.app(.body)).submitLabel(.done).onSubmit(add)
                        Button("Add", action: add).font(.app(.headline)).frame(minHeight: 44)
                            .disabled(newItem.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                .listRowBackground(Palette.surface)

                if list.items.isEmpty {
                    Section {
                        EmptyState(.persimmon, mood: .sleepy, title: Lines.emptyListTitle, message: Lines.emptyListDetail)
                    }
                    .listRowBackground(Color.clear)
                } else if byStore {
                    ForEach(groups, id: \.title) { g in
                        Section {
                            ForEach(g.items) { item in
                                row(item).swipeActions { Button("Remove", role: .destructive) { list.remove(item) } }
                            }
                        } header: {
                            SectionHeader(g.title, trailing: "\(g.items.filter(\.done).count) of \(g.items.count)")
                        }
                        .listRowBackground(Palette.surface)
                    }
                } else {
                    Section {
                        ForEach(list.items) { item in
                            row(item).swipeActions { Button("Remove", role: .destructive) { list.remove(item) } }
                        }
                    }
                    .listRowBackground(Palette.surface)
                }

                Section {
                    Button(list.usesReminders ? "Change Reminders list" : "Use a Reminders list") { pickReminders() }
                    if list.usesReminders {
                        Button("Keep the list in this app instead") { list.useApp(prompt: "list_tab") }
                    }
                }
                .font(.app(.headline))
                .listRowBackground(Palette.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.ground)
            .navigationTitle(list.title)
            .navigationSubtitle(list.items.isEmpty ? "" : "\(list.openItems.count) to get · \(onSale) on sale")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("Group", systemImage: "line.3.horizontal.decrease") {
                        Picker("Group", selection: $byStore) {
                            Label("In the order added", systemImage: "list.bullet").tag(false)
                            Label("By store", systemImage: "storefront").tag(true)
                        }
                    }
                }
            }
            .settingsButton()
            .celebration($celebrate, style: .paper, message: Lines.tripDone(list.items.count))
            .onChange(of: list.openItems.count) { old, now in
                if old > 0 && now == 0 && !list.items.isEmpty { celebrate = true }
            }
            .refreshable { list.reload() }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
            .sheet(isPresented: $choosing) { RemindersPicker(prompt: "list_tab") }
        }
    }

    private var onSale: Int { list.openItems.filter { deal(for: $0) != nil }.count }

    /// The list by store: each item under the store whose deal it matches, the rest under "Anywhere".
    private var groups: [(title: String, items: [ListStore.Item])] {
        var order: [String] = []
        var byTitle: [String: [ListStore.Item]] = [:]
        for item in list.items {
            let title = deal(for: item).map { store.storeName($0.store) } ?? "Anywhere"
            if byTitle[title] == nil { order.append(title) }
            byTitle[title, default: []].append(item)
        }
        order.sort { a, b in a == "Anywhere" ? false : b == "Anywhere" ? true : a < b }
        return order.map { ($0, byTitle[$0]!) }
    }

    private func deal(for item: ListStore.Item) -> Deal? {
        if let id = item.dealID, let d = store.items.first(where: { $0.id == id }) { return d }
        return matchDeal(item.text, in: store.items)
    }

    private func row(_ item: ListStore.Item) -> some View {
        let d = item.done ? nil : deal(for: item)
        return HStack(spacing: Space.m) {
            Button {
                list.toggle(item)
                Announce.say(item.done ? "\(item.text), not done" : "\(item.text), done")
            } label: {
                Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                    .font(.app(.title2)).foregroundStyle(item.done ? Palette.accent : Palette.muted)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.text)
            .accessibilityValue(item.done ? "Done" : "Not done")
            .accessibilityHint(item.done ? "Marks it not done" : "Marks it done")
            AdaptiveStack(spacing: Space.xs) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.text).font(.app(.headline)).strikethrough(item.done).foregroundStyle(item.done ? Palette.muted : Palette.ink)
                    if let d { Text("\(store.storeName(d.store)) · \(d.name)").font(.app(.subheadline)).foregroundStyle(Palette.muted).lineLimitUnlessLarge(1) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let d { PriceTag(deal: d, size: 20, relativeTo: .title3) }
            }
            .contentShape(Rectangle())
            .onTapGesture { if let d { selected = d } }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(d == nil ? [] : .isButton)
            .accessibilityHint(d == nil ? "" : "Opens the deal")
        }
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
                        Circle().fill(Color(cgColor: cal.cgColor)).frame(width: 14, height: 14).accessibilityHidden(true)
                        Text(cal.title).font(.app(.headline)).foregroundStyle(Palette.ink)
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
    @Environment(\.dismiss) private var dismiss
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
                .tint(Palette.accent)

                Section {
                    if alerts.watches.isEmpty {
                        Text("Open any deal and tap \"Watch price\". You'll get an alert when it's cheaper than it is now.")
                            .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                    }
                    ForEach(alerts.watches) { w in
                        let hit = store.feed.flatMap { alerts.hit(w, in: $0.items) }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(w.name).font(.app(.headline))
                            Text("Under \(w.label)" + (hit.map { " · now \($0.text) at \(store.storeName($0.store))" } ?? " · not yet"))
                                .font(.app(.subheadline)).foregroundStyle(hit == nil ? Palette.muted : Palette.text(.good))
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityAction(named: "Stop watching") { alerts.unwatch(w) }
                        .swipeActions { Button("Stop watching", role: .destructive) { alerts.unwatch(w) } }
                    }
                } header: { Text("Price watches") } footer: {
                    Text("Watches are checked when the app loads a new week. Push notifications from a server come later.")
                }

                Section {
                    AppearanceSettings()
                } header: { Text("Display") }
                .tint(Palette.accent)

                Section {
                    Toggle(isOn: $share) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Share anonymous usage data").font(.app(.headline))
                            Text("Which screens and features get used, to improve the app. No name, no IP address, never your list.")
                                .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                        }
                    }
                    .tint(Palette.accent)
                    .onChange(of: share) { _, on in Analytics.isOff = !on }
                } header: { Text("Privacy") }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.ground)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } } }
        }
    }

    private func labeled(_ title: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.app(.headline))
            Text(sub).font(.app(.subheadline)).foregroundStyle(Palette.muted)
        }
    }
}
