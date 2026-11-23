import AmplitudeSwift
import Foundation

/// Amplitude product analytics. Same Amplitude project as the website, and the same events and
/// privacy rules: anonymous random device ID, no IP address, carrier, vendor ID or city, never
/// the list contents or search text.
///
/// Nothing is sent until the person answers the usage question in onboarding. Amplitude isn't
/// even created before a "yes", so a "no" leaves no device ID and sends nothing (including
/// events an earlier build saved but hadn't sent yet). Settings can change the answer.
@MainActor
enum Analytics {
    /// From the AMPLITUDE_API_KEY build setting (Analytics.xcconfig and the gitignored
    /// Secrets.xcconfig), through Info.plist. Empty means analytics stays off.
    private static var apiKey: String {
        let key = (Bundle.main.object(forInfoDictionaryKey: "AmplitudeAPIKey") as? String)?
            .trimmingCharacters(in: .whitespaces) ?? ""
        return key.hasPrefix("$(") ? "" : key
    }
    /// "share" or "none"; missing until the person answers.
    private static let choiceKey = "sgd.analyticsChoice"
    /// Builds before onboarding (0.1.0) had only an off switch, on by default.
    private static let legacyOffKey = "sgd.analyticsOff"
    private static var amplitude: Amplitude?

    /// The person's answer, or `nil` if they haven't been asked yet. Someone who turned the old
    /// Settings switch off already said no, so they aren't asked again.
    static var choice: Bool? {
        let d = UserDefaults.standard
        if let s = d.string(forKey: choiceKey) { return s == "share" }
        if d.bool(forKey: legacyOffKey) { return false }
        return nil
    }

    static var isOn: Bool { choice == true }

    /// Saves the answer and starts or stops sending.
    static func setSharing(_ on: Bool) {
        let d = UserDefaults.standard
        d.set(on ? "share" : "none", forKey: choiceKey)
        d.removeObject(forKey: legacyOffKey)
        if on {
            start()
            amplitude?.optOut = false
        } else {
            amplitude?.optOut = true
        }
    }

    /// Creates Amplitude only if the person said yes. Safe to call more than once.
    static func start() {
        guard amplitude == nil, isOn, !apiKey.isEmpty else { return }
        amplitude = Amplitude(configuration: Configuration(
            apiKey: apiKey,
            optOut: false,
            trackingOptions: TrackingOptions()
                .disableTrackIpAddress().disableTrackCarrier().disableTrackIDFV()
                .disableTrackCity().disableTrackDMA(),
            autocapture: [.sessions, .appLifecycles]
        ))
        if isInternal { setUser(["internal_user": true]) }
    }

    /// Kyle's own installs: Deals Dev (an internal build) and the Simulator. They carry the user
    /// property internal_user = true so charts can leave them out of real-visitor counts.
    private static var isInternal: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return Bundle.main.object(forInfoDictionaryKey: "KitchenInternalBuild") as? Bool == true
        #endif
    }

    // MARK: dev menu

    static let hasKey = !apiKey.isEmpty
    static var deviceID: String? { amplitude?.getDeviceId() }
    static func flush() { amplitude?.flush() }

    /// Forgets the answer and stops sending; the next launch shows onboarding from the start
    /// (even on a phone that ran 0.1.0, which otherwise skips it).
    static func forget() {
        let d = UserDefaults.standard
        d.removeObject(forKey: choiceKey)
        d.removeObject(forKey: legacyOffKey)
        d.set(true, forKey: Welcome.forceKey)
        amplitude?.optOut = true
    }

    static func track(_ event: String, _ props: [String: Any] = [:]) {
        amplitude?.track(eventType: event, eventProperties: props.isEmpty ? nil : props)
    }

    static func screen(_ name: String) { track("Viewed Screen", ["screen": name]) }

    static func deal(_ d: Deal) -> [String: Any] {
        ["deal_id": d.id, "item_key": d.key ?? "", "store": d.store, "category": d.category, "tier": d.tier.rawValue]
    }

    static func setUser(_ props: [String: Any]) { amplitude?.identify(userProperties: props) }
}
