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

    /// Taps a tab: in the tab bar on iPhone, in the top bar or sidebar on iPad.
    private func tab(_ name: String) {
        let started = Date()
        let inBar = app.tabBars.buttons[name]
        if inBar.waitForExistence(timeout: 3) {
            inBar.tap()
        } else {
            let any = app.buttons[name].firstMatch
            guard any.waitForExistence(timeout: 2) else { note("NO TAB \(name)"); return }
            any.tap()
        }
        note(String(format: "tab %@: tap returned after %.2fs", name, Date().timeIntervalSince(started)))
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

    func testWalk() throws {
        app.launch()
        pause(4)   // the first fetch
        shot("week")
        app.swipeUp()
        pause(0.6)
        shot("week-scrolled")

        tab("Aisles"); pause(0.8); shot("aisles")
        if tapFirst(labelContaining: "Bakery") {
            pause(1); shot("aisle-bakery")
            if tapFirst(labelContaining: "T&T Supermarket") { pause(0.8); shot("aisle-bakery-tnt") }
            let chip = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "All stores")).firstMatch
            if chip.exists {
                chip.press(forDuration: 0.1, thenDragTo: app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Not ending")).firstMatch)
                pause(0.5); shot("aisle-chips-dragged")
            }
            back(); pause(0.6)
        }

        tab("Stores"); pause(0.8); shot("stores")
        if tapFirst(labelContaining: "99 Ranch") { pause(1); shot("store-page"); back(); pause(0.6) }

        tab("List"); pause(0.8); shot("list")

        // Search: the field should be at the bottom on iPhone, with the keyboard up.
        tab("Search")
        pause(0.4); shot("search-just-opened")
        pause(1.2); shot("search-open")
        let field = app.searchFields.firstMatch
        note("search fields: \(app.searchFields.count), keyboards: \(app.keyboards.count)")
        if field.exists {
            let focused = (field.value(forKey: "hasKeyboardFocus") as? Bool) ?? false
            note("search field focused on arrival: \(focused); frame \(field.frame); screen \(app.windows.firstMatch.frame)")
            if !focused { field.tap(); pause(0.5) }
            field.typeText("Be"); pause(0.8); shot("search-be")
            field.typeText("ef"); pause(0.8); shot("search-beef")
            let scope = app.segmentedControls.buttons["Stores"]
            if scope.waitForExistence(timeout: 2) {
                scope.tap(); pause(0.8); shot("search-beef-stores")
                if tapFirst(labelContaining: "Search everything") { pause(0.8); shot("search-beef-everything") }
            } else {
                note("no scope bar while searching")
            }
            field.typeText("\n"); pause(1); shot("search-submitted")
            app.swipeUp(); pause(0.6); shot("search-results-scrolled")
        } else {
            note("NO SEARCH FIELD")
        }
    }
}
