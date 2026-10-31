import SwiftUI

// Seasonal items (persimmons first): a card on This week while one is on and on sale, a season
// screen like the web page (/persimmons/), a row at the top of Search, and an entry in iPhone
// Spotlight. Everything comes from the feed's `seasons` (scripts/build.mjs, seasonFeed()), so a new
// item needs no app update, only a character in KitchenUI if it should have one (until then it
// gets a leaf). Several items at once show as a row of cards you swipe through.

// MARK: store

extension FeedStore {
    /// Every season on this week: the feed's, or the dev menu's samples.
    var allSeasons: [Season] {
        devSampleSeasons > 0 ? sampleSeasons(devSampleSeasons) : (feed?.seasons?.items ?? [])
    }

    /// The seasons to show on This week: on sale this week (after the vegetarian filter), not
    /// hidden, in the feed's order.
    var seasons: [Season] {
        allSeasons.filter { bestDeal($0) != nil && !hiddenSeasons.contains(Self.hideKey($0)) }
    }

    func season(_ id: String) -> Season? { allSeasons.first { $0.id == id } }

    /// A deal from this week by id, after the vegetarian filter.
    func deal(_ id: String?) -> Deal? {
        guard let id else { return nil }
        return items.first { $0.id == id }
    }

    func bestDeal(_ s: Season) -> Deal? { deal(s.best) }
    func deals(_ ids: [String]) -> [Deal] { ids.compactMap { deal($0) } }

    /// "Hide for this season": until the season's last day, then it comes back next year.
    func hideSeason(_ s: Season) {
        hiddenSeasons.insert(Self.hideKey(s))
        Analytics.track("Hid Season Card", ["season": s.id])
    }

    static func hideKey(_ s: Season) -> String { "\(s.id)@\(s.ends)" }

    /// Seasons a search is about: "pers", "fuyu", "hachiya" all find persimmons.
    func seasons(matching query: String) -> [Season] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard q.count >= 3 else { return [] }
        return seasons.filter { s in
            ([s.label, s.item, s.star ?? "", s.name] + (s.words ?? [])).map { $0.lowercased() }
                .contains { !$0.isEmpty && ($0.hasPrefix(q) || q.contains($0)) }
        }
    }

    // MARK: dev samples

    /// One or two made-up seasons from this week's deals, so the card, the row of cards and the
    /// screen can be tried outside the season. The first is persimmons when the feed has it.
    private func sampleSeasons(_ count: Int) -> [Season] {
        var out: [Season] = []
        if let real = feed?.seasons?.items.first { out.append(real) }
        let produce = (feed?.items ?? []).filter { $0.category == "produce" && $0.unit_price != nil }
        if out.isEmpty, let p = produce.first {
            out.append(Self.sample(id: "sample-persimmon", label: "Persimmons", buddy: "persimmon", tint: ("#f07c1e", "#f07c1e"), deals: [p] + produce.dropFirst().prefix(3)))
        }
        let others = produce.filter { d in !out.contains { $0.best == d.id || $0.also.contains(d.id) } }
        if out.count < count, let p = others.first {
            out.append(Self.sample(id: "sample-leaf", label: shortName(p.name), buddy: nil, tint: ("#2f7a4f", "#5fae86"), deals: Array(others.prefix(3))))
        }
        return Array(out.prefix(count))
    }

    private static func sample(id: String, label: String, buddy: String?, tint: (String, String), deals: [Deal]) -> Season {
        let best = deals[0]
        return Season(
            id: id, label: label, name: "\(label) season (sample)", item: label.lowercased(), star: nil, buddy: buddy,
            url: "https://seattlegrocery.deals/", ends: "2099-12-31", tint: .init(light: tint.0, dark: tint.1),
            best: best.id, also: deals.dropFirst().map(\.id), other: [], stores: Set(deals.map(\.store)).count, about: nil,
            per_10: nil, per_10_note: nil,
            log: [.init(week: "2026-10-16", value: 2.4, text: "$2.40/lb", store: best.store, about: false),
                  .init(week: "2026-10-23", value: 1.9, text: "$1.90/lb", store: best.store, about: false)],
            words: nil, tagline: "A sample from the dev menu, made from this week's deals.",
            facts: ["**Samples** are made from this week's produce.", "Turn them off in the dev menu."],
            share: nil, copy: nil)
    }
}

// MARK: This week

/// The season cards on This week: one card, or a row of cards to swipe through when more than
/// one item is in season.
struct SeasonCards: View {
    @Environment(FeedStore.self) private var store

    var body: some View {
        let seasons = store.seasons
        if seasons.count == 1, let s = seasons.first {
            SeasonCardButton(season: s)
                .padding(.top, Space.m)
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
        } else if seasons.count > 1 {
            SectionHeading(title: "In season", note: "\(seasons.count) items")
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: Space.m) {
                    ForEach(seasons) { s in
                        SeasonCardButton(season: s, fill: true)
                            .containerRelativeFrame(.horizontal) { width, _ in width * 0.86 }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
    }
}

/// One season's card. Opens the season screen; long-press to share or hide it for the season.
struct SeasonCardButton: View {
    @Environment(FeedStore.self) private var store
    let season: Season
    /// Stretch to the tallest card in a row.
    var fill = false
    var place = "week"
    @State private var hop = 0

    /// Seasons whose card already hopped and was counted since launch, so scrolling doesn't
    /// repeat the hop, the haptic or the "Viewed" event.
    @MainActor private static var seen: Set<String> = []

    var body: some View {
        if let best = store.bestDeal(season) {
            Button {
                Analytics.track("Tapped Season Card", ["season": season.id, "place": place, "store": best.store])
                DealsRouter.shared.openSeason(season.id)
            } label: {
                SeasonCard(season.kind, eyebrow: season.name, title: headline(best), detail: detail(best), tint: season.color, hop: hop)
                    .frame(maxHeight: fill ? .infinity : nil, alignment: .top)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(spoken(best))
            .accessibilityHint("Opens \(season.name.lowercased())")
            .accessibilityAction(named: "Hide for this season") { hide() }
            .contextMenu {
                if let url = season.webURL {
                    ShareLink(item: url, message: Text(season.share ?? season.name)) { Label("Share", systemImage: "square.and.arrow.up") }
                }
                Button("Hide for this season", systemImage: "eye.slash") { hide() }
            }
            .onAppear {
                let key = "\(place):\(season.id)"
                guard !Self.seen.contains(key) else { return }
                Self.seen.insert(key)
                hop += 1
                Analytics.track("Viewed Season Card", ["season": season.id, "place": place, "store": best.store])
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: hop)
        }
    }

    /// "Fuyu $1.28/lb at T&T Supermarket"
    private func headline(_ d: Deal) -> String { "\(season.star ?? season.label) \(d.text) at \(store.storeName(d.store))" }

    /// "Through Thu · about 17 for $10", or "Through Thu · 6 stores have them"
    private func detail(_ d: Deal) -> String {
        var parts: [String] = []
        if let day = Dates.date(d.ends) { parts.append("Through \(day.formatted(.dateTime.weekday(.abbreviated)))") }
        if let n = season.per_10 { parts.append("about \(n) for $10") }
        else if season.stores > 1 { parts.append("\(season.stores) stores have them") }
        return parts.joined(separator: " · ")
    }

    private func spoken(_ d: Deal) -> String {
        var parts = [season.name, "\(season.star ?? season.label), \(d.spoken), at \(store.storeName(d.store))"]
        if let day = Dates.date(d.ends) { parts.append("Through \(day.formatted(.dateTime.weekday(.wide)))") }
        if let n = season.per_10 { parts.append("About \(n) for 10 dollars") }
        return parts.joined(separator: ". ")
    }

    private func hide() {
        withAnimation(.snappy) { store.hideSeason(season) }
        Announce.say("Hidden until next \(season.name.lowercased())")
    }
}

// MARK: Season screen

/// Like the web page: the best deal with the big buddy, the rest on sale, other kinds, the price
/// log and the facts. Tap the buddy for falling fruit. Opens as a sheet from anywhere.
struct SeasonScreen: View {
    @Environment(FeedStore.self) private var store
    @Environment(AlertsStore.self) private var alerts
    @Environment(\.dismiss) private var dismiss
    let season: Season
    var openStore: ((String) -> Void)? = nil

    @State private var hop = 0
    @State private var drops = 0
    @State private var selected: Deal?
    @State private var priming = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    hero
                    let also = store.deals(season.also)
                    if !also.isEmpty {
                        SectionHeading(title: season.copy?.also_title ?? "Also on sale", note: "\(also.count)")
                        ForEach(also) { d in row(d) }
                    }
                    let other = store.deals(season.other)
                    if !other.isEmpty {
                        SectionHeading(title: season.copy?.others_title ?? "Other \(season.item)", note: "\(other.count)")
                        if let note = season.copy?.others_note, !note.isEmpty {
                            Text(note).font(.app(.subheadline)).foregroundStyle(Palette.body).padding(.bottom, Space.xs)
                        }
                        ForEach(other) { d in row(d) }
                    }
                    if season.log.count > 1 { priceLog }
                    if !season.facts.isEmpty { facts }
                    Button { dropMore() } label: {
                        Label("Tap the \(season.kind == nil ? "leaf" : season.item.replacingOccurrences(of: #"s$"#, with: "", options: .regularExpression)) for more", systemImage: "hand.tap")
                            .font(.app(.footnote)).foregroundStyle(Palette.muted)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, Space.xl)
                    .accessibilityHidden(true)
                }
                .padding(.horizontal, Space.l)
                .padding(.bottom, Space.xl)
            }
            .background {
                LinearGradient(colors: [season.color.opacity(0.16), Palette.ground], startPoint: .top, endPoint: .center)
                    .background(Palette.ground)
                    .ignoresSafeArea()
            }
            .fallingBuddies(season.kind, trigger: drops)
            .navigationTitle(season.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
                if let url = season.webURL {
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: url, message: Text(season.share ?? season.name)) {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                        .simultaneousGesture(TapGesture().onEnded { Analytics.track("Shared Season", ["season": season.id]) })
                    }
                }
            }
            .sheet(item: $selected) { DealDetail(deal: $0, openStore: openStore == nil ? nil : openStoreClosing) }
            .sheet(isPresented: $priming) {
                if let best = store.bestDeal(season) {
                    AlertPrimer(deal: best) { allowed in
                        priming = false
                        if allowed { startWatching(best) }
                    }
                }
            }
        }
        .presentationBackground(Palette.ground)
        .onAppear {
            Analytics.track("Viewed Season", ["season": season.id])
            Task { try? await Task.sleep(for: .milliseconds(450)); dropMore() }
        }
    }

    // MARK: hero

    @ViewBuilder private var hero: some View {
        let best = store.bestDeal(season)
        VStack(spacing: Space.s) {
            Button { dropMore() } label: {
                SeasonMark(season.kind, mood: best == nil ? .sad : .happy, size: 132, tint: season.color, hop: hop)
                    .rotationEffect(.degrees(best == nil ? 8 : 0))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("More \(season.item)")
            .accessibilityHint("Drops a few for fun")
            .padding(.top, Space.l)

            if let best {
                Text((season.copy?.kicker ?? "The best \(season.starLabel) deal this week").uppercased())
                    .font(.app(.caption, .bold)).tracking(0.8)
                    .foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.center)
                PriceTag(deal: best, size: 56, relativeTo: .largeTitle)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                Button { openStoreClosing(best.store) } label: {
                    Text("at \(store.storeName(best.store))\(best.ends.map { ", through \(Dates.short($0))" } ?? "")")
                        .font(.app(.title3, .semibold)).foregroundStyle(Palette.ink)
                        .multilineTextAlignment(.center)
                }
                .buttonStyle(.plain)
                .disabled(openStore == nil)
                .accessibilityHint(openStore == nil ? "" : "Opens the store")
                Text(best.name).font(.app(.subheadline)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                if let n = season.per_10 {
                    VStack(spacing: 2) {
                        Text("That's about **\(n) \(season.item) for $10**.").font(.app(.callout)).foregroundStyle(Palette.ink)
                        if let note = season.per_10_note { Text(note).font(.app(.footnote)).foregroundStyle(Palette.muted) }
                    }
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Space.m).padding(.vertical, Space.s)
                    .frame(maxWidth: .infinity)
                    .background(season.color.opacity(0.14), in: RoundedRectangle(cornerRadius: Radius.medium))
                    .accessibilityElement(children: .combine)
                    .padding(.top, Space.xs)
                }
                actions(best).padding(.top, Space.s)
            } else {
                Text(season.copy?.none_title ?? "No \(season.starLabel) on sale this week.")
                    .font(.app(.title2, .heavy)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
                Text(season.copy?.none_line ?? "Check back Friday.")
                    .font(.app(.body)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(Space.l)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 28))
        .overlay(RoundedRectangle(cornerRadius: 28).strokeBorder(season.color, lineWidth: 3))
        .padding(.top, Space.m)
    }

    private func actions(_ best: Deal) -> some View {
        let w = alerts.watching(best)
        return AdaptiveStack(spacing: Space.s) {
            if unitValue(best) != nil {
                Button {
                    if let w {
                        alerts.unwatch(w)
                        Announce.say("Stopped watching \(season.starLabel) prices")
                    } else {
                        Task { if await alerts.needsAsking() { priming = true } else { startWatching(best) } }
                    }
                } label: {
                    Label(w == nil ? "Watch \(season.starLabel) prices" : "Watching \(season.starLabel)", systemImage: w == nil ? "bell" : "bell.fill")
                        .font(.app(.subheadline, .semibold)).frame(maxWidth: .infinity, minHeight: 44)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.glassProminent)
                .tint(Palette.accent)
                .accessibilityHint(w.map { "Alerts you under \($0.label). Tap to stop." } ?? "Alerts you if it gets cheaper than \(best.text)")
            }
            Button { selected = best } label: {
                Label("See the deal", systemImage: "tag").font(.app(.subheadline, .semibold)).frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.glass)
        }
    }

    private func startWatching(_ best: Deal) {
        Task {
            _ = await alerts.allow()
            alerts.watch(best, week: store.feed?.week)
            Analytics.track("Watched Season", ["season": season.id])
            Announce.say("Watching \(season.starLabel) prices")
        }
    }

    private func row(_ d: Deal) -> some View {
        DealRow(deal: d, note: season.about?[d.id].map { "about \($0)" }) { selected = d }
    }

    // MARK: price log

    private var priceLog: some View {
        let top = max(season.log.map(\.value).max() ?? 1, 0.01)
        return VStack(alignment: .leading, spacing: Space.s) {
            SectionHeading(title: season.copy?.log_title ?? "The price log")
            if let note = season.copy?.log_note { Text(note).font(.app(.subheadline)).foregroundStyle(Palette.body) }
            ForEach(season.log.reversed()) { e in
                HStack(alignment: .center, spacing: Space.s) {
                    Text(Dates.short(e.week, weekday: false))
                        .font(.app(.footnote, .semibold)).foregroundStyle(Palette.muted)
                        .frame(width: 52, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        GeometryReader { geo in
                            Capsule().fill(season.color)
                                .frame(width: max(geo.size.width * e.value / top, 8))
                        }
                        .frame(height: 10)
                        Text("\(e.text) · \(store.storeName(e.store))")
                            .font(.app(.footnote)).foregroundStyle(Palette.ink)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Week of \(Dates.short(e.week, weekday: false)): \(e.text) at \(store.storeName(e.store))")
            }
        }
    }

    // MARK: facts

    private var facts: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            SectionHeading(title: season.copy?.facts_title ?? "\(season.label) facts")
            VStack(alignment: .leading, spacing: Space.s) {
                ForEach(season.facts, id: \.self) { f in
                    HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                        Circle().fill(season.color).frame(width: 6, height: 6).accessibilityHidden(true)
                        Text((try? AttributedString(markdown: f)) ?? AttributedString(f))
                            .font(.app(.body)).foregroundStyle(Palette.body)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(Space.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: Radius.large))
            .overlay(RoundedRectangle(cornerRadius: Radius.large).strokeBorder(Palette.line.opacity(0.7)))
        }
    }

    /// Opening a store from here closes the season screen first.
    private func openStoreClosing(_ id: String) {
        dismiss()
        openStore?(id)
    }

    private func dropMore() {
        hop += 1
        drops += 1
    }
}

// MARK: Search and Spotlight

/// Seasons at the top of Search results: "pers", "fuyu" or "hachiya" finds the persimmon card.
struct SeasonSearchCards: View {
    @Environment(FeedStore.self) private var store
    let query: String

    var body: some View {
        let matches = store.seasons(matching: query)
        ForEach(matches) { s in
            SeasonCardButton(season: s, place: "search").padding(.top, Space.m)
        }
    }
}

extension DealsSpotlight {
    /// One Spotlight item per season on this week ("Persimmon season: Fuyu $1.28/lb at T&T"),
    /// gone when the week's sales end. Its id starts with "season:" so a tap opens the screen.
    @MainActor
    static func seasonEntries(_ store: FeedStore) -> [Entry] {
        guard let feed = store.feed else { return [] }
        return (feed.seasons?.items ?? []).compactMap { s in
            guard let best = feed.items.first(where: { $0.id == s.best }) else { return nil }
            return Entry(id: "season:\(s.id)", title: s.name,
                         detail: "\(s.star ?? s.label) \(best.text) at \(store.storeName(best.store))",
                         keywords: [s.label, s.item, s.star ?? ""] + (s.words ?? []),
                         expires: Dates.date(best.ends ?? feed.end).map { $0.addingTimeInterval(86_400) })
        }
    }
}
