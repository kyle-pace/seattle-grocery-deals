import SwiftUI
import WebKit

/// Screen background and side margins shared by every tab.
private struct Page<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) { content }
                .padding(.horizontal, Space.l)
                .padding(.bottom, Space.xl)
        }
        .background(Palette.ground)
    }
}

/// "Vegetarian" as a chip pinned under the title, instead of a full-width switch.
private struct VegChip: ViewModifier {
    @Environment(FeedStore.self) private var store
    func body(content: Content) -> some View {
        @Bindable var store = store
        content.pinnedChips {
            FilterChip("Vegetarian", systemImage: "leaf", isOn: store.vegetarianOnly) {
                store.vegetarianOnly.toggle()
                Announce.say(store.vegetarianOnly ? "Showing vegetarian deals only" : "Showing all deals")
            }
            .sensoryFeedback(.selection, trigger: store.vegetarianOnly)
        }
    }
}

extension View {
    fileprivate func vegChip() -> some View { modifier(VegChip()) }
}

// MARK: This week

struct ThisWeekView: View {
    @Environment(FeedStore.self) private var store
    @State private var selected: Deal?
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            Page {
                if store.feed != nil {
                    EditionBanner()
                    WatchHits { selected = $0 }
                    let picks = store.topPicks()
                    SectionHeading(title: "Top picks", note: "\(store.standouts.count) standouts in all")
                    ForEach(picks) { d in
                        DealRow(deal: d, showWhy: true) { selected = d }
                    }
                    let picked = Set(picks.map(\.id))
                    SectionHeading(title: "By store", note: "Each store's best")
                    ForEach(store.rankedStores) { s in
                        let all = store.deals(atStore: s.id)
                        let best = all.filter { !picked.contains($0.id) }.prefix(3)
                        if !best.isEmpty {
                            StoreSection(s: s, total: all.count, standouts: all.filter { $0.tier == .standout }.count,
                                         deals: Array(best), select: { selected = $0 }, openStore: openStore)
                        }
                    }
                } else if store.loading {
                    LoadingDeals()
                } else {
                    EmptyState(.persimmon, mood: .sad, title: Lines.noFeedTitle, message: Lines.noFeedDetail,
                               actionTitle: "Try again", actionImage: "arrow.clockwise") { Task { await store.refresh() } }
                        .padding(.top, Space.xl)
                }
            }
            .navigationTitle("This week")
            .navigationSubtitle(store.editionLine)
            .vegChip()
            .settingsButton()
            .refreshable { await store.refresh() }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
            // Simulator screenshots: -deal <name> opens the first deal whose name contains it.
            .task { if let q = DebugArgs.value("-deal") { selected = store.items.first { $0.name.localizedCaseInsensitiveContains(q) } } }
        }
    }
}

// MARK: Search

/// One place to find anything: deals and stores as you type, the aisles before you do.
struct SearchView: View {
    enum Scope: String, CaseIterable, Hashable { case all = "All", deals = "Deals", stores = "Stores" }
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @State private var query = ""
    @State private var scope: Scope = .all
    @State private var selected: Deal?
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            Page {
                let q = query.trimmingCharacters(in: .whitespaces)
                if q.isEmpty {
                    SectionHeading(title: "Aisles")
                    ForEach(store.feed?.categories ?? []) { c in
                        let deals = store.deals(inCategory: c.id)
                        if !deals.isEmpty {
                            NavigationLink(value: c) {
                                Tile(title: c.label,
                                     line: "\(deals.count) deals, \(deals.filter { $0.tier == .standout }.count) standouts",
                                     top: deals.first.map { "Top: \($0.name) \($0.text)" })
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else {
                    let stores = scope == .deals ? [] : store.searchStores(q)
                    let deals = scope == .stores ? [] : store.search(q)
                    if !stores.isEmpty {
                        SectionHeading(title: "Stores", note: "\(stores.count)")
                        ForEach(stores) { s in
                            NavigationLink(value: s) {
                                Tile(title: s.name, line: "\(store.deals(atStore: s.id).count) deals this week", top: s.towns)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if !deals.isEmpty {
                        SectionHeading(title: "Deals", note: "\(deals.count) found")
                        ForEach(deals.prefix(100)) { d in
                            DealRow(deal: d) { selected = d }
                        }
                    }
                    if stores.isEmpty && deals.isEmpty {
                        EmptyState(.persimmon, mood: .surprised, title: Lines.pick(Lines.noResultsTitle),
                                   message: Lines.noResultsDetail(q), actionTitle: "Add to list", actionImage: "plus") {
                            list.request(q)
                            Announce.say("Added \(q) to your list")
                            query = ""
                        }
                        .padding(.top, Space.l)
                    }
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Deals, stores, aisles")
            .searchScopes($scope, activation: .onSearchPresentation) {
                ForEach(Scope.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .onSubmit(of: .search) {
                Analytics.track("Searched", ["query_length": query.count, "results": store.search(query).count, "screen": "search"])
            }
            .navigationDestination(for: Category.self) { c in
                Page {
                    ForEach(store.deals(inCategory: c.id)) { d in
                        DealRow(deal: d) { selected = d }
                    }
                }
                .navigationTitle(c.label)
                .navigationSubtitle("\(store.deals(inCategory: c.id).count) deals")
                .vegChip()
            }
            .navigationDestination(for: Store.self) { StoreDetail(s: $0) }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
        }
    }
}

/// One store on This week, as its own card: the store's name, its best few deals, and a way to
/// see the rest.
private struct StoreSection: View {
    let s: Store
    let total: Int
    let standouts: Int
    let deals: [Deal]
    let select: (Deal) -> Void
    let openStore: (String) -> Void

    var body: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Button { openStore(s.id) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                        Image(systemName: "storefront").foregroundStyle(Palette.accent).hiddenWhenTextIsLarge()
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.name).font(.app(.title3, .bold)).foregroundStyle(Palette.ink)
                            Text(standouts > 0 ? "\(standouts) standouts, \(total) deals" : "\(total) deals")
                                .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.app(.subheadline, .semibold)).foregroundStyle(Palette.muted)
                            .accessibilityHidden(true)
                    }
                    .padding(Space.l)
                    .background(Palette.raised.opacity(0.5))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                .accessibilityHint("Opens the store")

                ForEach(deals) { d in
                    DealRow(deal: d, showStore: false) { select(d) }
                }
                .padding(.horizontal, Space.l)

                Button { openStore(s.id) } label: {
                    Text("See all \(total) at \(s.name)")
                        .font(.app(.callout, .semibold))
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.borderless)
                .tint(Palette.accent)
                .padding(.horizontal, Space.l)
                .padding(.vertical, Space.xs)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.large))
        .padding(.top, Space.m)
    }
}

// MARK: Stores

struct StoresView: View {
    @Environment(FeedStore.self) private var store
    @Binding var path: [Store]

    var body: some View {
        NavigationStack(path: $path) {
            Page {
                ForEach(store.rankedStores) { s in
                    let deals = store.deals(atStore: s.id)
                    NavigationLink(value: s) {
                        Tile(title: s.name,
                             chip: s.delivery == nil ? nil : "Delivers",
                             line: deals.isEmpty ? (s.status == "unreadable" ? "Flyer couldn't be read this week" : "No deals this week")
                                                 : "\(deals.count) deals, \(deals.filter { $0.tier == .standout }.count) standouts",
                             top: s.towns)
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Stores")
            .navigationSubtitle("\(store.rankedStores.filter { !store.deals(atStore: $0.id).isEmpty }.count) with deals this week")
            .settingsButton()
            .navigationDestination(for: Store.self) { StoreDetail(s: $0) }
        }
    }
}

struct StoreDetail: View {
    enum View2: String, Hashable { case deals = "Deals", flyer = "Weekly ad" }
    @Environment(FeedStore.self) private var store
    @State private var selected: Deal?
    @State private var showing: View2 = .deals
    @State private var aboutOpen = false
    let s: Store

    var body: some View {
        let ad = s.flyer_url.flatMap(URL.init(string:))
        Group {
            if showing == .flyer, let ad {
                WebView(url: ad)
                    .onAppear { Analytics.track("Opened Weekly Ad", ["store": s.id]) }
            } else {
                Page {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(s.about).font(.app(.callout)).foregroundStyle(Palette.body)
                            .lineLimit(aboutOpen ? nil : 3)
                        if !aboutOpen && s.about.count > 140 {
                            Button("Read more") { withAnimation(.snappy) { aboutOpen = true } }
                                .font(.app(.callout, .semibold)).tint(Palette.accent).frame(minHeight: 44)
                        }
                        if let delivery = s.delivery {
                            Card(padding: Space.m) {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Delivery").font(.app(.callout, .bold))
                                        Text(delivery).font(.app(.callout))
                                    }
                                } icon: {
                                    Image(systemName: "box.truck").foregroundStyle(Palette.accent)
                                }
                                .foregroundStyle(Palette.ink)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .padding(.top, Space.s)
                    let deals = store.deals(atStore: s.id)
                    SectionHeading(title: "This week", note: "\(deals.count) deals")
                    ForEach(deals) { d in
                        DealRow(deal: d, showStore: false) { selected = d }
                    }
                    if deals.isEmpty {
                        EmptyState(.persimmon, mood: .sleepy,
                                   title: s.status == "unreadable" ? "Couldn't read this week's flyer" : "No deals this week",
                                   message: ad == nil ? nil : "The weekly ad might still have something.")
                    }
                }
            }
        }
        .navigationTitle(s.name)
        .navigationSubtitle([s.towns, s.readThisWeek && s.from != nil ? "Sale \(Dates.short(s.from)) to \(Dates.short(s.through))" : ""]
            .filter { !$0.isEmpty }.joined(separator: " · "))
        .safeAreaInset(edge: .top, spacing: 0) {
            if ad != nil {
                Picker("Show", selection: $showing) {
                    Text(View2.deals.rawValue).tag(View2.deals)
                    Text(View2.flyer.rawValue).tag(View2.flyer)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Space.l)
                .padding(.vertical, Space.xs)
            }
        }
        .sheet(item: $selected) { DealDetail(deal: $0) }
    }
}

/// A card for an aisle or a store: name, a "Delivers" badge, counts and the top deal.
struct Tile: View {
    let title: String
    var chip: String? = nil
    let line: String
    var top: String? = nil

    var body: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: Space.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(.app(.title3, .bold)).foregroundStyle(Palette.ink)
                    Spacer()
                    Image(systemName: "chevron.right").font(.app(.subheadline, .semibold)).foregroundStyle(Palette.muted)
                        .accessibilityHidden(true)
                }
                if let chip {
                    Badge(chip, tone: .info, compact: true) { Image(systemName: "box.truck").imageScale(.small) }
                }
                Text(line).font(.app(.subheadline)).foregroundStyle(Palette.muted)
                if let top, !top.isEmpty {
                    Text(top).font(.app(.subheadline)).foregroundStyle(Palette.ink).lineLimitUnlessLarge(2)
                }
            }
        }
        .padding(.top, 10)
        .accessibilityElement(children: .combine)
    }
}
