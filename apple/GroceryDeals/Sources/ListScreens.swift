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
    @FocusState private var typing: Bool
    @AppStorage("sgd.list.byStore") private var byStore = false
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            List {
                if MessageStore.shared.card(for: "list") != nil {
                    MessageCard(place: "list")
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 8, trailing: 0))
                        .listRowBackground(Color.clear)
                }
                ForEach(duplicates, id: \.key) { d in
                    Section {
                        VStack(alignment: .leading, spacing: Space.s) {
                            Text("\(d.title) is on here \(d.items.count) times")
                                .font(.app(.headline)).foregroundStyle(Palette.ink)
                            Text(d.items.map(\.text).joined(separator: ", "))
                                .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                            Button("Keep the cheapest") { keepCheapest(d.items) }
                                .font(.app(.headline)).buttonStyle(.glass).frame(minHeight: 44)
                        }
                        .padding(.vertical, Space.xs)
                    }
                    .listRowBackground(Palette.surface)
                }

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

            }
            .scrollContentBackground(.hidden)
            .background(Palette.ground)
            .navigationTitle(list.title)
            .navigationSubtitle(([list.usesReminders ? "Synced with Reminders" : "In this app"]
                + (list.items.isEmpty ? [] : ["\(list.openItems.count) to get", "\(onSale) on sale"])).joined(separator: " · "))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // Grouping and where the list lives, in one menu (they were a row at the top
                    // and a row at the bottom of the list).
                    Menu("List options", systemImage: "line.3.horizontal.decrease") {
                        Picker("Group", selection: $byStore) {
                            Label("In the order added", systemImage: "list.bullet").tag(false)
                            Label("By store", systemImage: "storefront").tag(true)
                        }
                        Section("Where it lives") {
                            Button(list.usesReminders ? "Change Reminders list" : "Use a Reminders list", systemImage: "checklist") { pickReminders() }
                            if list.usesReminders {
                                Button("Keep it in this app instead", systemImage: "iphone") { list.useApp(prompt: "list_tab") }
                            }
                        }
                    }
                }
            }
            .safeAreaBar(edge: .bottom, spacing: 0) { addBar }
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

    /// An "Add an item" field that's always there at the bottom, like Reminders' New Reminder,
    /// instead of a floating + over the glass tab bar. Stays focused so several go on in a row.
    private var addBar: some View {
        HStack(spacing: Space.s) {
            Image(systemName: "plus.circle.fill").font(.app(.title3)).foregroundStyle(Palette.accent)
                .accessibilityHidden(true)
            TextField("Add an item, like bok choy", text: $newItem)
                .font(.app(.body)).submitLabel(.done).onSubmit(add)
                .focused($typing)
            if !newItem.trimmingCharacters(in: .whitespaces).isEmpty {
                Button("Add", action: add)
                    .font(.app(.headline)).buttonStyle(.glassProminent)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.leading, Space.m).padding(.trailing, Space.xs)
        .frame(minHeight: 50)
        .glassEffect(.regular.interactive(), in: .capsule)
        .padding(.horizontal, Space.l)
        .padding(.bottom, Space.s)
        .animation(.snappy, value: newItem.isEmpty)
        .sensoryFeedback(.increase, trigger: list.items.count)
    }

    /// Open items that are the same thing (same item key) from different stores' deals.
    private var duplicates: [(key: String, title: String, items: [ListStore.Item])] {
        var order: [String] = []
        var byKey: [String: [ListStore.Item]] = [:]
        for item in list.openItems {
            guard let id = item.dealID, let key = store.items.first(where: { $0.id == id })?.key else { continue }
            if byKey[key] == nil { order.append(key) }
            byKey[key, default: []].append(item)
        }
        return order.compactMap { key in
            guard let items = byKey[key], items.count > 1 else { return nil }
            let title = key.replacingOccurrences(of: "-", with: " ")
            return (key, title.prefix(1).uppercased() + title.dropFirst(), items)
        }
    }

    /// Keeps the line whose deal is cheapest (by unit price when there is one) and removes the rest.
    private func keepCheapest(_ items: [ListStore.Item]) {
        func cost(_ item: ListStore.Item) -> Double {
            guard let d = deal(for: item) else { return .infinity }
            if let u = d.unit_price, let r = u.range(of: #"\d+(\.\d+)?"#, options: .regularExpression), let v = Double(u[r]) { return v }
            return d.price
        }
        guard let keep = items.min(by: { cost($0) < cost($1) }) else { return }
        withAnimation { for item in items where item.id != keep.id { list.remove(item) } }
        Announce.say("Kept \(keep.text)")
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
        typing = true
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
    @State private var share = Analytics.isOn
    @State private var replayingTour = false

    var body: some View {
        @Bindable var alerts = alerts
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: Binding(get: { alerts.friday }, set: { on in Task { let ok = on ? await alerts.allow() : true; if ok { alerts.friday = on } } })) {
                        if PushStore.shared.available {
                            labeled("New deals are in", "As soon as the new week posts, usually Friday morning")
                        } else {
                            labeled("Friday reminder", "When new deals post, about 10:30 AM")
                        }
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
                    Text("Watches are checked on your phone when the app loads a new week, so your prices stay with you.")
                }

                Section {
                    NavigationLink {
                        YourStoresPicker()
                    } label: {
                        LabeledContent("Your stores", value: store.favoriteStores.isEmpty ? "None yet" : "\(store.favoriteStores.count)")
                            .font(.app(.headline))
                    }
                } header: { Text("Shopping") } footer: {
                    Text("Your stores come first on This week, Aisles and Stores. Every store still shows.")
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
                    .onChange(of: share) { _, on in Analytics.setSharing(on) }
                } header: { Text("Privacy") }

                Section {
                    Button("Show the tour again", systemImage: "sparkles.rectangle.stack") { replayingTour = true }
                }

                DevMenuSection { DealsDevMenu() }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.ground)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } } }
            .fullScreenCover(isPresented: $replayingTour) { Welcome.view(.tourOnly) { replayingTour = false } }
        }
    }

    private func labeled(_ title: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.app(.headline))
            Text(sub).font(.app(.subheadline)).foregroundStyle(Palette.muted)
        }
    }
}

// MARK: Where the list lives

extension View {
    /// On the first add, asks where the list should live. Attached at the root and inside the
    /// deal sheet; whichever is on top asks (a sheet can't open from under another sheet).
    func asksWhereListLives(inDealSheet: Bool) -> some View { modifier(ListHomeAsker(inDealSheet: inDealSheet)) }
}

private struct ListHomeAsker: ViewModifier {
    let inDealSheet: Bool
    @Environment(ListStore.self) private var list
    @State private var asking = false

    func body(content: Content) -> some View {
        content
            .onChange(of: list.pendingAdd != nil) { _, pending in
                let onTop = inDealSheet == (DealsRouter.shared.openDealSheets > 0)
                if pending && onTop { asking = true }
            }
            .sheet(isPresented: $asking, onDismiss: {
                // Swiped away without choosing: keep it simple and keep the list here.
                if list.pendingAdd != nil { list.useApp(prompt: "first_add_dismissed"); list.finishPendingAdd() }
            }) {
                ListHomePrimer()
            }
    }
}

/// "Where should your list live?" Two equal choices, then (for Reminders) the list picker in
/// the same sheet, instead of a second sheet stacked on the first.
struct ListHomePrimer: View {
    @Environment(ListStore.self) private var list
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var loading = false

    var body: some View {
        if picking {
            RemindersPicker(prompt: "first_add")
        } else {
            ScrollView {
                VStack(spacing: Space.l) {
                    Buddy(.persimmon, mood: .happy, size: 64).hiddenWhenTextIsLarge()
                    Text("Where should your list live?")
                        .font(.app(.title2, .bold)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                    if let item = list.pendingAdd {
                        Text("Adding \u{201C}\(item.text)\u{201D}. Pick once; change it anytime from the List tab.")
                            .font(.app(.subheadline)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                    }
                    VStack(spacing: Space.s) {
                        option("A Reminders list", detail: "Share it with your household, add with Siri. The price and sale end go in the notes.",
                               systemImage: "checklist", busy: loading) {
                            loading = true
                            Task {
                                if await list.loadRemindersLists() {
                                    withAnimation(.snappy) { picking = true }
                                } else {
                                    list.useApp(prompt: "first_add")
                                    list.finishPendingAdd()
                                    dismiss()
                                }
                                loading = false
                            }
                        }
                        option("Here in Deals", detail: "Simple and private. Nothing leaves your iPhone.", systemImage: "iphone", busy: false) {
                            list.useApp(prompt: "first_add")
                            list.finishPendingAdd()
                            dismiss()
                        }
                    }
                }
                .padding(Space.xl)
            }
            .background(Palette.ground)
            .presentationDetents([.medium, .large])
            .presentationBackground(Palette.ground)
        }
    }

    private func option(_ title: String, detail: String, systemImage: String, busy: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: Space.m) {
                Image(systemName: systemImage).font(.app(.title3)).foregroundStyle(Palette.accent).frame(width: 32)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.app(.headline)).foregroundStyle(Palette.ink)
                    Text(detail).font(.app(.subheadline)).foregroundStyle(Palette.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                if busy { ProgressView() } else {
                    Image(systemName: "chevron.right").font(.app(.subheadline, .semibold)).foregroundStyle(Palette.muted)
                        .accessibilityHidden(true)
                }
            }
            .padding(Space.l)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: Radius.large))
            .overlay(RoundedRectangle(cornerRadius: Radius.large).strokeBorder(Palette.line.opacity(0.7)))
            .contentShape(RoundedRectangle(cornerRadius: Radius.large))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

/// Pick your stores: a checklist, the same choice as onboarding's "Where do you shop?".
struct YourStoresPicker: View {
    @Environment(FeedStore.self) private var store

    var body: some View {
        List(store.feed?.stores ?? []) { s in
            let on = store.isFavorite(s.id)
            Button { store.toggleFavorite(s.id) } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.name).font(.app(.headline)).foregroundStyle(Palette.ink)
                        Text(s.towns).font(.app(.subheadline)).foregroundStyle(Palette.muted)
                    }
                    Spacer()
                    Image(systemName: on ? "heart.fill" : "heart").foregroundStyle(on ? Palette.accent : Palette.muted)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(on ? .isSelected : [])
            .listRowBackground(Palette.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .navigationTitle("Your stores")
        .sensoryFeedback(.selection, trigger: store.favoriteStores)
    }
}
