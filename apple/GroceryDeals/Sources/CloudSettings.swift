import Foundation

/// Your stores, the Vegetarian and "Not ending today" switches, hidden season cards and price
/// watches, kept in step across your iPhone and iPad through iCloud's key-value store
/// (NSUbiquitousKeyValueStore): a small store in the person's own iCloud, no account of ours, no
/// server. UserDefaults stays the app's copy; this only mirrors those keys both ways.
///
/// When two devices change the same setting, the last one to reach iCloud wins, which is fine for
/// settings. Two lists are merged instead of replaced when a device first joins: Your stores
/// (union) and price watches (union by item). The list itself syncs record by record through
/// CloudKit (ListSync.swift), and alerts, the usage answer and recent searches stay per device.
///
/// Signed out of iCloud, or iCloud off for the app: everything works as before, on one device.
@MainActor
final class CloudSettings {
    static let shared = CloudSettings()

    /// The keys that follow you between devices.
    static let keys = ["sgd.favoriteStores", "sgd.vegOnly", "sgd.hideEndingToday", "sgd.hiddenSeasons", "sgd.watches"]
    /// Posted (on the main queue) when iCloud brought newer values; userInfo["keys"] is [String].
    static let changed = Notification.Name("CloudSettingsChanged")

    private let cloud = NSUbiquitousKeyValueStore.default
    private let local = UserDefaults.standard
    private var started = false
    /// True while values from iCloud are being written locally, so the stores' didSet handlers
    /// don't send them straight back or count them as the person's own change.
    private(set) var applying = false

    func start() {
        guard !started, !CloudSettings.isDisabled else { return }
        started = true
        NotificationCenter.default.addObserver(forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
                                               object: cloud, queue: .main) { note in
            let keys = note.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String]
            let reason = note.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int
            MainActor.assumeIsolated { CloudSettings.shared.receive(keys ?? CloudSettings.keys, initial: reason == NSUbiquitousKeyValueStoreInitialSyncChange) }
        }
        cloud.synchronize()
        join()
    }

    /// Call after any of `keys` changes locally (the stores' didSet handlers do).
    func put(_ key: String) {
        guard started, !applying, Self.keys.contains(key) else { return }
        if let value = local.object(forKey: key) { cloud.set(value, forKey: key) } else { cloud.removeObject(forKey: key) }
    }

    /// First run on this device with iCloud: settings already in iCloud come down (lists merged
    /// with what's here), and anything only this device has goes up.
    private func join() {
        var arrived: [String] = []
        for key in Self.keys {
            guard let remote = cloud.object(forKey: key) else {
                if local.object(forKey: key) != nil { put(key) }
                continue
            }
            let merged = Self.merge(key, local: local.object(forKey: key), remote: remote)
            if !Self.same(merged, local.object(forKey: key)) {
                applying = true
                local.set(merged, forKey: key)
                applying = false
                arrived.append(key)
            }
            if !Self.same(merged, remote) { cloud.set(merged, forKey: key) }
        }
        announce(arrived)
    }

    private func receive(_ keys: [String], initial: Bool) {
        if initial { join(); return }
        var arrived: [String] = []
        applying = true
        for key in keys where Self.keys.contains(key) {
            let remote = cloud.object(forKey: key)
            guard !Self.same(remote, local.object(forKey: key)) else { continue }
            if let remote { local.set(remote, forKey: key) } else { local.removeObject(forKey: key) }
            arrived.append(key)
        }
        applying = false
        announce(arrived)
    }

    private func announce(_ keys: [String]) {
        guard !keys.isEmpty else { return }
        applying = true
        NotificationCenter.default.post(name: Self.changed, object: nil, userInfo: ["keys": keys])
        applying = false
        CloudActivity.received("settings")
    }

    // MARK: merging

    /// Lists are joined; anything else takes iCloud's value.
    static func merge(_ key: String, local: Any?, remote: Any) -> Any {
        switch key {
        case "sgd.favoriteStores", "sgd.hiddenSeasons":
            let mine = local as? [String] ?? [], theirs = remote as? [String] ?? []
            return Array(Set(mine).union(theirs)).sorted()
        case "sgd.watches":
            let decode = { (v: Any?) in (v as? Data).flatMap { try? JSONDecoder().decode([AlertsStore.Watch].self, from: $0) } ?? [] }
            var all = decode(remote)
            for w in decode(local) where !all.contains(where: { ($0.key ?? $0.name) == (w.key ?? w.name) }) { all.append(w) }
            return (try? JSONEncoder().encode(all)) ?? remote
        default:
            return remote
        }
    }

    static func same(_ a: Any?, _ b: Any?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case let (a as NSObject, b as NSObject): return a.isEqual(b)
        default: return false
        }
    }

    /// Off in unit tests and with `-noSync`, like the list's sync.
    static var isDisabled: Bool {
        let info = ProcessInfo.processInfo
        return info.environment["XCTestConfigurationFilePath"] != nil || info.arguments.contains("-noSync")
    }
}

/// One event a launch, the first time something arrives from another device: whether people use
/// Grocery Deals on more than one device is the question it answers. Nothing about what changed.
@MainActor
enum CloudActivity {
    private static var reported = Set<String>()
    static func received(_ kind: String) {
        guard reported.insert(kind).inserted else { return }
        Analytics.track("Received iCloud Changes", ["kind": kind])
    }
}
