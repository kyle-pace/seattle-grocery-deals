// The shared design language for Pantry and Grocery Deals (~/Developer/KitchenUI), visible to
// every file in the app and the widget. Use `Palette`, `.app(...)` fonts and SwiftUI's own
// components; this file only adds what is Deals' own.
@_exported import KitchenUI
import SwiftUI

/// Deals' own tokens on top of `Palette`. Content and system chrome both follow light and dark.
enum Theme {
    /// The yellow sale tag behind standout prices, the website's signature mark. The same in
    /// light and dark; black on it is 15:1. Always paired with the "Standout" badge, so it never
    /// carries meaning by color alone.
    static let tag = Color(hex: 0xFFE45C)
    static let onTag = Color(hex: 0x141414)
}

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
