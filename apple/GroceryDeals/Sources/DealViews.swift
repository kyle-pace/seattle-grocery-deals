import SwiftUI

/// "$4.99/lb" with a small dollar sign and unit, and the yellow tag for standouts.
struct PriceTag: View {
    let deal: Deal
    var size: CGFloat = 30
    var tagged: Bool { deal.tier == .standout }

    var body: some View {
        let cents = !deal.amount.hasPrefix("$")
        let number = cents ? deal.amount : String(deal.amount.dropFirst())
        VStack(alignment: .trailing, spacing: 0) {
            if !deal.lead.isEmpty {
                Text(deal.lead).font(.body(11, bold: true, relativeTo: .caption2)).foregroundStyle(tagged ? Theme.onTag : Theme.ink)
            }
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                if !cents { Text("$").font(.display(size * 0.55)).baselineOffset(size * 0.32) }
                Text(number).font(.display(size))
                if !deal.unit.isEmpty { Text(deal.unit == "ea" ? " ea" : deal.unit).font(.display(size * 0.55)) }
            }
        }
        .monospacedDigit()
        .foregroundStyle(tagged ? Theme.onTag : Theme.ink)
        .padding(.horizontal, tagged ? 7 : 0)
        .padding(.vertical, tagged ? 3 : 0)
        .background {
            if tagged {
                Rectangle().fill(Theme.tag)
                    .shadow(color: Theme.ink, radius: 0, x: 3, y: 3)
            }
        }
        .rotationEffect(.degrees(tagged ? -3 : 0))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(deal.spoken)
    }
}

/// One deal: name, store and price details on the left, the price on the right.
struct DealRow: View {
    @Environment(FeedStore.self) private var store
    let deal: Deal
    var showStore = true
    var showWhy = false

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if deal.tier == .standout { Badge(text: "Standout") }
                    else if deal.tier == .good { Badge(text: "Good deal", dashed: true) }
                }
                Text(deal.name).font(.body(17, bold: true)).foregroundStyle(Theme.ink)
                meta
                if showWhy, !deal.why.isEmpty {
                    Text(deal.why).font(.body(15)).foregroundStyle(Theme.ink).padding(.top, 2)
                }
            }
            Spacer(minLength: 8)
            PriceTag(deal: deal)
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var meta: some View {
        var parts: [String] = []
        if showStore { parts.append(store.storeName(deal.store)) }
        parts += deal.detail
        if let regular = deal.regular { parts.append("was \(regular)") }
        let base = Text(parts.joined(separator: " · "))
        let off = deal.off.map { Text("  \($0)% off").font(.body(14, bold: true, relativeTo: .subheadline)).foregroundStyle(Theme.red) }
        return (off.map { base + $0 } ?? base)
            .font(.body(14, relativeTo: .subheadline)).foregroundStyle(Theme.muted)
    }
}

struct Badge: View {
    let text: String
    var dashed = false
    var body: some View {
        Text(text.uppercased())
            .font(.body(11, bold: true, relativeTo: .caption2)).tracking(0.6)
            .padding(.horizontal, 5).padding(.vertical, 1)
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.ink, style: StrokeStyle(lineWidth: 1.5, dash: dashed ? [3, 2] : [])))
            .foregroundStyle(Theme.ink)
    }
}

/// The deal sheet: big price, why it's a deal, the same item elsewhere, the store.
struct DealDetail: View {
    @Environment(FeedStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let deal: Deal
    var openStore: ((String) -> Void)? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if deal.tier != .sale { Badge(text: deal.tier == .standout ? "Standout" : "Good deal", dashed: deal.tier == .good) }
                    Text(deal.name.uppercased()).font(.display(36, relativeTo: .largeTitle)).foregroundStyle(Theme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(([store.storeName(deal.store)] + deal.detail + (deal.ends.map { ["through \(Dates.short($0))"] } ?? [])).joined(separator: " · "))
                        .font(.body(15)).foregroundStyle(Theme.muted)
                    PriceTag(deal: deal, size: 58).padding(.vertical, 10)
                    if let regular = deal.regular {
                        (Text("Regular \(regular)") + (deal.off.map { Text(", \($0)% off").foregroundStyle(Theme.red).bold() } ?? Text("")))
                            .font(.body(16)).foregroundStyle(Theme.ink)
                    }
                    if !deal.why.isEmpty { Text(deal.why).font(.body(17)).foregroundStyle(Theme.ink) }
                    if let notes = deal.notes { Text(notes).font(.body(15)).foregroundStyle(Theme.muted) }

                    if let openStore {
                        Button { dismiss(); openStore(deal.store) } label: {
                            Text("More at \(store.storeName(deal.store))").font(.body(17, bold: true)).frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.glass).padding(.top, 8)
                    }
                    ShareLink(item: URL(string: "https://seattlegrocery.deals/stores/\(deal.store)/")!,
                              message: Text("\(deal.name): \(deal.text) at \(store.storeName(deal.store))")) {
                        Label("Share this deal", systemImage: "square.and.arrow.up").font(.body(17, bold: true)).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glass)

                    let others = store.alsoOnSale(deal)
                    if !others.isEmpty {
                        SectionHeading(title: "Also on sale")
                        ForEach(others) { o in
                            HStack {
                                Text(store.storeName(o.store)).font(.body(16)).foregroundStyle(Theme.ink)
                                Text(o.name).font(.body(14)).foregroundStyle(Theme.muted).lineLimit(1)
                                Spacer()
                                Text(o.unit_price ?? o.text).font(.body(16, bold: true)).foregroundStyle(Theme.ink)
                            }
                            .padding(.vertical, 8)
                            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.paper)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
