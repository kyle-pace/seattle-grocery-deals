@preconcurrency import FirebaseCore
@preconcurrency import FirebaseMessaging
import SwiftUI
import UIKit
import UserNotifications

/// Server push through Firebase Cloud Messaging topics. The phone subscribes itself; GitHub
/// Actions sends "New deals are in" to `new-deals` when a new week goes live. No device tokens
/// are stored anywhere of ours, and Firebase Analytics is never added (Amplitude is the tool).
///
/// Firebase is only set up when a config file is bundled: `GoogleService-Info-Dev.plist` for
/// Debug builds, `GoogleService-Info-Prod.plist` for Release (falling back to Dev until the
/// prod project exists). Without one, the app keeps its local Friday reminder.
@MainActor @Observable
final class PushStore {
    static let shared = PushStore()

    /// True once Firebase is configured, so "New deals are in" can come from the server.
    private(set) var available = false
    /// Bumped when a push is tapped; RootView opens This week and fetches the latest week.
    private(set) var opens = 0

    private var wantsNewDeals = false
    /// Phones on the dev Firebase project (Kyle's, for now) also join the test topic.
    private var devProject = false
    private static let subscribedKey = "sgd.push.topics"

    func configure() {
        guard FirebaseApp.app() == nil, let options = Self.options() else { return }
        FirebaseApp.configure(options: options)
        available = true
        devProject = options.projectID?.hasSuffix("-dev") ?? false
        // Clear a local Friday reminder left from before push, so it doesn't double up.
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["friday"])
    }

    /// Called at launch and whenever the "New deals are in" switch changes.
    func sync(newDeals: Bool) {
        guard available else { return }
        wantsNewDeals = newDeals
        if newDeals {
            // Safe to call on every launch; Apple hands back the same token and calls the
            // app delegate, which passes it to Firebase and comes back to updateTopics().
            UIApplication.shared.registerForRemoteNotifications()
        }
        Task { await updateTopics() }
    }

    func didRegister(_ deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        Task { await updateTopics() }
    }

    func opened(kind: String, week: String?) {
        opens += 1
        Analytics.track("Opened Push", ["kind": kind, "week": week ?? ""])
    }

    /// Topics this phone should be in. On the dev project it also joins the test topic, so
    /// test sends from the workflow reach only development phones. (install-on-iphone.sh
    /// builds Release, so this goes by project, not by Debug or Release.)
    private var wanted: Set<String> {
        guard wantsNewDeals else { return [] }
        return devProject ? ["new-deals", "new-deals-test"] : ["new-deals"]
    }

    private func updateTopics() async {
        let messaging = Messaging.messaging()
        // Subscribing needs a registration token, which needs the APNs token first.
        if !wanted.isEmpty && messaging.apnsToken == nil { return }
        var current = Set(UserDefaults.standard.stringArray(forKey: Self.subscribedKey) ?? [])
        for topic in wanted.subtracting(current) {
            do { try await messaging.subscribe(toTopic: topic); current.insert(topic) }
            catch { print("Push: couldn't subscribe to \(topic): \(error)") }
        }
        for topic in current.subtracting(wanted) {
            do { try await messaging.unsubscribe(fromTopic: topic); current.remove(topic) }
            catch { print("Push: couldn't unsubscribe from \(topic): \(error)") }
        }
        UserDefaults.standard.set(current.sorted(), forKey: Self.subscribedKey)
    }

    private static func options() -> FirebaseOptions? {
        #if DEBUG
        let names = ["GoogleService-Info-Dev"]
        #else
        let names = ["GoogleService-Info-Prod", "GoogleService-Info-Dev"]
        #endif
        for name in names {
            if let path = Bundle.main.path(forResource: name, ofType: "plist"),
               let options = FirebaseOptions(contentsOfFile: path) { return options }
        }
        return nil
    }
}

/// Hands the APNs token to Firebase. Swizzling is off (FirebaseAppDelegateProxyEnabled = NO),
/// so this is the only path the token takes.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PushStore.shared.configure()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushStore.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Push: APNs registration failed: \(error)")
    }
}
