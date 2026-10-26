import SwiftUI

/// "$4.99/lb" in plain bold type, with a smaller dollar sign and unit. With `savings`, the
/// regular price and the percent off sit underneath; the percent off is the one bit of color.
struct PriceTag: View {
    let deal: Deal
    var size: CGFloat = 24
    var relativeTo: Font.TextStyle = .title3
    var savings = false
    /// Left-aligned, for the deal sheet; rows keep it on the right.
    var leading = false

    var body: some View {
        let cents = !deal.amount.hasPrefix("$")
        let number = cents ? deal.amount : String(deal.amount.dropFirst())
        VStack(alignment: leading ? .leading : .trailing, spacing: 3) {
            if !deal.lead.isEmpty {
                Text(deal.lead).font(.app(.caption, .semibold)).foregroundStyle(Palette.muted)
            }
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                if !cents { Text("$").font(.app(size * 0.7, .bold, relativeTo: relativeTo)) }
                Text(number).font(.app(size, .bold, relativeTo: relativeTo))
                if !deal.unit.isEmpty {
                    Text(deal.unit == "ea" ? " ea" : deal.unit).font(.app(size * 0.6, .semibold, relativeTo: relativeTo)).foregroundStyle(Palette.muted)
                }
            }
            .foregroundStyle(Palette.ink)
            if savings {
                // Lead with the US average where there is one; otherwise the store's own percent off.
                if let us = deal.us, us.under > 0 {
                    USAveragePill(under: us.under)
                } else if let off = deal.off {
                    OffPill(percent: off)
                }
            }
        }
        .monospacedDigit()
        .multilineTextAlignment(leading ? .leading : .trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    private var spoken: String {
        var parts = [deal.spoken]
        if savings, let us = deal.us, us.under > 0 { parts.append("\(us.under)% under the US average") }
        else if savings, let off = deal.off { parts.append("\(off)% off") }
        return parts.joined(separator: ", ")
    }
}

/// "28% under US avg" in a small blue pill: national prices from the BLS, staples only.
struct USAveragePill: View {
    let under: Int
    var body: some View {
        Label("\(under)% under US avg", systemImage: "flag")
            .labelStyle(.titleAndIcon)
            .font(.app(.footnote, .bold))
            .foregroundStyle(Palette.text(.info))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(Palette.fill(.info), in: Capsule())
            .fixedSize()
    }
}

/// "55% off" in a small green pill.
struct OffPill: View {
    let percent: Int
    var body: some View {
        Text("\(percent)% off")
            .font(.app(.footnote, .bold))
            .foregroundStyle(Palette.text(.good))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(Palette.fill(.good), in: Capsule())
            .fixedSize()
    }
}

/// "+" adds a deal to the list; the checkmark takes it back off.
struct AddButton: View {
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    let deal: Deal
    var body: some View {
        let added = list.contains(deal)
        Button { toggle(deal, added: added, list: list, store: store) } label: {
            Image(systemName: added ? "checkmark" : "plus").fontWeight(.bold)
                .frame(minWidth: 28, minHeight: 28)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.circle)
        .tint(added ? Palette.accent : Palette.ink)
        .frame(minWidth: 44, minHeight: 44)
        .sensoryFeedback(.success, trigger: added)
        .accessibilityLabel(added ? "Remove \(shortName(deal.name)) from your list" : "Add \(shortName(deal.name)) to your list")
    }
}

/// Adds or removes a deal and tells VoiceOver what happened.
@MainActor
func toggle(_ deal: Deal, added: Bool, list: ListStore, store: FeedStore) {
    let name = shortName(deal.name)
    if added {
        list.remove(deal: deal)
        Announce.say("Removed \(name) from your list")
    } else {
        // Something already on the list as another store's deal ("Japanese Yam" at Viet-Wah
        // vs "Japanese Sweet Potato" at T&T): swap this deal in rather than add a second line.
        let same = list.openItems.filter { item in
            guard let id = item.dealID, id != deal.id, let key = deal.key else { return false }
            return store.items.first { $0.id == id }?.key == key
        }
        for item in same { list.remove(item) }
        list.request(name, deal: deal, storeName: store.storeName(deal.store))
        Announce.say(same.isEmpty ? "Added \(name) to your list" : "Swapped in \(name) at \(store.storeName(deal.store))")
    }
}

/// "Fuyu Persimmon (California), Jumbo" -> "Fuyu Persimmon"
/// "Yam - Japanese #1" -> "Japanese Yam"
func shortName(_ name: String) -> String {
    var s = String(name.split(whereSeparator: { $0 == "," || $0 == "(" }).first ?? Substring(name))
        .replacingOccurrences(of: #"\s*#\s*\d+\b"#, with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
    let parts = s.components(separatedBy: " - ")
    if parts.count == 2, !parts[1].isEmpty { s = parts[1] + " " + parts[0].lowercased() }
    return s.trimmingCharacters(in: .whitespaces)
}

/// One deal: name, store and price details, the price, and the add button. Tapping the row
/// opens the deal; the add button is its own control, so VoiceOver and Voice Control reach both.
/// At the accessibility text sizes the price and button move under the name.
struct DealRow: View {
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    let deal: Deal
    var showStore = true
    var showWhy = false
    let open: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: Space.m) {
            Button(action: open) {
                AdaptiveStack(spacing: Space.m) {
                    VStack(alignment: .leading, spacing: 3) {
                        TierBadge(tier: deal.tier)
                        Text(deal.name).font(.app(.headline)).foregroundStyle(Palette.ink)
                        meta
                        if showWhy, !deal.why.isEmpty {
                            Text(deal.why).font(.app(.subheadline)).foregroundStyle(Palette.body).padding(.top, 2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    PriceTag(deal: deal, savings: true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spokenSummary)
            .accessibilityHint("Opens the deal")
            .accessibilityAction(named: list.contains(deal) ? "Remove from list" : "Add to list") {
                toggle(deal, added: list.contains(deal), list: list, store: store)
            }
            AddButton(deal: deal)
        }
        .padding(.vertical, Space.m)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.divider).frame(height: 1) }
    }

    private var metaParts: [String] {
        var parts: [String] = []
        if showStore { parts.append(store.storeName(deal.store)) }
        parts += deal.detail
        return parts
    }

    private var meta: some View {
        Text(metaParts.joined(separator: " · "))
            .font(.app(.subheadline)).foregroundStyle(Palette.muted)
    }

    /// "Standout. Fuyu Persimmon. Lam's, was $2.99, 40% off. 99 cents a pound."
    private var spokenSummary: String {
        var parts: [String] = []
        if deal.tier == .standout { parts.append("Standout") } else if deal.tier == .good { parts.append("Good deal") }
        parts.append(deal.name)
        parts.append(metaParts.joined(separator: ", "))
        parts.append(deal.spoken)
        if let us = deal.us, us.under > 0 { parts.append("\(us.under)% under the US average") }
        else if let off = deal.off { parts.append("\(off)% off") }
        if showWhy, !deal.why.isEmpty { parts.append(deal.why) }
        return parts.filter { !$0.isEmpty }.joined(separator: ". ")
    }
}

/// The deal sheet: big price, how it compares, the same item elsewhere, the store. Opens at half
/// height; Add to list and Watch price stay pinned at the bottom.
struct DealDetail: View {
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Environment(AlertsStore.self) private var alerts
    @Environment(\.dismiss) private var dismiss
    @State private var priming = false
    let deal: Deal
    var openStore: ((String) -> Void)? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.m) {
                    TierBadge(tier: deal.tier, compact: false)
                    Text(deal.name).font(.app(.title, .bold)).foregroundStyle(Palette.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(([store.storeName(deal.store)] + deal.detail + (deal.ends.map { ["through \(Dates.short($0))"] } ?? [])).joined(separator: " · "))
                        .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                    HStack(alignment: .bottom) {
                        PriceTag(deal: deal, size: 44, relativeTo: .largeTitle, leading: true)
                        Spacer()
                    }
                    .padding(.top, Space.xs)
                    comparisons
                    if !deal.why.isEmpty { Text(deal.why).font(.app(.body)).foregroundStyle(Palette.body) }
                    if let notes = deal.notes { Text(notes).font(.app(.subheadline)).foregroundStyle(Palette.muted) }

                    HStack(spacing: Space.s) {
                        if let openStore {
                            Button { dismiss(); openStore(deal.store) } label: {
                                Label("More at \(store.storeName(deal.store))", systemImage: "storefront")
                                    .font(.app(.subheadline, .semibold)).frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.glass)
                        }
                        ShareLink(item: URL(string: "https://seattlegrocery.deals/stores/\(deal.store)/")!,
                                  message: Text("\(deal.name): \(deal.text) at \(store.storeName(deal.store))")) {
                            Label("Share", systemImage: "square.and.arrow.up").font(.app(.subheadline, .semibold)).frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.glass)
                    }

                    let others = store.alsoOnSale(deal)
                    if !others.isEmpty {
                        SectionHeading(title: "Also on sale")
                        ForEach(others) { o in
                            AdaptiveStack(spacing: Space.xs) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(store.storeName(o.store)).font(.app(.callout, .semibold)).foregroundStyle(Palette.ink)
                                    Text(o.name).font(.app(.subheadline)).foregroundStyle(Palette.muted).lineLimitUnlessLarge(1)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text(o.unit_price ?? o.text).font(.app(.callout, .bold)).foregroundStyle(Palette.ink).monospacedDigit()
                            }
                            .padding(.vertical, Space.s)
                            .overlay(alignment: .bottom) { Rectangle().fill(Palette.divider).frame(height: 1) }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                .padding(20)
            }
            .background(Palette.ground)
            .safeAreaInset(edge: .bottom, spacing: 0) { actions }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .sheet(isPresented: $priming) {
            AlertPrimer(deal: deal) { allowed in
                priming = false
                if allowed { startWatching() }
            }
        }
        .onAppear { Analytics.track("Viewed Deal", Analytics.deal(deal)) }
    }

    /// How this price compares: the US average first, then lowest listed, then the store's own.
    @ViewBuilder private var comparisons: some View {
        let us = deal.us.flatMap { $0.under > 0 ? $0 : nil }
        if us != nil || deal.lowest == true || deal.regular != nil || deal.off != nil {
            VStack(alignment: .leading, spacing: Space.s) {
                if let us {
                    Label {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(us.under)% under the US average").font(.app(.callout, .bold)).foregroundStyle(Palette.ink)
                            Text("US average \(us.avg)\(us.period.map { ", \(Dates.month($0))" } ?? ""). National prices, so roughly.")
                                .font(.app(.footnote)).foregroundStyle(Palette.muted)
                        }
                    } icon: { Image(systemName: "flag.fill").foregroundStyle(Palette.mark(.info)) }
                }
                if deal.lowest == true {
                    Label("Lowest we've listed", systemImage: "arrow.down.circle.fill")
                        .font(.app(.callout, .semibold)).foregroundStyle(Palette.ink)
                        .symbolRenderingMode(.hierarchical)
                }
                if deal.regular != nil || deal.off != nil {
                    HStack(spacing: Space.s) {
                        if let regular = deal.regular { Text("Regular \(regular)").font(.app(.footnote)).foregroundStyle(Palette.muted) }
                        if let off = deal.off { OffPill(percent: off) }
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var actions: some View {
        let added = list.contains(deal)
        let w = alerts.watching(deal)
        return HStack(spacing: Space.s) {
            Button { toggle(deal, added: added, list: list, store: store) } label: {
                Label(added ? "On your list" : "Add to list", systemImage: added ? "checkmark" : "plus")
                    .font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.glassProminent)
            .sensoryFeedback(.success, trigger: added)
            .accessibilityHint(added ? "Removes it from your list" : "")
            if unitValue(deal) != nil {
                Button {
                    if let w {
                        alerts.unwatch(w)
                        Announce.say("Stopped watching the price")
                    } else {
                        Task {
                            if await alerts.needsAsking() { priming = true } else { startWatching() }
                        }
                    }
                } label: {
                    Label(w == nil ? "Watch price" : "Watching", systemImage: w == nil ? "bell" : "bell.fill")
                        .font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.glass)
                .accessibilityHint(w.map { "Alerts you under \($0.label). Tap to stop." } ?? "Alerts you if it gets cheaper")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, Space.s)
        .padding(.bottom, Space.xs)
        .background {
            Palette.ground
                .overlay(alignment: .top) { Rectangle().fill(Palette.divider).frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        }
    }

    private func startWatching() {
        Task {
            _ = await alerts.allow()
            alerts.watch(deal, week: store.feed?.week)
            Announce.say("Watching the price")
        }
    }
}

/// Before the system asks about notifications: what an alert will look like, and a way out.
struct AlertPrimer: View {
    let deal: Deal
    let done: (Bool) -> Void
    @Environment(FeedStore.self) private var store

    var body: some View {
        VStack(spacing: Space.l) {
            Buddy(.persimmon, mood: .happy, size: 72).hiddenWhenTextIsLarge()
            Text("Get a nudge when it drops").font(.app(.title2, .bold)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
            // A sample of the alert, styled like a notification.
            HStack(alignment: .top, spacing: Space.m) {
                Image(systemName: "bell.badge.fill").font(.app(.title3)).foregroundStyle(Palette.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Price drop: \(shortName(deal.name))").font(.app(.subheadline, .bold)).foregroundStyle(Palette.ink)
                    Text("Now cheaper than \(deal.text) at \(store.storeName(deal.store)).").font(.app(.subheadline)).foregroundStyle(Palette.body)
                }
                Spacer(minLength: 0)
            }
            .padding(Space.m)
            .glassEffect(.regular, in: .rect(cornerRadius: Radius.large))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Example alert: price drop on \(shortName(deal.name))")
            Text("Only for prices you watch, the Friday reminder, and sales ending on your list. Change it anytime in Settings.")
                .font(.app(.footnote)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            VStack(spacing: Space.s) {
                Button { done(true) } label: { Text("Turn on alerts").font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44) }
                    .buttonStyle(.glassProminent)
                Button("Maybe later") { done(false) }.font(.app(.headline)).frame(minHeight: 44).tint(Palette.muted)
            }
        }
        .padding(Space.xl)
        .presentationDetents([.medium, .large])
    }
}
