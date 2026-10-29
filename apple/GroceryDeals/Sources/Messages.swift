@preconcurrency import FirebaseCore
@preconcurrency import FirebaseRemoteConfig
import SwiftUI

/// In-app messages from Firebase Remote Config (parameter `in_app_message` in the
/// seattle-grocery-deals-dev project), drawn with KitchenUI's `InAppMessageCard` and
/// `InAppMessageSheet`, the same as Maitake. Written and switched on in the Firebase console, no
/// new build needed, and picked up live while the app is open. The JSON format is at the top of
/// KitchenUI's Messages.swift.
///
/// Places in Deals: "week" (This week, the default), "aisles", "stores", "list". Links can be
/// deals://tab/<place> or deals://search/<words> (handled inside the app) or an https page.
///
/// No Google Analytics: Remote Config only sends Firebase this install's ID to fetch the
/// message. Shown, tapped and closed reach Amplitude only after a yes in onboarding.
@MainActor @Observable
final class MessageStore {
    static let shared = MessageStore()
    static let parameter = "in_app_message"
    static let main = "week"
    private static let dismissedKey = "sgd.messages.dismissed"

    private(set) var current: InAppMessage?
    private var latest: InAppMessage?
    private var dismissed = Set(UserDefaults.standard.stringArray(forKey: MessageStore.dismissedKey) ?? [])
    private var shown: Set<String> = []
    private var started = false

    private static var isDevBuild: Bool { Bundle.main.bundleIdentifier?.hasSuffix(".dev") ?? false }

    func card(for place: String) -> InAppMessage? {
        guard let m = current, m.belongs(on: place, main: Self.main) else { return nil }
        return m
    }

    /// Called once Firebase is configured, and again on each return to the app.
    func refresh() {
        guard FirebaseApp.app() != nil else { return }
        let config = RemoteConfig.remoteConfig()
        if !started {
            started = true
            let settings = RemoteConfigSettings()
            settings.minimumFetchInterval = Self.isDevBuild ? 0 : 3600
            config.configSettings = settings
            config.setDefaults([Self.parameter: "" as NSString])
            read(config)
            config.addOnConfigUpdateListener { update, error in
                guard error == nil, update?.updatedKeys.contains(MessageStore.parameter) == true else { return }
                config.activate { _, _ in Task { @MainActor in MessageStore.shared.read(config) } }
            }
        }
        config.fetchAndActivate { _, _ in Task { @MainActor in MessageStore.shared.read(config) } }
    }

    private func read(_ config: RemoteConfig) {
        latest = InAppMessage.decode(config.configValue(forKey: Self.parameter).stringValue)
        update()
    }

    private func update() {
        current = latest.flatMap { $0.isShowable(dismissed: dismissed, devBuild: Self.isDevBuild) ? $0 : nil }
    }

    func didShow(_ m: InAppMessage) {
        guard shown.insert(m.id).inserted else { return }
        Analytics.track("In-App Message Shown", ["message_id": m.id, "style": m.styleName])
    }

    func handle(_ action: InAppMessageAction, on m: InAppMessage) {
        switch action {
        case .open(let link):
            Analytics.track("In-App Message Tapped", ["message_id": m.id])
            close(m)
            open(link)
        case .close:
            Analytics.track("In-App Message Dismissed", ["message_id": m.id])
            close(m)
        }
    }

    /// deals:// links stay inside the app (Deals has no URL scheme of its own); anything else
    /// opens in Safari.
    private func open(_ link: String) {
        guard let url = URL(string: link) else { return }
        if url.scheme == "deals" {
            let value = url.pathComponents.dropFirst().joined(separator: "/").removingPercentEncoding ?? ""
            switch url.host() {
            case "tab": DealsRouter.shared.tabRequest = value
            case "search": DealsRouter.shared.search(value)
            default: break
            }
        } else {
            UIApplication.shared.open(url)
        }
    }

    private func close(_ m: InAppMessage) {
        dismissed.insert(m.id)
        UserDefaults.standard.set(Array(dismissed).sorted(), forKey: Self.dismissedKey)
        withAnimation(.snappy) { update() }
    }
}

/// The card for one place, ready to drop at the top of a screen.
struct MessageCard: View {
    let place: String
    private var store: MessageStore { .shared }

    var body: some View {
        if let m = store.card(for: place) {
            InAppMessageCard(m) { store.handle($0, on: m) }
                .padding(.top, Space.m)
                .onAppear { store.didShow(m) }
        }
    }
}

/// The sheet version, shown once over whatever tab is open. Kept off while onboarding is up.
private struct MessageSheet: ViewModifier {
    let enabled: Bool
    @State private var showing: InAppMessage?
    private var store: MessageStore { .shared }

    func body(content: Content) -> some View {
        content
            .onChange(of: store.current, initial: true) { pick() }
            .onChange(of: enabled) { pick() }
            .sheet(item: $showing, onDismiss: {
                if let m = store.current, m.isSheet { store.handle(.close, on: m) }
            }) { m in
                InAppMessageSheet(m) { action in
                    showing = nil
                    store.handle(action, on: m)
                }
                .onAppear { store.didShow(m) }
            }
    }

    private func pick() {
        guard enabled, showing == nil, let m = store.current, m.isSheet else { return }
        showing = m
    }
}

extension View {
    /// Shows a message styled "sheet", once, when `enabled`.
    func inAppMessageSheet(enabled: Bool) -> some View { modifier(MessageSheet(enabled: enabled)) }
}
