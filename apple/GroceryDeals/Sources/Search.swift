import CoreSpotlight
import SwiftUI
import UniformTypeIdentifiers

// Search, everywhere: the Search tab (recent and popular searches, aisles, typeahead, results
// grouped by aisle), search fields inside each aisle and store, this week's deals in iPhone
// Spotlight, and "Search Deals for…" in Siri and Shortcuts. All of it lands here.

/// Where the app should go, for things that start outside a tab: Spotlight, Siri, Shortcuts.
@MainActor @Observable
final class DealsRouter {
    static let shared = DealsRouter()
    var searchQuery = ""
    /// A tab to switch to ("week", "aisles", "stores", "list", "search"), from an in-app message.
    var tabRequest: String?
    /// Bumped to ask the root view to switch to the Search tab.
    var searchRequest = 0
    /// Bumped to put the cursor in the Search tab's field (iPad, when the tab is picked).
    var searchFocusRequest = 0
    /// A deal to open as a sheet (from Spotlight).
    var dealID: String?
    /// How many deal sheets are open, so the "where should your list live?" question opens
    /// from the top one.
    var openDealSheets = 0
    /// A season screen to open (a This week card, Search, Spotlight).
    var seasonID: String?

    func openSeason(_ id: String) { seasonID = id }

    func search(_ query: String) {
        searchQuery = query
        searchRequest += 1
    }
}

struct SearchView: View {
    enum Scope: String, CaseIterable, Hashable { case all = "All", deals = "Deals", stores = "Stores" }
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Bindable var router: DealsRouter
    @State private var scope: Scope = .all
    @FocusState private var fieldFocused: Bool
    @State private var selected: Deal?
    @State private var path = NavigationPath()
    @AppStorage("sgd.recentSearches") private var recentsRaw = ""
    let openStore: (String) -> Void

    private var recents: [String] { recentsRaw.split(separator: "\n").map(String.init) }

    var body: some View {
        NavigationStack(path: $path) {
            Page {
                let q = router.searchQuery.trimmingCharacters(in: .whitespaces)
                if store.feed == nil { LoadingDeals() } else if q.isEmpty { landing } else { results(q) }
            }
            .navigationTitle("Search")
            // The field sits where iOS 26 puts a search tab's field: at the bottom on iPhone,
            // in place of the tab bar, within reach of a thumb. (It was pinned under the
            // title, where the page opened with a small title and jumped to the large one on
            // the first scroll.) RootView's `tabViewSearchActivation` opens the keyboard.
            .searchable(text: $router.searchQuery, prompt: "Deals, stores, aisles")
            // iPad: the field sits in the top bar, and picking the tab doesn't put the cursor
            // in it the way it does on iPhone, so RootView asks for it. The short wait lets the
            // field exist first when the tab is opened for the first time.
            .searchFocused($fieldFocused)
            .onChange(of: router.searchFocusRequest, initial: true) {
                guard router.searchFocusRequest > 0 else { return }
                Task {
                    try? await Task.sleep(for: .milliseconds(200))
                    fieldFocused = true
                }
            }
            // Keep the navigation bar (and so the back button) while searching: without this,
            // tapping a result with the search active pushed a page with no way back.
            .searchPresentationToolbarBehavior(.avoidHidingContent)
            // All / Deals / Stores sits at the top of the results (below): with the field in
            // the tab bar, the system's scope bar doesn't show (checked on the iPhone and iPad
            // simulators). It starts over at All with each new search: left on Stores, the next
            // popular, recent or Spotlight search came up empty with nothing on screen to say why.
            .onChange(of: router.searchQuery.trimmingCharacters(in: .whitespaces).isEmpty) { _, empty in
                if empty { scope = .all }
            }
            .onSubmit(of: .search) {
                remember(router.searchQuery)
                Analytics.track("Searched", ["query_length": router.searchQuery.count, "results": store.search(router.searchQuery).count, "screen": "search"])
            }
            // Pages opened from Search don't add a second search field; the Search tab's own
            // field is the one search here.
            .navigationDestination(for: Store.self) { StoreDetail(s: $0, openStore: openStore, ownSearch: false) }
            .navigationDestination(for: AisleRoute.self) { AisleDetail(route: $0, openStore: openStore, ownSearch: false) }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
        }
    }

    // MARK: before typing

    @ViewBuilder private var landing: some View {
        if !recents.isEmpty {
            HStack {
                SectionHeader("Recent")
                Button("Clear") { withAnimation { recentsRaw = "" } }
                    .font(.app(.footnote, .semibold)).tint(Palette.accent).frame(minHeight: 44)
            }
            .padding(.top, Space.l)
            ForEach(recents, id: \.self) { r in
                Button { router.searchQuery = r } label: {
                    Label(r, systemImage: "clock.arrow.circlepath")
                        .font(.app(.body)).foregroundStyle(Palette.ink)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Rectangle().fill(Palette.divider).frame(height: 1) }
                .accessibilityHint("Searches again")
            }
        }

        // What people are adding this week (Amplitude, counts only), once enough people have.
        let adding = store.popularDeals.prefix(5)
        if !adding.isEmpty {
            SectionHeading(title: "People are adding", note: "this week")
            ForEach(adding, id: \.deal.id) { entry in
                DealRow(deal: entry.deal, people: entry.people) { selected = entry.deal }
            }
        }

        let popular = store.popularSearches
        if !popular.isEmpty {
            SectionHeading(title: "Popular this week")
            FlowLayout(spacing: Space.s) {
                ForEach(popular, id: \.self) { p in
                    FilterChip(p, systemImage: "flame", isOn: false) { router.searchQuery = p; remember(p) }
                }
            }
        }

        SectionHeading(title: "Jump to an aisle")
        FlowLayout(spacing: Space.s) {
            ForEach(store.aisles) { c in
                NavigationLink(value: AisleRoute.aisle(c)) {
                    HStack(spacing: 5) {
                        Text(AisleArt.emoji(c.id)).accessibilityHidden(true)
                        Text(c.label)
                        Text("\(store.deals(inCategory: c.id).count)").opacity(0.65)
                    }
                    .font(.app(.subheadline, .semibold))
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .frame(minHeight: 44)
                    .background(Palette.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(Palette.line))
                }
                .buttonStyle(.plain)
            }
        }

        Text("Tip: this week's deals also show up when you search from your Home Screen.")
            .font(.app(.footnote)).foregroundStyle(Palette.muted)
            .padding(.top, Space.xl)
    }

    // MARK: results

    @ViewBuilder private func results(_ q: String) -> some View {
        let aisles = scope == .all ? store.aisles.filter { $0.label.localizedCaseInsensitiveContains(q) } : []
        let stores = scope == .deals ? [] : store.searchStores(q)
        let deals = scope == .stores ? [] : store.search(q)
        let byAisle = Dictionary(grouping: deals, by: \.category)

        Picker("Show", selection: $scope) {
            ForEach(Scope.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 420)
        .padding(.top, Space.m)

        // Ways to finish what's being typed, as chips over the results. They used to be the
        // system's suggestion list, which covered the results with a black page.
        let ideas = store.suggestions(q).filter { $0.caseInsensitiveCompare(q) != .orderedSame }
        if scope != .stores, !ideas.isEmpty {
            ChipRow {
                ForEach(ideas, id: \.self) { s in
                    FilterChip(s, systemImage: "magnifyingglass", isOn: false) { router.searchQuery = s; remember(s) }
                }
            }
            .padding(.top, Space.m)
        }

        // "pers", "fuyu", "hachiya": the season card first.
        if scope != .stores { SeasonSearchCards(query: q) }
        if !aisles.isEmpty {
            SectionHeading(title: "Aisles")
            ForEach(aisles) { c in
                NavigationLink(value: AisleRoute.aisle(c)) {
                    Tile(title: "\(AisleArt.emoji(c.id))  \(c.label)", line: "\(store.deals(inCategory: c.id).count) deals")
                }
                .buttonStyle(.plain)
            }
        }
        if !stores.isEmpty {
            SectionHeading(title: "Stores", note: "\(stores.count)")
            ForEach(stores) { s in
                NavigationLink(value: s) {
                    Tile(title: s.name, favorite: store.isFavorite(s.id),
                         line: "\(store.deals(atStore: s.id).count) deals this week", top: s.towns)
                }
                .buttonStyle(.plain)
            }
        }
        if !deals.isEmpty {
            // Grouped by aisle, in aisle order, so "pork" reads as Meat, then Frozen dumplings.
            ForEach(store.aisles.filter { byAisle[$0.id] != nil }) { c in
                let mine = byAisle[c.id] ?? []
                SectionHeading(title: c.label, note: mine.count == 1 ? "1 deal" : "\(mine.count) deals")
                ForEach(mine.prefix(25)) { d in
                    DealRow(deal: d) { remember(q); selected = d }
                }
            }
        }
        if aisles.isEmpty && stores.isEmpty && deals.isEmpty && (scope == .stores || store.seasons(matching: q).isEmpty) {
            if scope == .stores {
                // Stores only looks at store names and towns. With "Beef" typed it said
                // "Nothing in the paper for that" and offered to add beef to the list, while
                // All had 21 beef deals (the Nov 12 recording).
                EmptyState(.crow, mood: .surprised, title: Lines.noStoreTitle,
                           message: Lines.noStoreDetail(q), actionTitle: "Search everything", actionImage: "magnifyingglass") {
                    scope = .all
                }
                .padding(.top, Space.l)
            } else {
                EmptyState(.crow, mood: .surprised, title: Lines.pick(Lines.noResultsTitle),
                           message: Lines.noResultsDetail(q), actionTitle: "Add to list", actionImage: "plus") {
                    list.request(q)
                    Announce.say("Added \(q) to your list")
                    router.searchQuery = ""
                }
                .padding(.top, Space.l)
            }
        }
    }

    /// Keeps the last eight searches, newest first. Only on this iPhone, never sent anywhere.
    private func remember(_ query: String) {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { return }
        let next = [q] + recents.filter { $0.caseInsensitiveCompare(q) != .orderedSame }
        recentsRaw = next.prefix(8).joined(separator: "\n")
    }
}

// MARK: Spotlight

/// Puts this week's standouts and good deals in iPhone Spotlight, so "persimmon" from the Home
/// Screen shows "Fuyu Persimmon $1.48/lb · T&T". Replaced whenever the deals update; each item expires with
/// its sale. Only public deal data, nothing personal.
enum DealsSpotlight {
    static let domain = "deals.week"

    struct Entry: Sendable {
        let id: String
        let title: String
        let detail: String
        let keywords: [String]
        let expires: Date?
    }

    @MainActor
    static func update(_ store: FeedStore) {
        guard let feed = store.feed else { return }
        var entries = feed.items.filter { $0.tier != .sale }.prefix(500).map { d in
            Entry(id: d.id,
                  title: "\(shortName(d.name)) \(d.text)",
                  detail: ([store.storeName(d.store)] + (d.ends.map { ["through \(Dates.short($0))"] } ?? [])).joined(separator: " · "),
                  keywords: [d.name, store.storeName(d.store), store.label(forCategory: d.category)],
                  expires: Dates.date(d.ends ?? feed.end).map { $0.addingTimeInterval(86_400) })
        }
        entries += seasonEntries(store)
        let all = Array(entries)
        Task.detached(priority: .utility) { await index(all) }
    }

    private static func index(_ entries: [Entry]) async {
        let items = entries.map { e in
            let attrs = CSSearchableItemAttributeSet(contentType: .content)
            attrs.title = e.title
            attrs.contentDescription = e.detail
            attrs.keywords = e.keywords
            let item = CSSearchableItem(uniqueIdentifier: e.id, domainIdentifier: domain, attributeSet: attrs)
            if let expires = e.expires { item.expirationDate = expires }
            return item
        }
        let index = CSSearchableIndex.default()
        try? await index.deleteSearchableItems(withDomainIdentifiers: [domain])
        try? await index.indexSearchableItems(items)
    }
}

extension View {
    /// Opens a deal tapped in Spotlight, or a search continued from Spotlight.
    func handlesSpotlight(_ router: DealsRouter) -> some View {
        self
            .onContinueUserActivity(CSSearchableItemActionType) { activity in
                if let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String, id.hasPrefix("season:") {
                    router.openSeason(String(id.dropFirst("season:".count)))
                    Analytics.track("Opened From Spotlight", ["kind": "season"])
                } else if let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
                    router.dealID = id
                    Analytics.track("Opened From Spotlight")
                }
            }
            .onContinueUserActivity(CSQueryContinuationActionType) { activity in
                if let q = activity.userInfo?[CSSearchQueryString] as? String { router.search(q) }
            }
    }
}

/// "12 people added this", small and muted, under a popular deal.
struct PeopleCount: View {
    let people: Int
    init(_ people: Int) { self.people = people }
    var body: some View {
        Label("\(people) people added this", systemImage: "person.2.fill")
            .font(.app(.caption, .semibold))
            .foregroundStyle(Palette.muted)
            .labelStyle(.titleAndIcon)
            .accessibilityLabel("\(people) people added this this week")
    }
}
