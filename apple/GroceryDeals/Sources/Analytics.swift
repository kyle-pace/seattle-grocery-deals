import AmplitudeSwift
import Foundation

/// Amplitude product analytics. Same Amplitude project as the website and the Expo app, and
/// the same events and privacy rules: anonymous random device ID, no IP address, carrier,
/// vendor ID or city, never the list contents or search text, and an off switch in Settings.
@MainActor
enum Analytics {
    private static let apiKey = "209f961ae2c60b11c922363aa094ed0a" // public by design
    private static let offKey = "sgd.analyticsOff"
    private static var amplitude: Amplitude?

    static var isOff: Bool {
        get { UserDefaults.standard.bool(forKey: offKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: offKey)
            amplitude?.optOut = newValue
        }
    }

    static func start() {
        guard amplitude == nil else { return }
        amplitude = Amplitude(configuration: Configuration(
            apiKey: apiKey,
            optOut: isOff,
            trackingOptions: TrackingOptions()
                .disableTrackIpAddress().disableTrackCarrier().disableTrackIDFV()
                .disableTrackCity().disableTrackDMA(),
            autocapture: [.sessions, .appLifecycles]
        ))
    }

    static func track(_ event: String, _ props: [String: Any] = [:]) {
        amplitude?.track(eventType: event, eventProperties: props.isEmpty ? nil : props)
    }

    static func screen(_ name: String) { track("Viewed Screen", ["screen": name]) }

    static func deal(_ d: Deal) -> [String: Any] {
        ["deal_id": d.id, "store": d.store, "category": d.category, "tier": d.tier.rawValue]
    }

    static func setUser(_ props: [String: Any]) { amplitude?.identify(userProperties: props) }
}
