import SwiftUI

/// Screen background and side margins shared by every tab.
struct Page<Content: View>: View {
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

/// A bar pinned under the navigation bar (chips, a segmented control). Uses iOS 26's
/// `safeAreaBar`, not `safeAreaInset`: with an inset, the scroll edge effect stops at the nav
/// bar, so rows slid visibly under the chips and the inline title (the overlap in the Oct 28
/// recording). With a bar, the soft edge reaches under it and content fades out behind both.
/// KitchenUI's `pinnedChips` has the same bug; this is the one-line fix to move there.
private struct PinnedBar<Bar: View>: ViewModifier {
    let bar: Bar
    func body(content: Content) -> some View {
        content
            .safeAreaBar(edge: .top, spacing: 0) {
                bar
                    .padding(.horizontal, Space.l)
                    .padding(.vertical, Space.xs)
            }
            .scrollEdgeEffectStyle(.soft, for: .top)
    }
}

/// "Vegetarian" as a leaf button in the toolbar, next to the gear. It used to be a chip pinned
/// under the title, but on iOS 26 the large title scrolls with the content, so a pinned bar ends
/// up above the title (the Oct 28 evening recording). A toolbar toggle stays put and in reach.
private struct VegChip: ViewModifier {
    @Environment(FeedStore.self) private var store
    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                let on = store.vegetarianOnly
                Button {
                    store.vegetarianOnly.toggle()
                    Announce.say(store.vegetarianOnly ? "Showing vegetarian deals only" : "Showing all deals")
                } label: {
                    Label("Vegetarian only", systemImage: on ? "leaf.fill" : "leaf")
                        .contentTransition(.symbolEffect(.replace))
                }
                .tint(on ? Palette.accent : nil)
                .accessibilityValue(on ? "On" : "Off")
                .accessibilityAddTraits(on ? .isSelected : [])
                .sensoryFeedback(.selection, trigger: on)
            }
        }
    }
}

extension View {
    /// A search field in the navigation bar drawer, only when `on`.
    @ViewBuilder func searchableIf(_ on: Bool, text: Binding<String>, prompt: String) -> some View {
        if on {
            searchable(text: text, placement: .navigationBarDrawer(displayMode: .automatic), prompt: prompt)
        } else {
            self
        }
    }

    func dealsPinnedBar<Bar: View>(@ViewBuilder _ bar: () -> Bar) -> some View { modifier(PinnedBar(bar: bar())) }
    func dealsVegChip() -> some View { modifier(VegChip()) }
}

// MARK: This week

struct ThisWeekView: View {
    @Environment(FeedStore.self) private var store
    @State private var selected: Deal?
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            Page {
                MessageCard(place: "week")
                if store.feed != nil {
                    EditionBanner()
                    WatchHits { selected = $0 }
                    let picks = store.topPicks()
                    SectionHeading(title: "Top picks", note: "\(store.standouts.count) standouts in all")
                    ForEach(picks) { d in
                        DealRow(deal: d, showWhy: true) { selected = d }
                    }
                    // What people are adding (Amplitude, counts only), once enough people have.
                    let adding = store.popularDeals.prefix(3)
                    if !adding.isEmpty {
                        SectionHeading(title: "People are adding", note: "this week")
                        ForEach(adding, id: \.deal.id) { entry in
                            DealRow(deal: entry.deal, people: entry.people) { selected = entry.deal }
                        }
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
            .dealsVegChip()
            .settingsButton()
            .refreshable { await store.refresh() }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
            // Simulator screenshots: -deal <name> opens the first deal whose name contains it.
            .task { if let q = DebugArgs.value("-deal") { selected = store.items.first { $0.name.localizedCaseInsensitiveContains(q) } } }
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
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack(path: $path) {
            Page {
                MessageCard(place: "stores")
                let mine = store.rankedStores.filter { store.isFavorite($0.id) }
                if !mine.isEmpty {
                    SectionHeading(title: "Your stores", note: "\(mine.count)")
                    ForEach(mine) { s in tile(s) }
                    SectionHeading(title: "More stores")
                }
                ForEach(store.rankedStores.filter { !store.isFavorite($0.id) }) { s in tile(s) }
            }
            .navigationTitle("Stores")
            .navigationSubtitle("\(store.rankedStores.filter { !store.deals(atStore: $0.id).isEmpty }.count) with deals this week")
            .settingsButton()
            .navigationDestination(for: Store.self) { StoreDetail(s: $0, openStore: openStore) }
        }
    }

    private func tile(_ s: Store) -> some View {
        let deals = store.deals(atStore: s.id)
        return NavigationLink(value: s) {
            Tile(title: s.name,
                 chip: s.delivery == nil ? nil : "Delivers",
                 favorite: store.isFavorite(s.id),
                 line: deals.isEmpty ? (s.status == "unreadable" ? "Flyer couldn't be read this week" : "No deals this week")
                                     : "\(deals.count) deals, \(deals.filter { $0.tier == .standout }.count) standouts",
                 top: s.towns)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(store.isFavorite(s.id) ? "Remove from your stores" : "Add to your stores",
                   systemImage: store.isFavorite(s.id) ? "heart.slash" : "heart") { store.toggleFavorite(s.id) }
        }
    }
}

/// A store's page: its weekly ad as a card at the top (opening the full-screen flyer), what
/// it's like, and all of its deals, with a search field for just this store.
struct StoreDetail: View {
    @Environment(FeedStore.self) private var store
    @State private var selected: Deal?
    @State private var aboutOpen = false
    @State private var flyerOpen = false
    @State private var query = ""
    let s: Store
    var openStore: ((String) -> Void)? = nil
    /// False when opened from the Search tab, which already has a search field.
    var ownSearch = true

    var body: some View {
        let all = store.deals(atStore: s.id)
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let deals = q.isEmpty ? all : all.filter { $0.name.lowercased().contains(q) }
        Page {
            if q.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    if s.hasFlyer {
                        FlyerCard(store: s) { flyerOpen = true }
                    }
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
            }
            SectionHeading(title: q.isEmpty ? "This week" : "Matching", note: "\(deals.count) deals")
            ForEach(deals) { d in
                DealRow(deal: d, showStore: false) { selected = d }
            }
            if deals.isEmpty {
                EmptyState(.persimmon, mood: q.isEmpty ? .sleepy : .surprised,
                           title: !q.isEmpty ? "Not on sale here this week" : s.status == "unreadable" ? "Couldn't read this week's flyer" : "No deals this week",
                           message: s.hasFlyer ? "The weekly ad might still have something." : nil,
                           actionTitle: s.hasFlyer ? "Open the weekly ad" : nil, actionImage: "newspaper") { flyerOpen = true }
                    .padding(.top, Space.l)
            }
        }
        .navigationTitle(s.name)
        .navigationSubtitle([s.towns, s.readThisWeek && s.from != nil ? "Sale \(Dates.short(s.from)) to \(Dates.short(s.through))" : ""]
            .filter { !$0.isEmpty }.joined(separator: " · "))
        .searchableIf(ownSearch, text: $query, prompt: "Search \(s.name)")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(store.isFavorite(s.id) ? "Remove from your stores" : "Add to your stores",
                       systemImage: store.isFavorite(s.id) ? "heart.fill" : "heart") {
                    store.toggleFavorite(s.id)
                    Announce.say(store.isFavorite(s.id) ? "Added \(s.name) to your stores" : "Removed \(s.name) from your stores")
                }
                .sensoryFeedback(.selection, trigger: store.isFavorite(s.id))
                if s.hasFlyer {
                    Button("Weekly ad", systemImage: "newspaper") { flyerOpen = true }
                }
            }
        }
        .flyer(for: s, isPresented: $flyerOpen)
        .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
    }
}

/// A card for an aisle or a store: name, a "Delivers" badge, counts and the top deal.
struct Tile: View {
    let title: String
    var chip: String? = nil
    var favorite = false
    let line: String
    var top: String? = nil

    var body: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: Space.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(.app(.title3, .bold)).foregroundStyle(Palette.ink)
                    if favorite {
                        Image(systemName: "heart.fill").font(.app(.subheadline)).foregroundStyle(Palette.accent)
                            .accessibilityLabel("Your store")
                    }
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
