import SwiftUI

/// Screen background and side margins shared by every tab.
private struct Page<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) { content }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
        }
        .background(Theme.paper)
    }
}

private struct VegToggle: View {
    @Environment(FeedStore.self) private var store
    var body: some View {
        @Bindable var store = store
        Toggle(isOn: $store.vegetarianOnly) {
            Text("Vegetarian only").font(.body(17, bold: true)).foregroundStyle(Theme.ink)
        }
        .tint(Theme.brand)
        .padding(.top, 8)
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
                        .font(.body(15)).foregroundStyle(Theme.muted)
                    VegToggle()
                    if query.isEmpty {
                        SectionHeading(title: "Best this week", note: "\(store.standouts.count) standouts")
                        ForEach(store.standouts.prefix(20)) { d in
                            Button { selected = d } label: { DealRow(deal: d, showWhy: true) }.buttonStyle(.plain)
                        }
                    } else {
                        let results = store.search(query)
                        SectionHeading(title: "\(results.count) found")
                        ForEach(results.prefix(100)) { d in
                            Button { selected = d } label: { DealRow(deal: d) }.buttonStyle(.plain)
                        }
                        if results.isEmpty {
                            Text("Nothing matches. Try a shorter word or a store name.").font(.body(16)).foregroundStyle(Theme.muted).padding(.top, 16)
                        }
                    }
                }
            }
            .navigationTitle("This week")
            .searchable(text: $query, prompt: "Deals and stores")
            .refreshable { await store.refresh() }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore) }
        }
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
                        Button { selected = d } label: { DealRow(deal: d) }.buttonStyle(.plain)
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
                let stores = (store.feed?.stores ?? []).sorted {
                    let a = store.deals(atStore: $0.id).filter { $0.tier == .standout }.count
                    let b = store.deals(atStore: $1.id).filter { $0.tier == .standout }.count
                    return a != b ? a > b : store.deals(atStore: $0.id).count > store.deals(atStore: $1.id).count
                }
                ForEach(stores) { s in
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
                    .font(.body(15)).foregroundStyle(Theme.muted)
                if let ad = s.flyer_url.flatMap(URL.init(string:)) {
                    Button { openURL(ad) } label: {
                        Label("See \(s.name)'s weekly ad", systemImage: "arrow.up.right").font(.body(17, bold: true)).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glassProminent).tint(Theme.ink)
                }
                Text(s.about).font(.body(16)).foregroundStyle(Theme.muted)
                if let delivery = s.delivery {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Delivery").font(.body(16, bold: true))
                        Text(delivery).font(.body(16))
                    }
                    .foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.lineUI, lineWidth: 1.5))
                }
                VegToggle()
            }
            .padding(.top, 8)
            let deals = store.deals(atStore: s.id)
            SectionHeading(title: "This week", note: "\(deals.count) deals")
            ForEach(deals) { d in
                Button { selected = d } label: { DealRow(deal: d, showStore: false) }.buttonStyle(.plain)
            }
        }
        .navigationTitle(s.name)
        .sheet(item: $selected) { DealDetail(deal: $0) }
    }
}

/// A bordered card used for aisles and stores.
struct Tile: View {
    let title: String
    var chip: String? = nil
    let line: String
    var top: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title.uppercased()).font(.display(24)).foregroundStyle(Theme.ink)
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.muted)
            }
            if let chip {
                Text(chip).font(.body(12, bold: true, relativeTo: .caption)).padding(.horizontal, 8).padding(.vertical, 1)
                    .overlay(Capsule().strokeBorder(Theme.ink, lineWidth: 1.5)).foregroundStyle(Theme.ink)
            }
            Text(line).font(.body(15)).foregroundStyle(Theme.muted)
            if let top, !top.isEmpty { Text(top).font(.body(15)).foregroundStyle(Theme.ink).lineLimit(2) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.lineUI, lineWidth: 1.5))
        .padding(.top, 10)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Coming in stage 2

struct ComingSoon: View {
    let title: String
    let text: String
    var body: some View {
        NavigationStack {
            Page {
                Text(text).font(.body(17)).foregroundStyle(Theme.muted).padding(.top, 12)
            }
            .navigationTitle(title)
        }
    }
}
