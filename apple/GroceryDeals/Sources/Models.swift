import Foundation
import SwiftUI

// The site's app feed (/api/week.json), written by scripts/build.mjs (appFeed()).
struct Feed: Codable, Sendable {
    /// When the deals end: `most` is the date most of them run through, `some` an earlier date
    /// a good share end on. Stores' sales start on different days, so there's no single end.
    struct Ends: Codable, Sendable {
        let most: String?
        let some: String?
    }
    let week: String
    let end: String?
    /// Missing in feeds built before 2026-10-31; `end` is the fallback.
    let ends: Ends?
    /// The latest day a store's flyer started: when the deals last changed.
    let updated: String?
    let generated: String
    let categories: [Category]
    let stores: [Store]
    let items: [Deal]
    /// Seasonal items on this week (persimmons first), for the This week card and the season
    /// screen. Missing in feeds built before 2026-10-31. Read one by one, so a season this
    /// version can't read is skipped instead of losing the whole week.
    let seasons: LossyList<Season>?
}

/// A list that skips entries it can't decode, for parts of the feed that may grow new shapes.
struct LossyList<Element: Codable & Sendable>: Codable, Sendable {
    var items: [Element]
    init(_ items: [Element]) { self.items = items }
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [Element] = []
        while !c.isAtEnd {
            if let e = try? c.decode(Element.self) { out.append(e); continue }
            // Step past the bad entry. The container only moves on a successful decode, so an
            // entry that's neither an object nor null would loop forever: stop there instead.
            if (try? c.decode(Skip.self)) != nil { continue }
            if (try? c.decodeNil()) == true { continue }
            break
        }
        items = out
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(contentsOf: items)
    }
    private struct Skip: Decodable {}
}

/// A seasonal item that's on this week (scripts/build.mjs, seasonFeed()). What's in season and
/// the facts come from KitchenCatalog's seasons.json; the deals are this week's, by id.
struct Season: Codable, Sendable, Identifiable, Hashable {
    struct Tint: Codable, Sendable, Hashable {
        let light: String
        let dark: String
    }
    struct LogEntry: Codable, Sendable, Hashable, Identifiable {
        let week: String
        let value: Double
        /// "$1.28/lb", or "about $3.41/lb" for a per-each price.
        let text: String
        let store: String
        let about: Bool
        var id: String { week }
    }
    /// The web page's lines, filled in ("The best Fuyu deal in this week's flyers").
    struct Copy: Codable, Sendable, Hashable {
        let kicker: String?
        let none_title: String?
        let none_line: String?
        let also_title: String?
        let others_title: String?
        let others_note: String?
        let log_title: String?
        let log_note: String?
        let facts_title: String?
    }

    let id: String
    /// "Persimmons"
    let label: String
    /// "Persimmon season"
    let name: String
    /// "persimmons", for sentences.
    let item: String
    /// The kind to look for ("Fuyu"), if there is one.
    let star: String?
    /// A KitchenUI buddy name; nil (or one this version doesn't draw) shows a leaf.
    let buddy: String?
    /// The web page, for Share.
    let url: String
    /// The season's last day, "2027-01-15": hiding a card lasts until then.
    let ends: String
    let tint: Tint
    /// This week's deals by id: the cheapest of the star kind, the rest of it, other kinds.
    let best: String?
    let also: [String]
    let other: [String]
    /// Stores with any of it on sale.
    let stores: Int
    /// Per-each prices in the comparison unit, by deal id: "$3.41/lb".
    let about: [String: String]?
    /// About how many for $10, and how that was worked out.
    let per_10: Int?
    let per_10_note: String?
    let log: [LogEntry]
    /// Words that mean this item, for Search ("fuyu", "hachiya").
    let words: [String]?
    let tagline: String?
    /// With **bold** lead words.
    let facts: [String]
    /// The share line: "PERSIMMON ALERT!!! Fuyu at $1.28/lb at T&T Supermarket"
    let share: String?
    let copy: Copy?

    var kind: Buddy.Kind? { Buddy.Kind(name: buddy) }
    /// A line from `copy`, or nil when the feed left it empty, so the app's own wording shows.
    func line(_ key: KeyPath<Copy, String?>) -> String? {
        guard let text = copy?[keyPath: key], !text.isEmpty else { return nil }
        return text
    }
    var starLabel: String { star ?? item }
    var color: Color { Color(light: Self.hex(tint.light) ?? 0x2F6B4F, dark: Self.hex(tint.dark) ?? 0x7CC4A0) }
    var webURL: URL? { URL(string: url) }

    static func hex(_ s: String) -> UInt32? {
        UInt32(s.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16)
    }
}

/// What people are adding this week (/api/popular.json): deals added by at least
/// `min_people` different people, most first. Counts only, from Amplitude.
struct Popular: Codable, Sendable {
    struct Item: Codable, Sendable, Hashable {
        let deal_id: String
        let key: String?
        let name: String
        let store: String
        let people: Int
    }
    let week: String
    let updated: String
    let min_people: Int
    let items: [Item]
}

struct Category: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let label: String
}

struct Store: Codable, Sendable, Identifiable, Hashable {
    struct Location: Codable, Sendable, Hashable {
        let label: String
        let address: String
        let lat: Double
        let lon: Double
    }
    let id: String
    let name: String
    let about: String
    let website: String?
    let flyer_url: String?
    let delivery: String?
    let status: String?
    let from: String?
    let through: String?
    let locations: [Location]
    /// This week's flyer itself: page images, a PDF, or the store's flyer page, with labels.
    /// Older feeds don't have it; the app falls back to `flyer_url`.
    let flyer_pages: [FlyerPage]?

    struct FlyerPage: Codable, Sendable, Hashable, Identifiable {
        let label: String
        let url: String
        /// "image", "pdf" or "web", worked out by the site build (`flyerKind` in scripts/lib.mjs).
        let feedKind: String?
        var id: String { url }

        enum CodingKeys: String, CodingKey { case label, url, feedKind = "kind" }

        enum Kind { case image, pdf, web }
        var kind: Kind {
            switch feedKind {
            case "image": return .image
            case "pdf": return .pdf
            case "web": return .web
            default: return guessedKind
            }
        }

        /// Older feeds have no kind: the same rules as the site build.
        private var guessedKind: Kind {
            let path = (URL(string: url)?.path ?? url).lowercased()
            if path.hasSuffix(".pdf") { return .pdf }
            if [".jpg", ".jpeg", ".png", ".webp", ".gif"].contains(where: path.hasSuffix) { return .image }
            // Image CDNs that don't always end in an extension.
            if ["cloudinary.com/", "/image/upload/", "squarespace-cdn.com/", "cloudfront.net/", "localexpress.io/img/", "/files/mp/public/"]
                .contains(where: url.contains) { return .image }
            return .web
        }
    }

    /// The pages the app's own flyer viewer shows: page images when there are any (Uwajimaya
    /// posts both images and a PDF of the same ad), otherwise the PDFs.
    var viewablePages: [FlyerPage] {
        let pages = flyer_pages ?? []
        let images = pages.filter { $0.kind == .image }
        return images.isEmpty ? pages.filter { $0.kind == .pdf } : images
    }
    var hasFlyer: Bool { !viewablePages.isEmpty || flyerWebURL != nil }
    /// Where to send people when there's nothing to show in the app.
    var flyerWebURL: URL? {
        ((flyer_pages ?? []).first { $0.kind == .web }?.url ?? flyer_url).flatMap(URL.init(string:))
    }

    /// "Seattle · Tukwila"
    var towns: String {
        var seen: [String] = []
        for l in locations {
            let town = l.address.split(separator: ",").last.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
            let clean = town.replacingOccurrences(of: #"\s+WA.*$"#, with: "", options: .regularExpression)
            if !clean.isEmpty, !seen.contains(clean) { seen.append(clean) }
        }
        return seen.joined(separator: " · ")
    }
    var readThisWeek: Bool { status == "full" || status == "partial" }
}

struct Deal: Codable, Sendable, Identifiable, Hashable {
    enum Tier: String, Codable, Sendable { case standout, good, sale }
    let id: String
    let rank: Int
    let name: String
    let store: String
    let category: String
    let key: String?
    let price: Double
    let text: String
    let lead: String
    let amount: String
    let unit: String
    let spoken: String
    let detail: [String]
    let regular: String?
    let off: Int?
    let unit_price: String?
    let tier: Tier
    let why: String
    let veg: Bool
    let ends: String?
    let notes: String?
    /// The US average for staples (BLS), when this item has one: "$2.06/lb", 28 (% under).
    let us: USAverage?
    /// The lowest price we've listed for this item in past weeks.
    let lowest: Bool?

    struct USAverage: Codable, Sendable, Hashable {
        let avg: String
        let under: Int
        let period: String?
    }
}

enum Dates {
    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func date(_ s: String?) -> Date? { s.flatMap { iso.date(from: $0) } }

    /// "2026-09" -> "Sep 2026"
    static func month(_ s: String) -> String {
        guard let d = date(s + "-01") else { return s }
        return d.formatted(.dateTime.month(.abbreviated).year())
    }

    /// "Thu, Oct 29" or "Oct 29"
    static func short(_ s: String?, weekday: Bool = true) -> String {
        guard let d = date(s) else { return "" }
        return d.formatted(weekday ? .dateTime.weekday(.abbreviated).month(.abbreviated).day() : .dateTime.month(.abbreviated).day())
    }
}
