import AppIntents
import SwiftUI
import WidgetKit

/// The Best This Week widget: the week's best deals at Your stores, loaded straight from the
/// site's feed. Which stores are yours, and the Vegetarian and "Not ending today" switches,
/// come from the app through the App Group (Shared/SharedState.swift). With no stores picked,
/// or none of them having a deal worth showing, it's the best across every store.
struct DealsEntry: TimelineEntry {
    let date: Date
    let week: String?
    let deals: [Deal]
    let stores: [String: String]
    /// True when the deals are only from Your stores.
    var yours = false
}

struct DealsProvider: TimelineProvider {
    func placeholder(in context: Context) -> DealsEntry { DealsEntry(date: .now, week: nil, deals: [], stores: [:]) }

    func getSnapshot(in context: Context, completion: @escaping (DealsEntry) -> Void) {
        nonisolated(unsafe) let done = completion
        Task { done(await Self.load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DealsEntry>) -> Void) {
        nonisolated(unsafe) let done = completion
        Task {
            let entry = await Self.load()
            // Stores post new flyers on their own days and the site picks each one up within
            // the hour, so check hourly (well inside WidgetKit's daily refresh budget).
            done(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(3600))))
        }
    }

    private static func load() async -> DealsEntry {
        guard let (data, _) = try? await URLSession.shared.data(from: URL(string: "https://seattlegrocery.deals/api/week.json")!),
              let feed = try? JSONDecoder().decode(Feed.self, from: data) else {
            return DealsEntry(date: .now, week: nil, deals: [], stores: [:])
        }
        let mine = SharedState.read()
        let picked = pick(feed.items, mine)
        return DealsEntry(date: .now, week: feed.week, deals: picked.deals,
                          stores: Dictionary(feed.stores.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a }), yours: picked.yours)
    }

    /// The four to show: sales still on, after the app's filters, standouts before good deals,
    /// at most two from any one store. From Your stores when they have any; otherwise from
    /// every store. The feed is already best first.
    static func pick(_ items: [Deal], _ mine: SharedState) -> (deals: [Deal], yours: Bool) {
        let live = items.filter { d in
            let left = d.daysLeft ?? 99
            return left >= (mine.hideEndingToday ? 2 : 1) && (!mine.vegetarianOnly || d.veg)
        }
        func best(_ pool: [Deal]) -> [Deal] {
            var taken: [String: Int] = [:]
            let ordered = pool.filter { $0.tier == .standout } + pool.filter { $0.tier == .good }
            return Array(ordered.filter { d in
                taken[d.store, default: 0] += 1
                return taken[d.store]! <= 2
            }.prefix(4))
        }
        let stores = Set(mine.stores)
        let yours = stores.isEmpty ? [] : best(live.filter { stores.contains($0.store) })
        return yours.isEmpty ? (best(live), false) : (yours, true)
    }
}

struct DealsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: DealsEntry

    private func storeName(_ d: Deal) -> String { entry.stores[d.store] ?? d.store }
    private func price(_ d: Deal) -> String { d.amount + (d.unit.isEmpty ? "" : d.unit) }

    var body: some View {
        switch family {
        case .accessoryInline: inline
        case .accessoryRectangular: rectangular
        default: home
        }
    }

    /// Above the clock: "Persimmons $1.28/lb · T&T Supermarket"
    @ViewBuilder private var inline: some View {
        if let d = entry.deals.first {
            Label("\(shortened(d.name)) \(price(d)) · \(storeName(d))", systemImage: "tag.fill")
                .accessibilityLabel("\(d.name), \(storeName(d)), \(d.spoken)")
        } else {
            Label("Deals", systemImage: "tag.fill")
        }
    }

    /// Under the clock: the best deal at Your stores, three lines.
    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let d = entry.deals.first {
                Text(entry.yours ? "Best at your stores" : "Best this week")
                    .font(.app(.caption2, .semibold)).widgetAccentable()
                Text("\(shortened(d.name)) \(price(d))").font(.app(.headline)).lineLimit(1).minimumScaleFactor(0.8)
                Text(storeName(d)).font(.app(.caption)).lineLimit(1)
            } else {
                Text("Deals").font(.app(.headline))
                Text("Open to load this week's flyers.").font(.app(.caption))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.deals.first.map { "\(entry.yours ? "Best at your stores" : "Best this week"): \($0.name), \(storeName($0)), \($0.spoken)" } ?? "Deals")
        .containerBackground(.clear, for: .widget)
    }

    /// "Fuyu Persimmon, Large" -> "Fuyu Persimmon": the Lock Screen has room for a few words.
    private func shortened(_ name: String) -> String {
        String(name.split(whereSeparator: { $0 == "," || $0 == "(" }).first ?? Substring(name)).trimmingCharacters(in: .whitespaces)
    }

    private var home: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(entry.yours ? "BEST AT YOUR STORES" : "BEST THIS WEEK").font(.app(13, .heavy, relativeTo: .caption)).tracking(0.6).foregroundStyle(Palette.accent)
                Spacer()
                if let week = entry.week { Text(Dates.short(week, weekday: false)).font(.app(.caption2)).foregroundStyle(Palette.muted) }
            }
            if entry.deals.isEmpty {
                Text("Open Deals to load this week's flyers.").font(.app(.caption)).foregroundStyle(Palette.muted)
            }
            ForEach(entry.deals.prefix(family == .systemSmall ? 1 : family == .systemMedium ? 3 : 4)) { d in
                if family == .systemSmall {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.name).font(.app(14, .bold, relativeTo: .subheadline)).lineLimit(2)
                        Text(entry.stores[d.store] ?? d.store).font(.app(.caption2)).foregroundStyle(Palette.muted)
                        Spacer(minLength: 0)
                        Text(d.amount + (d.unit.isEmpty ? "" : d.unit)).font(.app(26, .bold, relativeTo: .title)).monospacedDigit()
                            .minimumScaleFactor(0.7).lineLimit(1)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(d.name), \(entry.stores[d.store] ?? d.store), \(d.spoken)")
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(d.name).font(.app(13, .bold, relativeTo: .footnote)).lineLimit(1)
                            Text(entry.stores[d.store] ?? d.store).font(.app(.caption2)).foregroundStyle(Palette.muted).lineLimit(1)
                        }
                        Spacer()
                        Text(d.amount + (d.unit.isEmpty ? "" : d.unit)).font(.app(18, .bold, relativeTo: .headline)).monospacedDigit()
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(d.name), \(entry.stores[d.store] ?? d.store), \(d.spoken)")
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Palette.ink)
        .containerBackground(Palette.ground, for: .widget)
        .widgetURL(DealsLink.tab("week"))
    }
}

struct DealsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BestDeals", provider: DealsProvider()) { DealsWidgetView(entry: $0) }
            .configurationDisplayName("Best This Week")
            .description("The best deals at your stores this week, or across every store if you haven't picked any.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: the list

/// Your grocery list, with what's on sale this week marked. The app writes the open items and
/// their sale prices to the App Group whenever the list or the deals change, so this widget
/// never touches the network or Reminders. A list kept in Reminders catches up the next time
/// the app is opened.
struct ListEntry: TimelineEntry {
    let date: Date
    let title: String
    let lines: [SharedState.Line]
    var onSale: Int { lines.filter { $0.sale != nil }.count }
}

struct ListProvider: TimelineProvider {
    func placeholder(in context: Context) -> ListEntry { ListEntry(date: .now, title: "Groceries", lines: []) }
    func getSnapshot(in context: Context, completion: @escaping (ListEntry) -> Void) { completion(Self.load()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ListEntry>) -> Void) {
        // The app reloads this when the list changes. On its own it only needs a fresh look
        // after midnight, when a sale may have ended.
        let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400))
        completion(Timeline(entries: [Self.load()], policy: .after(midnight.addingTimeInterval(60))))
    }

    private static func load() -> ListEntry {
        let state = SharedState.read()
        // A sale that ended since the app last wrote the list is no longer one.
        let lines = state.list.map { line -> SharedState.Line in
            var line = line
            if let left = Dates.daysLeft(through: line.ends), left <= 0 { line.sale = nil }
            return line
        }
        return ListEntry(date: .now, title: state.listTitle, lines: lines)
    }
}

struct ListWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ListEntry

    /// Items on sale first: they're the reason to look.
    private var ordered: [SharedState.Line] { entry.lines.filter { $0.sale != nil } + entry.lines.filter { $0.sale == nil } }
    private var summary: String {
        entry.lines.isEmpty ? "Nothing on your list" : entry.onSale == 0 ? "\(entry.lines.count) to get" : "\(entry.onSale) of \(entry.lines.count) on sale"
    }

    var body: some View {
        if family == .accessoryRectangular { lock } else { home }
    }

    private var lock: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(summary).font(.app(.caption2, .semibold)).widgetAccentable()
            ForEach(ordered.prefix(2)) { line in
                Text(line.sale.map { "\(line.text) \(Self.price($0))" } ?? line.text).font(.app(.caption)).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .containerBackground(.clear, for: .widget)
        .widgetURL(DealsLink.tab("list"))
    }

    private var home: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(entry.title.uppercased()).font(.app(13, .heavy, relativeTo: .caption)).tracking(0.6).foregroundStyle(Palette.accent).lineLimit(1)
                    Text(summary).font(.app(.caption2)).foregroundStyle(Palette.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                // Opens the List tab with the keyboard up.
                Link(destination: URL(string: "\(DealsLink.scheme)://add")!) {
                    Image(systemName: "plus.circle.fill").font(.app(.title2)).foregroundStyle(Palette.accent)
                        .frame(minWidth: 44, minHeight: 32, alignment: .trailing)
                }
                .accessibilityLabel("Add an item")
            }
            if entry.lines.isEmpty {
                Text("Add what you need and this shows what's on sale.").font(.app(.caption)).foregroundStyle(Palette.muted)
            }
            ForEach(ordered.prefix(family == .systemSmall ? 3 : family == .systemMedium ? 3 : 8)) { line in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: line.sale == nil ? "circle" : "tag.fill").imageScale(.small)
                        .foregroundStyle(line.sale == nil ? Palette.muted : Palette.accent)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(line.text).font(.app(13, .bold, relativeTo: .footnote)).lineLimit(1)
                        if let sale = line.sale, family != .systemSmall {
                            Text(sale).font(.app(.caption2)).foregroundStyle(Palette.muted).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    if let sale = line.sale, family == .systemSmall {
                        Text(Self.price(sale)).font(.app(.caption, .bold)).monospacedDigit().lineLimit(1)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(line.sale.map { "\(line.text), on sale, \($0)" } ?? line.text)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Palette.ink)
        .containerBackground(Palette.ground, for: .widget)
        .widgetURL(DealsLink.tab("list"))
    }

    /// "$1.28/lb at T&T Supermarket" -> "$1.28/lb"
    private static func price(_ sale: String) -> String { sale.components(separatedBy: " at ").first ?? sale }
}

struct ListWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "List", provider: ListProvider()) { ListWidgetView(entry: $0) }
            .configurationDisplayName("Grocery List")
            .description("Your list, with what's on sale this week first.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}

// MARK: Control Center, the Lock Screen and the Action button

/// One button that opens Deals on the List tab with the keyboard up (Shared/AddToListControl.swift).
struct AddToListControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "deals.seattlegrocery.add") {
            ControlWidgetButton(action: OpenAddToListIntent()) {
                Label("Add to List", systemImage: "cart.badge.plus")
            }
        }
        .displayName("Add to Grocery List")
        .description("Opens Deals on your list, ready to type an item.")
    }
}

@main
struct DealsWidgets: WidgetBundle {
    init() {
        KitchenUI.registerFonts()
        Palette.use(.rain, neutrals: .harbor)
    }
    var body: some Widget {
        DealsWidget()
        ListWidget()
        AddToListControl()
    }
}
