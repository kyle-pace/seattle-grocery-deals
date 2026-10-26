// The shared design language for Pantry and Grocery Deals (~/Developer/KitchenUI), visible to
// every file in the app and the widget. Use `Palette`, `.app(...)` fonts and SwiftUI's own
// components; this file only adds Deals' own pieces.
@_exported import KitchenUI
import SwiftUI

/// A section heading with an optional count: "BEST THIS WEEK · 18 standouts".
struct SectionHeading: View {
    let title: String
    var note: String? = nil
    var body: some View {
        SectionHeader(title, trailing: note)
            .padding(.top, Space.xl)
            .padding(.bottom, Space.xs)
    }
}

/// "Standout" (star) and "Good deal" (half star): a shape and a word, never color alone.
struct TierBadge: View {
    let tier: Deal.Tier
    var compact = true
    var body: some View {
        switch tier {
        case .standout:
            Badge("Standout", tone: .warn, compact: compact) { Image(systemName: "star.fill").imageScale(.small) }
        case .good:
            Badge("Good deal", tone: .neutral, compact: compact) { Image(systemName: "star.leadinghalf.filled").imageScale(.small) }
        case .sale:
            EmptyView()
        }
    }
}
