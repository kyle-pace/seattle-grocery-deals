import SwiftUI

/// The site's "Newsprint" design tokens. Content uses these; system chrome (tab bar,
/// navigation bars, sheets) stays native so it gets Liquid Glass.
enum Theme {
    static let brand = Color(red: 0x1D / 255, green: 0x4D / 255, blue: 0x33 / 255)
    static let tag = Color(red: 0xFF / 255, green: 0xE4 / 255, blue: 0x5C / 255)
    static let onTag = Color(red: 0x14 / 255, green: 0x14 / 255, blue: 0x14 / 255)

    static let paper = Color(light: 0xF7F5F0, dark: 0x151412)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1E1C19)
    static let ink = Color(light: 0x141414, dark: 0xF2EFE8)
    static let muted = Color(light: 0x57534C, dark: 0xADA79C)
    static let line = Color(light: 0xDDD8CE, dark: 0x2E2B27)
    static let lineUI = Color(light: 0x8C867B, dark: 0x6E685F)
    static let red = Color(light: 0xB3261E, dark: 0xFF8A80)
}

extension Font {
    /// Barlow Condensed for prices and headings; scales with Dynamic Type.
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom("BarlowCondensed-Bold", size: size, relativeTo: style)
    }
    /// Atkinson Hyperlegible for everything else.
    static func body(_ size: CGFloat = 17, bold: Bool = false, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(bold ? "AtkinsonHyperlegible-Bold" : "AtkinsonHyperlegible-Regular", size: size, relativeTo: style)
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }
}

/// A condensed, uppercase section heading with a heavy rule, like the website.
struct SectionHeading: View {
    let title: String
    var note: String? = nil
    var body: some View {
        VStack(spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(title.uppercased()).font(.display(26)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let note { Text(note).font(.body(13, relativeTo: .caption)).foregroundStyle(Theme.muted) }
            }
            Rectangle().fill(Theme.ink).frame(height: 3)
        }
        .padding(.top, 22)
    }
}
