import AppIntents
import Foundation

/// Opens Deals on the List tab with the keyboard up, ready to type an item. Used by the
/// Control Center, Lock Screen and Action button control (Widget/DealsControls.swift). Lives in
/// both the app and the widget extension; it does its work in the app. Siri's own "Add to my
/// grocery list in Deals" (Sources/Intents.swift) adds without opening the app.
struct OpenAddToListIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Add to List"
    static let description = IntentDescription("Opens the app on your grocery list, ready to type an item.")
    static let openAppWhenRun = true
    /// Only the control uses it; Shortcuts has "Add to Grocery List", which takes the item itself.
    static let isDiscoverable = false

    @MainActor
    func perform() async throws -> some IntentResult {
        #if DEALS_APP
        DealsRouter.shared.startAdding()
        Analytics.track("Opened Add to List Control")
        #endif
        return .result()
    }
}
