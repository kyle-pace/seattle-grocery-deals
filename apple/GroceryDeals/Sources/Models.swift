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
    /// "Best of your stores": each store's rank numbers for this week, by store id
    /// (scripts/lib.mjs storeRanks). Missing in feeds built before 2026-11-07.
    let store_ranks: [String: StoreRank]?
}

/// How a store's week stacks up (scripts/lib.mjs storeRanks): a score from its standouts and
/// good deals (weighted by how often people buy the item and the aisle, plus a bonus for deals
/// across several core aisles), a reason line and its top deal ids.
struct RankNumbers: Codable, Sendable, Hashable {
    let score: Double
    let standouts: Int
    let good: Int
    let deals: Int
    let aisles: Int
    /// Fewer than 3 standouts and 6 good deals: This week says it's a quiet week.
    let quiet: Bool
    /// "A good week for produce, seafood and pantry staples."
    let reason: String
    /// The store's best few deal ids, best first.
    let top: [String]
}

/// A store's rank numbers, plus the same over vegetarian deals only (`veg`), for when
/// "Vegetarian deals only" is on. In the feed they're one object with `veg` inside.
struct StoreRank: Codable, Sendable, Hashable {
    let all: RankNumbers
    let veg: RankNumbers?
    private enum Keys: String, CodingKey { case veg }
    init(from decoder: Decoder) throws {
        all = try RankNumbers(from: decoder)
        veg = try decoder.container(keyedBy: Keys.self).decodeIfPresent(RankNumbers.self, forKey: .veg)
    }
    func encode(to encoder: Encoder) throws {
        try all.encode(to: encoder)
        var c = encoder.container(keyedBy: Keys.self)
        try c.encodeIfPresent(veg, forKey: .veg)
    }
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
    /// True for stores whose flyer is read from a desktop browser, not by the watcher, so a new flyer can be up before it is read.
    /// Older feeds don't have it.
    let read_by_hand: Bool?
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

    /// Where the weekly ad lives: the store's own flyer page when there is one, otherwise the
    /// first flyer link (an image or PDF on the store's site). The app only links out to it.
    var flyerLinkURL: URL? {
        let pages = flyer_pages ?? []
        let url = ((pages.first { $0.kind == .web }?.url ?? flyer_url) ?? pages.first?.url).flatMap(URL.init(string:))
        // Safari's viewer only opens web addresses (anything else crashes it).
        guard let url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }
    var hasFlyer: Bool { flyerLinkURL != nil }

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
    /// The drawing for this deal's row, by name in Assets.xcassets/Stickers ("bok-choy",
    /// "section-produce"). Missing in feeds built before 2026-11-14.
    let sticker: String?
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

/// When a deal ends, said the same way on every row (and on the website's rows).
extension Deal {
    /// The price as one short string for a row's detail line: "$2.49/lb", "3 for $5.00", "99¢ ea".
    var shortPrice: String {
        let u = unit.isEmpty ? "" : unit == "ea" ? " ea" : unit
        return [lead, amount + u].filter { !$0.isEmpty }.joined(separator: " ")
    }
    /// Days left counting today: 1 means it ends today, 0 or less means it has ended.
    var daysLeft: Int? { Dates.daysLeft(through: ends) }
    /// True once the sale's last day has passed.
    var ended: Bool { (daysLeft ?? 1) <= 0 }
    /// "Ends today", "Ends tomorrow" or "Ended": loud enough for a badge on the row.
    var endsBadge: String? {
        guard let left = daysLeft else { return nil }
        return left <= 0 ? "Ended" : left == 1 ? "Ends today" : left == 2 ? "Ends tomorrow" : nil
    }
    /// "Through Sat" this week, "Through Nov 14" after that, for the row's details. Nil when
    /// the badge already says it.
    var endsDetail: String? {
        guard endsBadge == nil, let left = daysLeft, let end = Dates.date(ends) else { return nil }
        return "Through " + (left <= 7 ? end.formatted(.dateTime.weekday(.abbreviated)) : end.formatted(.dateTime.month(.abbreviated).day()))
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

    /// Every row asks when its deal ends, several times per draw, and a week only has a
    /// handful of different dates. Reading the same text with a DateFormatter hundreds of times
    /// per screen is what made tab switches hitch (the Nov 12 recording), so each date is read
    /// once and each "days left" is worked out once per day. Locked: deals are read off the
    /// main thread too (the widget, Spotlight).
    private final class Memo: @unchecked Sendable {
        let lock = NSLock()
        var dates: [String: Date?] = [:]
        var left: [String: Int] = [:]
        /// `left` counts from `today`, and is good until `tomorrow`.
        var today = Date.distantPast
        var tomorrow = Date.distantPast
    }
    private static let memo = Memo()

    /// Call with the lock held.
    private static func parsed(_ s: String) -> Date? {
        if let known = memo.dates[s] { return known }
        let d = iso.date(from: s)
        memo.dates.updateValue(d, forKey: s)
        return d
    }

    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        memo.lock.lock()
        defer { memo.lock.unlock() }
        return parsed(s)
    }

    /// Days left counting today, for a last day like "2026-11-12": 1 means it's today, 0 or
    /// less means it has passed. Nil when there's no date.
    static func daysLeft(through s: String?) -> Int? {
        guard let s else { return nil }
        let now = Date.now
        memo.lock.lock()
        defer { memo.lock.unlock() }
        if now < memo.today || now >= memo.tomorrow {
            let cal = Calendar.current
            memo.today = cal.startOfDay(for: now)
            memo.tomorrow = cal.date(byAdding: .day, value: 1, to: memo.today) ?? memo.today.addingTimeInterval(86_400)
            memo.left.removeAll(keepingCapacity: true)
        }
        if let known = memo.left[s] { return known }
        guard let end = parsed(s) else { return nil }
        let cal = Calendar.current
        let left = (cal.dateComponents([.day], from: memo.today, to: cal.startOfDay(for: end)).day ?? 0) + 1
        memo.left[s] = left
        return left
    }

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
