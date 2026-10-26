import SwiftUI

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

private struct VegToggle: View {
    @Environment(FeedStore.self) private var store
    var body: some View {
        @Bindable var store = store
        Toggle(isOn: $store.vegetarianOnly) {
            Text("Vegetarian only").font(.app(.headline)).foregroundStyle(Palette.ink)
        }
        .tint(Palette.accent)
        .frame(minHeight: 44)
        .padding(.top, Space.s)
    }
}

// MARK: This week

struct ThisWeekView: View {
    @Environment(FeedStore.self) private var store
    @State private var query = ""
    @State private var selected: Deal?
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            Page {
                if let feed = store.feed {
                    Text("\(Dates.short(feed.week, weekday: false)) to \(Dates.short(feed.end, weekday: false)) · \(feed.items.count) deals from \(feed.stores.filter(\.readThisWeek).count) stores")
                        .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                    VegToggle()
                    if query.isEmpty {
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
                    } else {
                        let results = store.search(query)
                        SectionHeading(title: "\(results.count) found")
                        ForEach(results.prefix(100)) { d in
                            DealRow(deal: d) { selected = d }
                        }
                        if results.isEmpty {
                            ContentUnavailableView {
                                Label("Nothing matches", systemImage: "magnifyingglass")
                            } description: {
                                Text("Try a shorter word or a store name.")
                            }
                            .padding(.top, Space.l)
                        }
                    }
                }
            }
            .navigationTitle("This week")
            .searchable(text: $query, prompt: "Deals and stores")
            .onSubmit(of: .search) { Analytics.track("Searched", ["query_length": query.count, "results": store.search(query).count, "screen": "this_week"]) }
            .refreshable { await store.refresh() }
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

// MARK: Aisles

struct AislesView: View {
    @Environment(FeedStore.self) private var store
    @State private var selected: Deal?
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            Page {
                VegToggle()
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
            }
            .navigationTitle("Aisles")
            .navigationDestination(for: Category.self) { c in
                Page {
                    VegToggle()
                    ForEach(store.deals(inCategory: c.id)) { d in
                        DealRow(deal: d) { selected = d }
                    }
                }
                .navigationTitle(c.label)
            }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
        }
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
            .navigationDestination(for: Store.self) { StoreDetail(s: $0) }
        }
    }
}

struct StoreDetail: View {
    @Environment(FeedStore.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var selected: Deal?
    let s: Store

    var body: some View {
        Page {
            VStack(alignment: .leading, spacing: 10) {
                Text([s.towns, s.readThisWeek && s.from != nil ? "Sale \(Dates.short(s.from)) to \(Dates.short(s.through))" : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                if let ad = s.flyer_url.flatMap(URL.init(string:)) {
                    Button { Analytics.track("Opened Weekly Ad", ["store": s.id]); openURL(ad) } label: {
                        Label("See \(s.name)'s weekly ad", systemImage: "arrow.up.right").font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glassProminent)
                    .accessibilityHint("Opens the store's website")
                }
                Text(s.about).font(.app(.callout)).foregroundStyle(Palette.body)
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
                VegToggle()
            }
            .padding(.top, Space.s)
            let deals = store.deals(atStore: s.id)
            SectionHeading(title: "This week", note: "\(deals.count) deals")
            ForEach(deals) { d in
                DealRow(deal: d, showStore: false) { selected = d }
            }
        }
        .navigationTitle(s.name)
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
