import SwiftUI

/// The edition banners at the top of This week: fresh on Friday, a heads-up when the week is
/// ending, and an honest note when we're offline.
struct EditionBanner: View {
    @Environment(FeedStore.self) private var store
    @AppStorage("sgd.seenEdition") private var seenEdition = ""
    @State private var hop = 0

    var body: some View {
        if let feed = store.feed {
            VStack(spacing: Space.s) {
                if store.offline {
                    Button { Task { await store.refresh() } } label: {
                        Label(Lines.offline(Dates.short(feed.week, weekday: false)), systemImage: "wifi.slash")
                            .font(.app(.subheadline, .semibold))
                            .foregroundStyle(Palette.text(.warn))
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, Space.m)
                            .background(Palette.fill(.warn), in: RoundedRectangle(cornerRadius: Radius.medium))
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Tries again")
                }
                if let left = store.daysLeft, left <= 0 {
                    note(.sleepy, Lines.staleTitle, Lines.staleDetail)
                } else if seenEdition != feed.week {
                    Card(padding: Space.l) {
                        HStack(spacing: Space.m) {
                            Buddy(.persimmon, mood: .happy, size: 64, hop: hop).hiddenWhenTextIsLarge()
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Lines.freshTitle).font(.app(.title3, .heavy)).foregroundStyle(Palette.ink)
                                Text(Lines.freshDetail(Dates.short(feed.week, weekday: false), deals: store.items.count,
                                                       stores: feed.stores.filter(\.readThisWeek).count))
                                    .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                            }
                            Spacer(minLength: 0)
                            Button("Got it", systemImage: "xmark") { withAnimation { seenEdition = feed.week } }
                                .labelStyle(.iconOnly)
                                .buttonStyle(.bordered).buttonBorderShape(.circle)
                                .tint(Palette.muted)
                                .frame(minWidth: 44, minHeight: 44)
                        }
                    }
                    .stampOnAppear()
                    .onAppear { hop += 1 }
                    .sensoryFeedback(.impact(weight: .medium), trigger: hop)
                } else if let left = store.daysLeft, left <= 2 {
                    note(.neutral, Lines.nextTitle, Lines.nextDetail)
                }
            }
            .padding(.top, Space.s)
        }
    }

    private func note(_ mood: Buddy.Mood, _ title: String, _ detail: String) -> some View {
        Card(padding: Space.m) {
            HStack(spacing: Space.m) {
                Buddy(.persimmon, mood: mood, size: 48).hiddenWhenTextIsLarge()
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.app(.headline)).foregroundStyle(Palette.ink)
                    Text(detail).font(.app(.subheadline)).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Price watches that hit this week, at the top of This week.
struct WatchHits: View {
    @Environment(FeedStore.self) private var store
    @Environment(AlertsStore.self) private var alerts
    let select: (Deal) -> Void

    var body: some View {
        let hits = store.feed.map { feed in alerts.watches.compactMap { alerts.hit($0, in: feed.items) } } ?? []
        if !hits.isEmpty {
            SectionHeading(title: Lines.watchesTitle, note: hits.count == 1 ? "1 hit" : "\(hits.count) hits")
            ForEach(hits.prefix(3)) { d in
                DealRow(deal: d) { select(d) }
            }
        }
    }
}

/// Placeholder rows while the very first week loads.
struct LoadingDeals: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WorkingView(.persimmon, title: Lines.pick(Lines.loading), compact: true)
                .padding(.vertical, Space.l)
            ForEach(0..<6, id: \.self) { _ in
                HStack(spacing: Space.m) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Standout").font(.app(.caption))
                        Text("Fuyu persimmons, jumbo").font(.app(.headline))
                        Text("Store · details").font(.app(.subheadline))
                    }
                    Spacer()
                    Text("$1.99/lb").font(.app(.title3, .bold))
                }
                .padding(.vertical, Space.m)
            }
            .redacted(reason: .placeholder)
            .shimmer()
            .accessibilityHidden(true)
        }
    }
}
