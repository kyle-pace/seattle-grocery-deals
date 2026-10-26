import SwiftUI

/// "$4.99/lb" with a smaller dollar sign and unit, and the yellow tag for standouts.
struct PriceTag: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let deal: Deal
    var size: CGFloat = 28
    var relativeTo: Font.TextStyle = .title2
    var tagged: Bool { deal.tier == .standout }

    var body: some View {
        let cents = !deal.amount.hasPrefix("$")
        let number = cents ? deal.amount : String(deal.amount.dropFirst())
        VStack(alignment: .trailing, spacing: 0) {
            if !deal.lead.isEmpty {
                Text(deal.lead).font(.app(12, .bold, relativeTo: .caption))
            }
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                if !cents { Text("$").font(.app(size * 0.6, .bold, relativeTo: relativeTo)) }
                Text(number).font(.app(size, .heavy, relativeTo: relativeTo))
                if !deal.unit.isEmpty { Text(deal.unit == "ea" ? " ea" : deal.unit).font(.app(size * 0.55, .bold, relativeTo: relativeTo)) }
            }
        }
        .monospacedDigit()
        .foregroundStyle(tagged ? Theme.onTag : Palette.ink)
        .padding(.horizontal, tagged ? 8 : 0)
        .padding(.vertical, tagged ? 3 : 0)
        .background {
            if tagged {
                Rectangle().fill(Theme.tag)
                    .shadow(color: Palette.ink, radius: 0, x: 3, y: 3)
            }
        }
        // The tilted tag is newsprint flavor; big text reads better straight.
        .rotationEffect(.degrees(tagged && !typeSize.isAccessibilitySize ? -3 : 0))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(deal.spoken)
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
        list.request(name, deal: deal, storeName: store.storeName(deal.store))
        Announce.say("Added \(name) to your list")
    }
}

/// "Fuyu Persimmon (California), Jumbo" -> "Fuyu Persimmon"
func shortName(_ name: String) -> String {
    String(name.split(whereSeparator: { $0 == "," || $0 == "(" }).first ?? Substring(name)).trimmingCharacters(in: .whitespaces)
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
                    PriceTag(deal: deal)
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
        if let regular = deal.regular { parts.append("was \(regular)") }
        return parts
    }

    private var meta: some View {
        let base = Text(metaParts.joined(separator: " · "))
        let off = deal.off.map { Text("  \($0)% off").font(.app(.subheadline, .bold)).foregroundStyle(Palette.text(.bad)) }
        return (off.map { base + $0 } ?? base)
            .font(.app(.subheadline)).foregroundStyle(Palette.muted)
    }

    /// "Standout. Fuyu Persimmon. Lam's, was $2.99, 40% off. 99 cents a pound."
    private var spokenSummary: String {
        var parts: [String] = []
        if deal.tier == .standout { parts.append("Standout") } else if deal.tier == .good { parts.append("Good deal") }
        parts.append(deal.name)
        parts.append((metaParts + (deal.off.map { ["\($0)% off"] } ?? [])).joined(separator: ", "))
        parts.append(deal.spoken)
        if showWhy, !deal.why.isEmpty { parts.append(deal.why) }
        return parts.filter { !$0.isEmpty }.joined(separator: ". ")
    }
}

/// The deal sheet: big price, why it's a deal, the same item elsewhere, the store.
struct DealDetail: View {
    @Environment(FeedStore.self) private var store
    @Environment(ListStore.self) private var list
    @Environment(AlertsStore.self) private var alerts
    @Environment(\.dismiss) private var dismiss
    let deal: Deal
    var openStore: ((String) -> Void)? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.m) {
                    TierBadge(tier: deal.tier, compact: false)
                    Text(deal.name).font(.app(.largeTitle)).foregroundStyle(Palette.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(([store.storeName(deal.store)] + deal.detail + (deal.ends.map { ["through \(Dates.short($0))"] } ?? [])).joined(separator: " · "))
                        .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                    PriceTag(deal: deal, size: 52, relativeTo: .largeTitle).padding(.vertical, Space.s)
                    if let regular = deal.regular {
                        (Text("Regular \(regular)") + (deal.off.map { Text(", \($0)% off").foregroundStyle(Palette.text(.bad)).bold() } ?? Text("")))
                            .font(.app(.callout)).foregroundStyle(Palette.ink)
                    }
                    if !deal.why.isEmpty { Text(deal.why).font(.app(.body)).foregroundStyle(Palette.body) }
                    if let notes = deal.notes { Text(notes).font(.app(.subheadline)).foregroundStyle(Palette.muted) }

                    let added = list.contains(deal)
                    Button { toggle(deal, added: added, list: list, store: store) } label: {
                        Label(added ? "On your list (tap to remove)" : "Add to list", systemImage: added ? "checkmark" : "plus")
                            .font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glassProminent)
                    .padding(.top, Space.s)
                    if unitValue(deal) != nil {
                        let w = alerts.watching(deal)
                        Button {
                            if let w {
                                alerts.unwatch(w)
                                Announce.say("Stopped watching the price")
                            } else {
                                Task {
                                    _ = await alerts.allow()
                                    alerts.watch(deal, week: store.feed?.week)
                                    Announce.say("Watching the price")
                                }
                            }
                        } label: {
                            Label(w.map { "Watching: under \($0.label) (tap to stop)" } ?? "Watch price: alert me if it's cheaper",
                                  systemImage: w == nil ? "bell" : "bell.fill")
                                .font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.glass)
                    }
                    if let openStore {
                        Button { dismiss(); openStore(deal.store) } label: {
                            Label("More at \(store.storeName(deal.store))", systemImage: "storefront")
                                .font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.glass)
                    }
                    ShareLink(item: URL(string: "https://seattlegrocery.deals/stores/\(deal.store)/")!,
                              message: Text("\(deal.name): \(deal.text) at \(store.storeName(deal.store))")) {
                        Label("Share this deal", systemImage: "square.and.arrow.up").font(.app(.headline)).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glass)

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
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .onAppear { Analytics.track("Viewed Deal", Analytics.deal(deal)) }
    }
}
