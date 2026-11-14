import AppIntents

/// Siri AI tools (the iOS 27.3 Developer Preview), set up the way Henwood's are. Siri's model
/// can pick these intents and fill them from what the person said, whenever the request names
/// Deals, Deals is on screen, or Siri found one of its deals in Spotlight. The skill that ties
/// them together is in Skills.skillsbundle.
///
/// The intents themselves ship on iOS 26 for Shortcuts and the App Shortcuts phrases, so the
/// conformance is a gated extension. Only SDKs with ToolIntent (AppIntents 301.2, Xcode 27.3
/// beta and later) compile this, so a release Xcode that's older, like Xcode Cloud's, builds
/// the app without it.
///
/// Left out on purpose: Search Deals, Open Store and Open Deal (they only open the app; Siri
/// reads the deals themselves from Spotlight, and Apple says not to write search tools).
#if canImport(AppIntents, _version: 301.2)

@available(iOS 27.3, *)
extension AddToListIntent: ToolIntent {}

@available(iOS 27.3, *)
extension ListOnSaleIntent: ToolIntent {}

@available(iOS 27.3, *)
extension BestDealsIntent: ToolIntent {}

@available(iOS 27.3, *)
extension StoreDealsIntent: ToolIntent {}

@available(iOS 27.3, *)
extension CheckSaleIntent: ToolIntent {}

@available(iOS 27.3, *)
extension PlanTripIntent: ToolIntent {}

#endif
