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

    /// "Thu, Oct 29" or "Oct 29"
    static func short(_ s: String?, weekday: Bool = true) -> String {
        guard let d = date(s) else { return "" }
        return d.formatted(weekday ? .dateTime.weekday(.abbreviated).month(.abbreviated).day() : .dateTime.month(.abbreviated).day())
    }
}
