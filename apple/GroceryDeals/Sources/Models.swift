import Foundation

// The site's app feed (/api/week.json), written by scripts/build.mjs (appFeed()).
struct Feed: Codable, Sendable {
    let week: String
    let end: String?
    let generated: String
    let categories: [Category]
    let stores: [Store]
    let items: [Deal]
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
        var id: String { url }

        enum Kind { case image, pdf, web }
        var kind: Kind {
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
        ((flyer_pages ?? []).first { $0.kind == .web }?.url ?? flyer_url ?? website).flatMap(URL.init(string:))
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
