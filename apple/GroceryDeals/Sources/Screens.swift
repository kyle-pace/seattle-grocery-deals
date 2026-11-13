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
}

// MARK: This week

struct ThisWeekView: View {
    @Environment(FeedStore.self) private var store
    @State private var selected: Deal?
    @State private var editingStores = false
    let openStore: (String) -> Void

    var body: some View {
        NavigationStack {
            Page {
                MessageCard(place: "week")
                if store.feed != nil {
                    EditionBanner()
                    WatchHits { selected = $0 }
                    // Persimmon season and friends: one card, or a row to swipe (Seasons.swift).
                    SeasonCards()
                    // People shop one store per trip: rank stores first (Best of your stores),
                    // then the best single deals from anywhere.
                    YourStoresWeek(select: { selected = $0 }, openStore: openStore) {
                        editingStores = true
                        Analytics.track("Opened Edit Stores", ["source": "this_week"])
                    }
                    let picks = store.topPicks()
                    SectionHeading(title: "Best single deals", note: "Any store · \(store.liveStandouts.count) standouts")
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
                } else if store.loading {
                    LoadingDeals()
                } else {
                    EmptyState(.crow, mood: .sad, title: Lines.noFeedTitle, message: Lines.noFeedDetail,
                               actionTitle: "Try again", actionImage: "arrow.clockwise") { Task { await store.refresh() } }
                        .padding(.top, Space.xl)
                }
            }
            .navigationTitle("This week")
            .navigationSubtitle(store.editionLine)
            .toolbar {
                // The crow lives at the top of This week, like Henwood's hen: he blinks and
                // bobs, and hops when tapped (KitchenUI's CrowBuddy; still with Reduce Motion).
                ToolbarItem(placement: .topBarLeading) {
                    CrowBuddy(mood: store.feed == nil && !store.loading ? .sad : .neutral, size: 40)
                        .accessibilityHidden(true)
                }
                .sharedBackgroundVisibility(.hidden)
            }
            .settingsButton()
            // A hidden season's buddy, to find its card again (Seasons.swift).
            .seasonToolbarButtons()
            .refreshable { await store.refresh() }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
            .sheet(isPresented: $editingStores) { YourStoresSheet() }
            // Simulator screenshots: -deal <name> opens the first deal whose name contains it.
            .task { if let q = DebugArgs.value("-deal") { selected = store.items.first { $0.name.localizedCaseInsensitiveContains(q) } } }
        }
    }
}

/// Best of your stores on This week (the site's app.js does the same from the same numbers):
/// your stores ranked by this week's deals, or every store when you haven't picked any. One
/// store: just its week. A quiet week says so, and one store you didn't pick can show under
/// Elsewhere when it's clearly ahead. Picked stores with no deals listed stay, with their ad.
private struct YourStoresWeek: View {
    @Environment(FeedStore.self) private var store
    let select: (Deal) -> Void
    let openStore: (String) -> Void
    let editStores: () -> Void

    var body: some View {
        let w = store.storeWeek
        let picked = store.favoriteStores
        // Your stores in the order they rank this week, then any with no deals listed.
        let names = picked.isEmpty ? [] : w.ranked.map(\.store.name) + w.unread.map(\.name)
        SectionHeading(title: picked.isEmpty ? "Best stores this week" : picked.count == 1 ? "This week at \(names.first ?? "your store")" : "Best of your stores",
                       note: picked.isEmpty ? "Pick yours to rank just those" : store.vegetarianOnly ? "By vegetarian deals" : "By this week's deals")
        YourStoresButton(names: names, action: editStores)
        if !picked.isEmpty, w.quiet || w.ranked.isEmpty {
            QuietNote(names: w.ranked.map(\.store.name), none: w.ranked.isEmpty, elsewhere: w.elsewhere)
        }
        ForEach(Array(w.ranked.enumerated()), id: \.element.id) { i, e in
            section(e, best: i == 0 && w.ranked.count > 1 && !w.quiet, position: i + 1, place: picked.isEmpty ? "all" : "yours")
        }
        ForEach(w.unread) { s in UnreadStoreRow(s: s) }
        if let e = w.elsewhere {
            SectionHeading(title: "Elsewhere this week", note: "Not one of your stores")
            section(e, best: false, position: 0, place: "elsewhere")
        }
    }

    private func section(_ e: FeedStore.RankedStore, best: Bool, position: Int, place: String) -> some View {
        StoreSection(s: e.store, total: store.liveDeals(atStore: e.store.id).count, standouts: e.rank.standouts,
                     deals: store.topDeals(e.rank, at: e.store.id), reason: e.rank.reason, isBest: best,
                     newFlyer: store.isNewFlyer(e.store), select: select) { id in
            Analytics.track("Opened Store Card", ["store": id, "position": position, "section": place,
                                                  "stores_picked": store.favoriteStores.count, "veg_only": store.vegetarianOnly])
            openStore(id)
        }
    }
}

/// "Your stores · 4, Met Market, Central Co-op…" with Edit: one tap to change them.
private struct YourStoresButton: View {
    let names: [String]
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.m) {
                Image(systemName: names.isEmpty ? "heart" : "heart.fill").foregroundStyle(Palette.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(names.isEmpty ? "Your stores" : "Your stores · \(names.count)").font(.app(.headline)).foregroundStyle(Palette.ink)
                    Text(names.isEmpty ? "Pick the stores you shop at" : names.joined(separator: ", "))
                        .font(.app(.subheadline)).foregroundStyle(Palette.muted).lineLimitUnlessLarge(1)
                }
                Spacer(minLength: 0)
                Text(names.isEmpty ? "Pick" : "Edit").font(.app(.subheadline, .bold)).foregroundStyle(Palette.accent)
            }
            .padding(Space.m)
            .frame(minHeight: 56)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: Radius.large))
            .overlay(RoundedRectangle(cornerRadius: Radius.large).strokeBorder(Palette.line.opacity(0.7)))
            .contentShape(RoundedRectangle(cornerRadius: Radius.large))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Changes which stores This week ranks")
    }
}

/// "A quiet week at H Mart and Lam's. 99 Ranch has 13 standouts, if you can get there."
private struct QuietNote: View {
    let names: [String]
    let none: Bool
    let elsewhere: FeedStore.RankedStore?
    var body: some View {
        Card(padding: Space.m) {
            VStack(alignment: .leading, spacing: 4) {
                Text(none ? "No deals listed at your stores yet" : "A quiet week at \(names.count > 2 ? "your stores" : names.joined(separator: " and "))")
                    .font(.app(.headline)).foregroundStyle(Palette.ink)
                Text(elsewhere.map { "\($0.store.name) has \($0.rank.standouts) standouts, if you can get there." }
                     ?? "New flyers come in through the week, so check back soon.")
                    .font(.app(.callout)).foregroundStyle(Palette.body)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, Space.m)
        .accessibilityElement(children: .combine)
    }
}

/// A picked store with no deals listed this week: its flyer couldn't be read or isn't up yet.
private struct UnreadStoreRow: View {
    let s: Store
    var body: some View {
        HStack(spacing: Space.m) {
            VStack(alignment: .leading, spacing: 2) {
                Text(s.name).font(.app(.headline)).foregroundStyle(Palette.ink)
                Text(s.status == "stale" ? "Its new flyer isn't up yet." : "We couldn't read this week's flyer.")
                    .font(.app(.subheadline)).foregroundStyle(Palette.muted)
            }
            Spacer(minLength: 0)
            if let url = s.flyerLinkURL {
                Link("Their ad", destination: url).font(.app(.subheadline, .bold)).tint(Palette.accent).frame(minHeight: 44)
            }
        }
        .padding(.horizontal, Space.l)
        .padding(.vertical, Space.s)
        .overlay(RoundedRectangle(cornerRadius: Radius.large).strokeBorder(Palette.line, style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
        .padding(.top, Space.m)
    }
}

/// One store on This week, as its own card: badges (Best this week, New flyer today), the
/// store's name, why this week is good there, its best few deals, and a way to see the rest.
private struct StoreSection: View {
    let s: Store
    let total: Int
    let standouts: Int
    let deals: [Deal]
    var reason: String = ""
    var isBest = false
    var newFlyer = false
    let select: (Deal) -> Void
    let openStore: (String) -> Void

    var body: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Button { openStore(s.id) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                        Image(systemName: "storefront").foregroundStyle(Palette.accent).hiddenWhenTextIsLarge()
                        VStack(alignment: .leading, spacing: 2) {
                            if isBest || newFlyer {
                                HStack(spacing: 6) {
                                    if isBest { Badge("Best this week", tone: .good, compact: true) { Image(systemName: "star.fill").imageScale(.small) } }
                                    if newFlyer { Badge("New flyer today", tone: .info, compact: true) { Image(systemName: "sparkles").imageScale(.small) } }
                                }
                                .padding(.bottom, 2)
                            }
                            Text(s.name).font(.app(.title3, .bold)).foregroundStyle(Palette.ink)
                            if !reason.isEmpty {
                                Text(reason).font(.app(.callout)).foregroundStyle(Palette.body)
                            }
                            Text(standouts > 0 ? "\(standouts) \(standouts == 1 ? "standout" : "standouts"), \(total) deals" : "\(total) deals")
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
                if store.feed == nil {
                    LoadingDeals()
                } else {
                    let mine = store.rankedStores.filter { store.isFavorite($0.id) }
                    if !mine.isEmpty {
                        SectionHeading(title: "Your stores", note: "\(mine.count)")
                        ForEach(mine) { s in tile(s) }
                        SectionHeading(title: "More stores")
                    }
                    ForEach(store.rankedStores.filter { !store.isFavorite($0.id) }) { s in tile(s) }
                }
            }
            .navigationTitle("Stores")
            .navigationSubtitle(store.feed == nil ? "" : "\(store.rankedStores.filter { !store.deals(atStore: $0.id).isEmpty }.count) with deals this week")
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
                                     // Standouts first, the same order as This week's store cards and the site.
                                     : { let st = deals.filter { $0.tier == .standout }.count
                                         return st > 0 ? "\(st) standouts, \(deals.count) deals" : "\(deals.count) deals" }(),
                 top: s.towns)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(store.isFavorite(s.id) ? "Remove from your stores" : "Add to your stores",
                   systemImage: store.isFavorite(s.id) ? "heart.slash" : "heart") { store.toggleFavorite(s.id, source: "stores_tab") }
        }
    }
}

/// A store's page: its weekly ad as a card at the top (a link out to the store's own flyer page), what
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
            if q.isEmpty {
                // By aisle, so the page reads like a walk through the store.
                ForEach(store.aisles.filter { a in deals.contains { $0.category == a.id } }) { a in
                    let rows = deals.filter { $0.category == a.id }
                    SectionHeader(a.label, trailing: "\(rows.count)")
                        .padding(.top, Space.l)
                    ForEach(rows) { d in
                        DealRow(deal: d, showStore: false) { selected = d }
                    }
                }
            } else {
                ForEach(deals) { d in
                    DealRow(deal: d, showStore: false) { selected = d }
                }
            }
            if deals.isEmpty {
                EmptyState(.crow, mood: q.isEmpty ? .sleepy : .surprised,
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
                    store.toggleFavorite(s.id, source: "store_page")
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
