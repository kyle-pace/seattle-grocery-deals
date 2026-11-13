import UIKit
import XCTest

/// Walks through the app the way the Nov 12 phone recording did, on whichever simulator it's run
/// on, and saves a screenshot of every step to /tmp/deals-shots/<phone|pad>/ on the Mac (a
/// simulator shares the Mac's disk). `notes.txt` there says what it found along the way.
final class WalkThrough: XCTestCase {
    private var app: XCUIApplication!
    private var dir: URL!
    private var step = 0
    private var notes: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = true
        let idiom = UIDevice.current.userInterfaceIdiom == .pad ? "pad" : "phone"
        dir = URL(fileURLWithPath: "/tmp/deals-shots/\(idiom)")
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        app = XCUIApplication()
        app.launchArguments = ["-onboarding", "skip"]
    }

    override func tearDownWithError() throws {
        try notes.joined(separator: "\n").write(to: dir.appendingPathComponent("notes.txt"), atomically: true, encoding: .utf8)
    }

    private func note(_ text: String) { notes.append(text) }

    private func shot(_ name: String) {
        step += 1
        let file = dir.appendingPathComponent(String(format: "%02d-%@.png", step, name))
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: file)
    }

    private func pause(_ seconds: TimeInterval) { Thread.sleep(forTimeInterval: seconds) }

    /// Taps a tab: in the tab bar on iPhone, in the top bar on iPad (which also lists every tab
    /// a second time, in a sidebar that's closed, so take the one that can be tapped).
    private func tab(_ name: String) {
        let started = Date()
        _ = app.buttons[name].firstMatch.waitForExistence(timeout: 3)
        let all = app.buttons.matching(identifier: name).allElementsBoundByIndex
        guard let target = all.first(where: { $0.isHittable }) ?? all.first else { note("NO TAB \(name)"); return }
        target.tap()
        note(String(format: "tab %@: %d found, tapped one at %@, %.2fs", name, all.count, "\(target.frame)", Date().timeIntervalSince(started)))
    }

    private func tapFirst(labelContaining text: String, in query: XCUIElementQuery? = nil) -> Bool {
        let found = (query ?? app.buttons).matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
        guard found.waitForExistence(timeout: 3) else { note("NOT FOUND: \(text)"); return false }
        found.tap()
        return true
    }

    private func back() {
        let b = app.navigationBars.buttons.firstMatch
        if b.exists { b.tap() } else { note("no back button") }
    }

    private func tapFirst(labelBeginning text: String) -> Bool {
        let found = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", text)).firstMatch
        guard found.waitForExistence(timeout: 3) else { note("NOT FOUND: \(text)…"); return false }
        found.tap()
        return true
    }

    private func listButtons(_ title: String) {
        let labels = app.buttons.allElementsBoundByIndex.prefix(60).map { $0.label.replacingOccurrences(of: "\n", with: " ").prefix(40) }
        note("\(title) buttons: " + labels.joined(separator: " | "))
    }

    /// A short one for the iPad: Stores, a store page, List, then Search.
    func testPad() throws {
        app.launch()
        pause(4)
        tab("Stores"); pause(1)
        let tile = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "99 Ranch Market")).firstMatch
        note("tile exists \(tile.exists) hittable \(tile.exists && tile.isHittable) frame \(tile.exists ? tile.frame : .zero)")
        if tile.exists { tile.tap(); pause(1.5); shot("pad-store-page") }
        note("nav bars: " + app.navigationBars.allElementsBoundByIndex.map { $0.identifier }.joined(separator: " | "))
        back(); pause(1); shot("pad-after-back")
        tab("List"); pause(1); shot("pad-list")
        tab("Search")
        pause(0.3); shot("pad-search-0.3")
        pause(1); shot("pad-search-1.3")
        pause(2); shot("pad-search-3.3")
        note("search fields: \(app.searchFields.count), keyboards: \(app.keyboards.count)")
        let field = app.searchFields.firstMatch
        if field.exists {
            let focused = (field.value(forKey: "hasKeyboardFocus") as? Bool) ?? false
            note("focused \(focused) frame \(field.frame)")
            if !focused { field.tap(); pause(0.6) }
            field.typeText("Beef"); pause(1); shot("pad-search-beef")
            let scope = app.segmentedControls.buttons["Stores"]
            if scope.waitForExistence(timeout: 2) { scope.tap(); pause(0.8); shot("pad-search-stores") }
            field.typeText("\n"); pause(1); shot("pad-search-submitted")
        }
    }

    private func hittable(_ name: String) -> Bool {
        app.buttons.matching(identifier: name).allElementsBoundByIndex.contains { $0.isHittable }
    }

    /// iPad: after a search, is there a way back to the other tabs?
    func testPadLeaveSearch() throws {
        app.launch()
        pause(4)
        tab("Stores"); pause(1)
        tab("Search"); pause(2.5)
        let field = app.searchFields.firstMatch
        guard field.waitForExistence(timeout: 3) else { note("NO SEARCH FIELD"); return }
        field.typeText("Beef\n"); pause(1.5); shot("leave-1-submitted")
        note("after submit: This week tappable \(hittable("This week")), keyboards \(app.keyboards.count)")
        note("top buttons: " + ["Close", "Cancel", "Clear text", "Search", "Toggle sidebar", "Done"].map { "\($0)=\(hittable($0))" }.joined(separator: " "))
        let clear = app.buttons["Clear text"].firstMatch
        if clear.exists { clear.tap(); pause(1.5); shot("leave-2-cleared") }
        note("after clear: This week tappable \(hittable("This week")), keyboards \(app.keyboards.count)")
        let hide = app.keyboards.buttons["Hide keyboard"].firstMatch
        if hide.exists { hide.tap(); pause(1.5); shot("leave-3-keyboard-hidden") }
        note("after hiding the keyboard: This week tappable \(hittable("This week")), search fields \(app.searchFields.count)")
        if hittable("This week") { tab("This week"); pause(1); shot("leave-4-this-week") }
    }

    func testWalk() throws {
        app.launch()
        pause(0.2); shot("launch")
        pause(4)   // the first fetch
        shot("week")

        tab("Aisles"); pause(0.8); shot("aisles")
        let bakery = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ AND label CONTAINS[c] %@", "Bakery", "deals")).firstMatch
        if bakery.waitForExistence(timeout: 3) {
            bakery.tap()
            pause(1); shot("aisle-bakery")
            if tapFirst(labelBeginning: "T&T Supermarket") { pause(0.8); shot("aisle-bakery-tnt") }
            let chip = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "All stores")).firstMatch
            let target = app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Not ending")).firstMatch
            if chip.exists, target.exists {
                chip.press(forDuration: 0.1, thenDragTo: target)
                pause(0.5); shot("aisle-chips-dragged")
            }
            back(); pause(0.6)
        }

        tab("Stores"); pause(0.8); shot("stores")
        if tapFirst(labelBeginning: "99 Ranch Market") { pause(1); shot("store-page"); back(); pause(0.6) }

        tab("List"); pause(0.8); shot("list")

        // Search: the field should be at the bottom on iPhone, with the keyboard up.
        tab("Search")
        pause(0.4); shot("search-just-opened")
        pause(2.5); shot("search-open")
        let field = app.searchFields.firstMatch
        note("search fields: \(app.searchFields.count), keyboards: \(app.keyboards.count), keys: \(app.keyboards.keys.count)")
        listButtons("search open")
        if field.exists {
            let focused = (field.value(forKey: "hasKeyboardFocus") as? Bool) ?? false
            note("search field focused on arrival: \(focused); frame \(field.frame); screen \(app.windows.firstMatch.frame)")
            if !focused { field.tap(); pause(0.5) }
            field.typeText("Be"); pause(0.8); shot("search-be")
            field.typeText("ef"); pause(0.8); shot("search-beef")
            let scope = app.segmentedControls.buttons["Stores"]
            if scope.waitForExistence(timeout: 2) {
                scope.tap(); pause(0.8); shot("search-beef-stores")
                if tapFirst(labelBeginning: "Search everything") { pause(0.8); shot("search-beef-everything") }
            } else {
                note("no scope bar while searching")
                listButtons("searching")
            }
            field.typeText("\n"); pause(1); shot("search-submitted")
            app.swipeUp(); pause(0.6); shot("search-results-scrolled")
            app.swipeDown(); pause(0.6)
            listButtons("after search")
            // Closing search should go back to the tab we came from (List).
            for name in ["Close", "Cancel", "Clear text"] {
                let b = app.buttons[name].firstMatch
                if b.exists { b.tap(); pause(1); shot("after-\(name.lowercased().replacingOccurrences(of: " ", with: "-"))") }
            }
        } else {
            note("NO SEARCH FIELD")
        }

        // The tab bar tucks away on scroll; this is how This week looks further down.
        tab("This week"); pause(0.8)
        app.swipeUp(); pause(0.6); shot("week-scrolled")
    }
}
