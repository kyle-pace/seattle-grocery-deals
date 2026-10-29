import SwiftUI

// The Aisles tab: every aisle as a tile, standouts first, then one page per aisle with store
// chips, sorting and its own search field.

/// A small picture for each aisle. Emoji on purpose: colorful, free, and there are no product
/// photos yet (see "Product images" in HANDOFF.md). Decorative only.
enum AisleArt {
    static func emoji(_ id: String) -> String {
        switch id {
        case "produce": "🥬"
        case "meat": "🥩"
        case "seafood": "🐟"
        case "dairy-eggs": "🥚"
        case "pantry": "🍚"
        case "frozen": "🥟"
        case "bakery": "🥖"
        case "prepared": "🍱"
        case "snacks-drinks": "🍵"
        default: "🧺"
        }
    }
}

struct AislesView: View {
    @Environment(FeedStore.self) private var store
    @Binding var path: [AisleRoute]
    let openStore: (String) -> Void

    private let columns = [GridItem(.flexible(), spacing: Space.m), GridItem(.flexible(), spacing: Space.m)]

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if store.feed == nil {
                        LoadingDeals()
                    } else {
                        // Deals first, like Careem's "All deals" tile: the week's standouts.
                        NavigationLink(value: AisleRoute.standouts) {
                            StandoutsTile(count: store.standouts.count, top: store.standouts.first)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, Space.s)

                        LazyVGrid(columns: columns, spacing: Space.m) {
                            ForEach(store.aisles) { c in
                                NavigationLink(value: AisleRoute.aisle(c)) {
                                    AisleTile(category: c, deals: store.deals(inCategory: c.id))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.top, Space.m)
                    }
                }
                .padding(.horizontal, Space.l)
                .padding(.bottom, Space.xl)
            }
            .background(Palette.ground)
            .navigationTitle("Aisles")
            .navigationSubtitle("\(store.items.count) deals in \(store.aisles.count) aisles")
            .dealsVegChip()
            .settingsButton()
            .refreshable { await store.refresh() }
            .navigationDestination(for: AisleRoute.self) { route in
                AisleDetail(route: route, openStore: openStore)
            }
        }
    }
}

/// Where the Aisles tab can go: one aisle, or every standout.
enum AisleRoute: Hashable {
    case aisle(Category)
    case standouts
}

/// "★ Standouts · 61 this week", full width above the grid.
private struct StandoutsTile: View {
    let count: Int
    let top: Deal?

    var body: some View {
        HStack(spacing: Space.m) {
            Image(systemName: "star.fill")
                .font(.app(.title2, .bold))
                .foregroundStyle(Palette.text(.warn))
                .frame(width: 52, height: 52)
                .background(Palette.fill(.warn), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Standouts").font(.app(.title3, .bold)).foregroundStyle(Palette.ink)
                Text("\(count) this week, every aisle").font(.app(.subheadline)).foregroundStyle(Palette.muted)
                if let top {
                    Text("Top: \(shortName(top.name)) \(top.text)").font(.app(.subheadline)).foregroundStyle(Palette.body).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.app(.subheadline, .semibold)).foregroundStyle(Palette.muted)
                .accessibilityHidden(true)
        }
        .padding(Space.l)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Radius.large))
        .overlay(RoundedRectangle(cornerRadius: Radius.large).strokeBorder(Palette.line.opacity(0.7)))
        .contentShape(RoundedRectangle(cornerRadius: Radius.large))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens every standout this week")
    }
}

/// One aisle: big picture, name, counts and the best deal in it.
private struct AisleTile: View {
    let category: Category
    let deals: [Deal]
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        let standouts = deals.filter { $0.tier == .standout }.count
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(alignment: .top) {
                Text(AisleArt.emoji(category.id))
                    .font(.system(size: textSize.isAccessibilitySize ? 30 : 40))
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                if standouts > 0 {
                    Text("\(standouts)★")
                        .font(.app(.caption, .bold))
                        .foregroundStyle(Palette.text(.warn))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Palette.fill(.warn), in: Capsule())
                        .accessibilityLabel("\(standouts) standouts")
                }
            }
            Spacer(minLength: Space.s)
            Text(category.label).font(.app(.headline)).foregroundStyle(Palette.ink)
                .lineLimit(2).multilineTextAlignment(.leading)
            Text("\(deals.count) deals").font(.app(.subheadline)).foregroundStyle(Palette.muted)
            if let best = deals.first {
                Text("\(shortName(best.name)) \(best.text)")
                    .font(.app(.footnote)).foregroundStyle(Palette.body)
                    .lineLimit(2).multilineTextAlignment(.leading)
            }
        }
        .padding(Space.m)
        .frame(maxWidth: .infinity, minHeight: textSize.isAccessibilitySize ? 0 : 150, alignment: .topLeading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Radius.large))
        .overlay(RoundedRectangle(cornerRadius: Radius.large).strokeBorder(Palette.line.opacity(0.7)))
        .contentShape(RoundedRectangle(cornerRadius: Radius.large))
        .accessibilityElement(children: .combine)
    }
}

/// One aisle's deals: store chips with counts, a sort menu, and search inside the aisle.
struct AisleDetail: View {
    enum Sort: String, CaseIterable, Identifiable {
        case best = "Best first", price = "Lowest price", store = "By store"
        var id: String { rawValue }
    }

    @Environment(FeedStore.self) private var store
    @State private var storeFilter: String?
    @State private var sort: Sort = .best
    @State private var query = ""
    @State private var selected: Deal?
    let route: AisleRoute
    let openStore: (String) -> Void
    /// False when opened from the Search tab, which already has a search field.
    var ownSearch = true

    private var title: String {
        switch route {
        case .aisle(let c): c.label
        case .standouts: "Standouts"
        }
    }

    private var all: [Deal] {
        switch route {
        case .aisle(let c): store.deals(inCategory: c.id)
        case .standouts: store.standouts
        }
    }

    private var shown: [Deal] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        var deals = all.filter { d in
            (storeFilter == nil || d.store == storeFilter) && (q.isEmpty || d.name.lowercased().contains(q))
        }
        switch sort {
        case .best: break
        case .price: deals.sort { unitSortValue($0) < unitSortValue($1) }
        case .store: deals.sort { store.storeName($0.store) < store.storeName($1.store) }
        }
        return deals
    }

    /// Stores in this aisle, your stores first, then the most deals.
    private var storeCounts: [(store: Store, count: Int)] {
        store.rankedStores.compactMap { s in
            let n = all.filter { $0.store == s.id }.count
            return n > 0 ? (s, n) : nil
        }
    }

    var body: some View {
        let deals = shown
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if sort == .store && storeFilter == nil {
                    ForEach(storeCounts, id: \.store.id) { entry in
                        let mine = deals.filter { $0.store == entry.store.id }
                        if !mine.isEmpty {
                            Button { openStore(entry.store.id) } label: {
                                SectionHeader(entry.store.name, trailing: "\(mine.count)", chevron: true)
                            }
                            .buttonStyle(.plain)
                            .padding(.top, Space.xl).padding(.bottom, Space.xs)
                            .accessibilityHint("Opens the store")
                            ForEach(mine) { d in DealRow(deal: d, showStore: false) { selected = d } }
                        }
                    }
                } else {
                    ForEach(deals) { d in DealRow(deal: d) { selected = d } }
                }
                if deals.isEmpty {
                    EmptyState(.persimmon, mood: .surprised, title: Lines.pick(Lines.noResultsTitle),
                               message: query.isEmpty ? "Nothing here with these filters." : Lines.noResultsDetail(query))
                        .padding(.top, Space.xl)
                }
            }
            .padding(.horizontal, Space.l)
            .padding(.bottom, Space.xl)
        }
        .background(Palette.ground)
        .navigationTitle(title)
        // Inline, so the pinned store chips sit under the bar instead of over a large title.
        .navigationBarTitleDisplayMode(.inline)
        .navigationSubtitle(storeFilter == nil ? "\(all.count) deals" : "\(deals.count) of \(all.count) at \(store.storeName(storeFilter!))")
        .searchableIf(ownSearch, text: $query, prompt: "Search \(title.lowercased())")
        .dealsPinnedBar {
            ChipRow {
                FilterChip("All stores", count: all.count, isOn: storeFilter == nil) { storeFilter = nil }
                ForEach(storeCounts, id: \.store.id) { entry in
                    FilterChip(entry.store.name, count: entry.count,
                               systemImage: store.isFavorite(entry.store.id) ? "heart.fill" : nil,
                               isOn: storeFilter == entry.store.id) {
                        storeFilter = storeFilter == entry.store.id ? nil : entry.store.id
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: storeFilter)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Sort", systemImage: "arrow.up.arrow.down") {
                    Picker("Sort", selection: $sort) {
                        ForEach(Sort.allCases) { Text($0.rawValue).tag($0) }
                    }
                }
            }
        }
        .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
        .onAppear { Analytics.track("Opened Aisle", ["aisle": title]) }
    }

    /// Unit price when there is one ("$1.48/lb" -> 1.48, "67¢/lb" -> 0.67), else the price.
    private func unitSortValue(_ d: Deal) -> Double {
        if let u = d.unit_price, let r = u.range(of: #"\d+(\.\d+)?"#, options: .regularExpression), let v = Double(u[r]) {
            return u.contains("¢") ? v / 100 : v
        }
        return d.price
    }
}
