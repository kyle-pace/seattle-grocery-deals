import SwiftUI
import WidgetKit

/// Home screen widget: the week's best deals, loaded straight from the site's feed so it
/// needs no data shared with the app.
struct DealsEntry: TimelineEntry {
    let date: Date
    let week: String?
    let deals: [Deal]
    let stores: [String: String]
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
            // New weeks post on Fridays; checking every few hours is plenty.
            done(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(4 * 3600))))
        }
    }

    private static func load() async -> DealsEntry {
        guard let (data, _) = try? await URLSession.shared.data(from: URL(string: "https://seattlegrocery.deals/api/week.json")!),
              let feed = try? JSONDecoder().decode(Feed.self, from: data) else {
            return DealsEntry(date: .now, week: nil, deals: [], stores: [:])
        }
        return DealsEntry(date: .now, week: feed.week, deals: Array(feed.items.filter { $0.tier == .standout }.prefix(4)),
                          stores: Dictionary(feed.stores.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a }))
    }
}

struct DealsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: DealsEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("BEST THIS WEEK").font(.custom("BarlowCondensed-Bold", size: 15)).foregroundStyle(Theme.brand)
                Spacer()
                if let week = entry.week { Text(Dates.short(week, weekday: false)).font(.caption2).foregroundStyle(Theme.muted) }
            }
            if entry.deals.isEmpty {
                Text("Open Deals to load this week's flyers.").font(.caption).foregroundStyle(Theme.muted)
            }
            ForEach(entry.deals.prefix(family == .systemSmall ? 1 : family == .systemMedium ? 3 : 4)) { d in
                if family == .systemSmall {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.name).font(.custom("AtkinsonHyperlegible-Bold", size: 14)).lineLimit(2)
                        Text(entry.stores[d.store] ?? d.store).font(.caption2).foregroundStyle(Theme.muted)
                        Spacer(minLength: 0)
                        Text(d.amount + (d.unit.isEmpty ? "" : d.unit)).font(.custom("BarlowCondensed-Bold", size: 30))
                            .padding(.horizontal, 6).background(Theme.tag).foregroundStyle(Theme.onTag)
                    }
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(d.name).font(.custom("AtkinsonHyperlegible-Bold", size: 13)).lineLimit(1)
                            Text(entry.stores[d.store] ?? d.store).font(.caption2).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        Spacer()
                        Text(d.amount + (d.unit.isEmpty ? "" : d.unit)).font(.custom("BarlowCondensed-Bold", size: 20))
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(Theme.ink)
        .containerBackground(Theme.paper, for: .widget)
    }
}

struct DealsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BestDeals", provider: DealsProvider()) { DealsWidgetView(entry: $0) }
            .configurationDisplayName("Best This Week")
            .description("The biggest standouts in this week's Seattle grocery flyers.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct DealsWidgets: WidgetBundle {
    var body: some Widget { DealsWidget() }
}
