@preconcurrency import CloudKit
import Foundation
import UIKit

/// The in-app grocery list, kept in step across your iPhone and iPad through CloudKit: one record
/// per item in a "List" zone of the person's own private iCloud database, so items merge one by
/// one. Add milk on the iPhone and check off eggs on the iPad, even offline, and both changes
/// survive. No account of ours and no server: the records live in the person's iCloud.
/// Henwood's CloudSync is the model; this is the same pattern for one simple kind of record.
///
/// How a change gets around:
/// 1. ListStore saves through `ListStore.writeAppItems`, which hands the before and after lists to
///    `localChanges`. Added or changed items are queued as saves, removed ones as deletes.
/// 2. CKSyncEngine sends when it's ready, asking `nextRecordZoneChangeBatch` for the records.
/// 3. Changes from your other devices arrive as events. An item from iCloud replaces the one here
///    only if it was changed later (each item carries `changed`); otherwise this device's version
///    is sent back up.
///
/// A list kept in Reminders doesn't use this: Reminders syncs itself. The containers differ for
/// Deals and Deals Dev (Info.plist's DealsCloudContainer), so testing never touches a real list.
/// Builds from Xcode use CloudKit's development environment; TestFlight and the App Store use
/// production. Off in unit tests and with `-noSync`.
@MainActor @Observable
final class ListSync {
    static let shared = ListSync()
    static let zone = CKRecordZone.ID(zoneName: "List")
    static let recordType = "ListItem"

    enum Status: Equatable { case off(String), on, problem(String) }
    private(set) var status: Status = .off("Starting…")

    @ObservationIgnored private var engine: CKSyncEngine?
    @ObservationIgnored private let container: CKContainer? = {
        guard let id = Bundle.main.object(forInfoDictionaryKey: "DealsCloudContainer") as? String else { return nil }
        return CKContainer(identifier: id)
    }()
    @ObservationIgnored private let ledger = Ledger()

    func start() {
        guard engine == nil else { return }
        guard !CloudSettings.isDisabled, let container else {
            status = .off("Sync is off in this build.")
            return
        }
        let engine = CKSyncEngine(CKSyncEngine.Configuration(database: container.privateCloudDatabase,
                                                             stateSerialization: ledger.engineState, delegate: self))
        self.engine = engine
        if ledger.engineState == nil {
            // First run with sync: make the zone and send whatever list is already here.
            engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zone))])
            queueAll()
        }
        // CloudKit's silent pushes tell this device when another one changed the list. They need
        // no permission from the person, unlike alerts.
        UIApplication.shared.registerForRemoteNotifications()
        Task { await checkAccount() }
    }

    /// Coming back to the app: pick up anything a push didn't bring.
    func fetch() {
        guard let engine else { return }
        Task { try? await engine.fetchChanges() }
    }

    private func checkAccount() async {
        guard let container else { return }
        let status: Status
        switch try? await container.accountStatus() {
        case .available: status = .on
        case .noAccount: status = .off("Sign in to iCloud in the Settings app to sync your list and stores between devices.")
        case .restricted: status = .off("iCloud is restricted on this device.")
        case .temporarilyUnavailable: status = .off("iCloud is temporarily unavailable.")
        default: status = .off("Couldn't check iCloud.")
        }
        self.status = status
        Analytics.setUser(["icloud": status == .on ? "on" : "off"])
    }

    // MARK: local changes -> pending

    /// Called by ListStore.writeAppItems with the list before and after a local save.
    func localChanges(before: [ListStore.Item], after: [ListStore.Item]) {
        guard let engine else { return }
        let old = Dictionary(before.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let now = Set(after.map(\.id))
        var changes: [CKSyncEngine.PendingRecordZoneChange] = []
        for item in after where old[item.id] != item { changes.append(.saveRecord(Self.recordID(item.id))) }
        for id in old.keys where !now.contains(id) {
            changes.append(.deleteRecord(Self.recordID(id)))
            ledger.systemFields[id] = nil
        }
        guard !changes.isEmpty else { return }
        engine.state.add(pendingRecordZoneChanges: changes)
    }

    private func queueAll() {
        let changes = ListStore.savedAppItems().map { CKSyncEngine.PendingRecordZoneChange.saveRecord(Self.recordID($0.id)) }
        if !changes.isEmpty { engine?.state.add(pendingRecordZoneChanges: changes) }
    }

    static func recordID(_ id: String) -> CKRecord.ID { CKRecord.ID(recordName: id, zoneID: zone) }

    // MARK: records

    /// The record to send for an item, built on top of the last copy iCloud returned so CloudKit
    /// sees it as a change, not a clash. Nil when the item is gone (the delete is queued already).
    fileprivate func record(for id: CKRecord.ID) -> CKRecord? {
        guard let item = ListStore.savedAppItems().first(where: { $0.id == id.recordName }) else { return nil }
        let record = ledger.systemFields[item.id].flatMap(Self.decode) ?? CKRecord(recordType: Self.recordType, recordID: id)
        record["text"] = item.text as CKRecordValue
        record["done"] = (item.done ? 1 : 0) as CKRecordValue
        record["dealID"] = item.dealID as CKRecordValue?
        record["added"] = (item.added ?? .distantPast) as CKRecordValue
        record["changed"] = (item.changed ?? .distantPast) as CKRecordValue
        return record
    }

    private static func item(from record: CKRecord) -> ListStore.Item? {
        guard let text = record["text"] as? String else { return nil }
        let added = record["added"] as? Date, changed = record["changed"] as? Date
        return ListStore.Item(id: record.recordID.recordName, text: text, done: ((record["done"] as? Int) ?? 0) != 0,
                              dealID: record["dealID"] as? String,
                              added: added == .distantPast ? nil : added, changed: changed == .distantPast ? nil : changed)
    }

    /// Applies items from iCloud. Each one replaces this device's copy only when it was changed
    /// later; the ids of local copies that won are returned, to send back up.
    private func receive(_ records: [CKRecord], deleted: [String]) -> [String] {
        var list = ListStore.savedAppItems()
        var keepLocal: [String] = []
        for record in records {
            ledger.systemFields[record.recordID.recordName] = Self.encode(record)
            guard let remote = Self.item(from: record) else { continue }
            if let i = list.firstIndex(where: { $0.id == remote.id }) {
                let mine = list[i]
                if (mine.changed ?? .distantPast) > (remote.changed ?? .distantPast) { keepLocal.append(mine.id); continue }
                list[i] = remote
            } else {
                list.append(remote)
            }
        }
        list.removeAll { deleted.contains($0.id) }
        // Newest first, like the list is made; items from before sync keep their place at the end.
        list = list.enumerated().sorted { a, b in
            let da = a.element.added ?? .distantPast, db = b.element.added ?? .distantPast
            return da != db ? da > db : a.offset < b.offset
        }.map(\.element)
        ListStore.writeAppItems(list, fromCloud: true)
        if !records.isEmpty || !deleted.isEmpty { CloudActivity.received("list") }
        return keepLocal
    }

    // MARK: events

    fileprivate func handle(_ event: CKSyncEngine.Event) {
        switch event {
        case .stateUpdate(let e):
            ledger.engineState = e.stateSerialization

        case .accountChange(let e):
            switch e.changeType {
            case .signIn, .switchAccounts:
                ledger.systemFields = [:]
                queueAll()
            case .signOut:
                // The list stays on this device; it goes up again if they sign back in.
                ledger.systemFields = [:]
            @unknown default: break
            }
            Task { await checkAccount() }

        case .fetchedDatabaseChanges(let e):
            if e.deletions.contains(where: { $0.zoneID == Self.zone }) {
                // The zone was deleted (iCloud data cleared): keep the list here and send it again.
                ledger.systemFields = [:]
                engine?.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zone))])
                queueAll()
            }

        case .fetchedRecordZoneChanges(let e):
            let pendingSaves = Set(engine?.state.pendingRecordZoneChanges.compactMap { change -> String? in
                if case .saveRecord(let id) = change { id.recordName } else { nil }
            } ?? [])
            // Changed here after it was deleted elsewhere: the newer change brings it back.
            let deleted = e.deletions.map(\.recordID.recordName).filter { !pendingSaves.contains($0) }
            for id in deleted { ledger.systemFields[id] = nil }
            let again = receive(e.modifications.map(\.record), deleted: deleted)
            if !again.isEmpty { engine?.state.add(pendingRecordZoneChanges: again.map { .saveRecord(Self.recordID($0)) }) }

        case .sentRecordZoneChanges(let e):
            for record in e.savedRecords { ledger.systemFields[record.recordID.recordName] = Self.encode(record) }
            var again: [CKSyncEngine.PendingRecordZoneChange] = []
            for failure in e.failedRecordSaves {
                let id = failure.record.recordID
                switch failure.error.code {
                case .serverRecordChanged:
                    // Both devices changed it: the newer one wins, and this one is resent if it's ours.
                    if let server = failure.error.serverRecord, receive([server], deleted: []).contains(id.recordName) {
                        again.append(.saveRecord(id))
                    }
                case .zoneNotFound:
                    engine?.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zone))])
                    ledger.systemFields[id.recordName] = nil
                    again.append(.saveRecord(id))
                case .unknownItem:
                    ledger.systemFields[id.recordName] = nil
                    again.append(.saveRecord(id))
                case .networkFailure, .networkUnavailable, .zoneBusy, .serviceUnavailable,
                     .notAuthenticated, .operationCancelled, .requestRateLimited:
                    break   // the engine retries these by itself
                default:
                    status = .problem("Couldn't sync your list: \(failure.error.localizedDescription)")
                }
            }
            if !again.isEmpty { engine?.state.add(pendingRecordZoneChanges: again) }
            if e.failedRecordSaves.isEmpty, case .problem = status { status = .on }

        default:
            break
        }
    }

    // MARK: the ledger

    private static func encode(_ record: CKRecord) -> Data {
        let coder = NSKeyedArchiver(requiringSecureCoding: true)
        record.encodeSystemFields(with: coder)
        return coder.encodedData
    }

    private static func decode(_ data: Data) -> CKRecord? {
        guard let coder = try? NSKeyedUnarchiver(forReadingFrom: data) else { return nil }
        coder.requiresSecureCoding = true
        return CKRecord(coder: coder)
    }

    /// What CloudKit needs remembered between launches: the engine's state, and each record's
    /// system fields (its change tag), kept in Application Support.
    private final class Ledger {
        private let url = URL.applicationSupportDirectory.appending(path: "list-sync.plist")
        private struct Saved: Codable {
            var engineState: Data?
            var systemFields: [String: Data] = [:]
        }
        private var saved: Saved

        init() {
            saved = (try? Data(contentsOf: url)).flatMap { try? PropertyListDecoder().decode(Saved.self, from: $0) } ?? Saved()
        }

        var engineState: CKSyncEngine.State.Serialization? {
            get { saved.engineState.flatMap { try? JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: $0) } }
            set { saved.engineState = newValue.flatMap { try? JSONEncoder().encode($0) }; write() }
        }
        var systemFields: [String: Data] {
            get { saved.systemFields }
            set { saved.systemFields = newValue; write() }
        }

        private func write() {
            try? FileManager.default.createDirectory(at: URL.applicationSupportDirectory, withIntermediateDirectories: true)
            try? PropertyListEncoder().encode(saved).write(to: url, options: .atomic)
        }
    }
}

extension ListSync: CKSyncEngineDelegate {
    nonisolated func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
        await MainActor.run { self.handle(event) }
    }

    nonisolated func nextRecordZoneChangeBatch(_ context: CKSyncEngine.SendChangesContext, syncEngine: CKSyncEngine) async -> CKSyncEngine.RecordZoneChangeBatch? {
        let scope = context.options.scope
        let changes = await MainActor.run { syncEngine.state.pendingRecordZoneChanges.filter { scope.contains($0) } }
        guard !changes.isEmpty else { return nil }
        return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: changes) { id in
            await MainActor.run { self.record(for: id) }
        }
    }
}
