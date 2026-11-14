import SwiftUI
import UIKit

/// First-run onboarding, reworked 2026-10-28 and again 2026-11-07 for the crow: the crow and the
/// real week first, your stores (and Vegetarian), alerts, how it works with the app's own pieces,
/// then KitchenUI's usage question. Everything but the usage question can be skipped. Tidied
/// 2026-11-13: Skip on a middle step skips that step only (it used to jump to the question),
/// the first launch waits for the deals instead of showing empty cards, and the copy says
/// iPad on an iPad. The only
/// system prompt is notifications, and only after someone turns an alert on; Reminders is asked
/// when the list first uses it.
/// Installs that ran 0.1.0 (analytics on by default, before onboarding existed) skip it and
/// stay opted in.
@MainActor
enum Welcome {
    /// Where onboarding starts at this launch, or `nil` when there's nothing to show. Worked out
    /// once, in the App's init, before the first feed load saves a week.
    static let start: Onboarding.Start? = {
        // "Forget the usage answer" in the dev menu: onboarding from the start, once.
        if UserDefaults.standard.bool(forKey: forceKey) {
            UserDefaults.standard.removeObject(forKey: forceKey)
            return .welcome
        }
        // Simulator screenshots and the UI walk-through: -onboarding skip goes straight to the app.
        if DebugArgs.value("-onboarding") == "skip" { return nil }
        guard Analytics.choice == nil else { return nil }
        if DebugArgs.value("-onboarding") == "question" { return .question }
        if FeedStore.hasSavedWeek {
            // Already used 0.1.0, which shared by default: keep that, no onboarding.
            Analytics.setSharing(true)
            return nil
        }
        return .welcome
    }()

    static let forceKey = "sgd.dev.showOnboarding"

    static let question = UsageQuestion(
        title: "Help make Deals better?",
        message: "With your OK, Deals sends anonymous usage, so it's clear which features get used and what to fix next. It isn't linked to you.",
        shared: [
            "Screens you open and features you use",
            "Which deals you open, add or watch",
            "App version, device model and system version",
        ],
        neverShared: [
            "Anything you type, like list items or searches",
            "Your name, email, contacts or location",
            "Your IP address or advertising ID",
        ]
    )

    static func view(_ start: Onboarding.Start, onDone: @escaping () -> Void) -> some View {
        DealsOnboarding(start: start, onDone: onDone)
    }
}

/// The steps: welcome (the crow and the real week), your stores, alerts, how it works, then the
/// usage question. "Show the tour again" in Settings runs the same steps without the question,
/// with your stores and alerts filled in, so they can be changed there too.
struct DealsOnboarding: View {
    private enum Step: Int, Hashable { case welcome, stores, alerts, howItWorks, question }

    let start: Onboarding.Start
    let onDone: () -> Void

    @Environment(FeedStore.self) private var store
    @Environment(AlertsStore.self) private var alerts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step: Step
    @State private var tour = "not_shown"
    @State private var picked: Set<String> = []
    @State private var wantNewDeals = false
    @State private var wantEnding = false
    @State private var hop = 0
    @AccessibilityFocusState private var titleFocused: Bool

    init(start: Onboarding.Start, onDone: @escaping () -> Void) {
        self.start = start
        self.onDone = onDone
        let first: Step = switch start {
        case .welcome, .tourOnly: .welcome
        case .question: .question
        }
        _step = State(initialValue: first)
    }

    /// The steps this run walks through, in order.
    private var steps: [Step] {
        switch start {
        case .welcome: [.welcome, .stores, .alerts, .howItWorks, .question]
        case .tourOnly: [.welcome, .stores, .alerts, .howItWorks]
        case .question: [.question]
        }
    }

    var body: some View {
        ZStack {
            Palette.ground.ignoresSafeArea()
            switch step {
            case .welcome: welcome.transition(slide)
            case .stores: stores.transition(slide)
            case .alerts: alertsStep.transition(slide)
            case .howItWorks: howItWorks.transition(slide)
            case .question:
                Onboarding(buddy: .crow, appName: "Deals",
                           tagline: "This week's best sales at Seattle's specialty grocers.",
                           pages: [], question: Welcome.question, start: .question) { result in
                    if let share = result.shareUsage { Analytics.setSharing(share) }
                    // Only reaches Amplitude after a yes.
                    Analytics.track("Completed Onboarding", ["tour": tour, "stores_picked": picked.count,
                                                             "veg_only": store.vegetarianOnly, "start": "\(start)",
                                                             "new_deals_alert": alerts.friday, "ending_alert": alerts.endingSoon])
                    onDone()
                }
                .transition(slide)
            }
        }
        .tint(Palette.accent)
        .interactiveDismissDisabled()
        .onAppear {
            picked = store.favoriteStores
            wantNewDeals = alerts.friday
            wantEnding = alerts.endingSoon
        }
        .onChange(of: step) { focusTitle() }
    }

    // MARK: 1. Welcome: the crow and the real week, up front

    private var welcome: some View {
        StepScreen {
            topBar(label: nil) { skip() }
        } content: {
            VStack(spacing: Space.l) {
                ZStack {
                    Circle().fill(Palette.accent.opacity(0.12)).frame(width: 168, height: 168)
                    // Tap him: he hops and flaps (KitchenUI's CrowBuddy).
                    Buddy(.crow, mood: .happy, size: 140, hop: hop)
                }
                .hiddenWhenTextIsLarge()
                .task {
                    try? await Task.sleep(for: .milliseconds(450))
                    hop += 1
                }
                VStack(spacing: Space.s) {
                    Text("Welcome to Deals").font(.app(.largeTitle, .bold)).foregroundStyle(Palette.ink)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($titleFocused)
                    Text("This week's sales at Seattle's Asian markets, seafood shops and co-ops, the stores the big apps skip.")
                        .font(.app(.callout)).foregroundStyle(Palette.body).multilineTextAlignment(.center)
                }
                // A first launch has no deals yet (FeedStore starts empty and fetches): say so
                // here, and let the cards stamp in when the week arrives.
                let picks = store.topPicks(3, perStore: 1)
                if !picks.isEmpty {
                    PreviewStack(deals: picks)
                }
                if let feed = store.feed {
                    Text("\(store.live.count) deals from \(feed.stores.filter(\.readThisWeek).count) stores this week, read from each store's own flyer.")
                        .font(.app(.subheadline)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                } else if store.loading {
                    HStack(spacing: Space.s) {
                        ProgressView()
                        Text("Reading this week's flyers…")
                    }
                    .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, Space.xl)
        } buttons: {
            Button { next() } label: { wide(start == .tourOnly ? "Take the tour" : "Get started", prominent: true) }
                .buttonStyle(.borderedProminent)
        }
    }

    // MARK: 2. Your stores (and Vegetarian)

    private var stores: some View {
        StepScreen {
            topBar(label: label(.stores)) { saveStores(); skipStep() }
        } content: {
            VStack(alignment: .leading, spacing: Space.l) {
                VStack(alignment: .leading, spacing: Space.s) {
                    Text("Where do you shop?").font(.app(.title, .bold)).foregroundStyle(Palette.ink)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($titleFocused)
                    Text("Pick the stores you'd actually go to. Each week you'll see which one is worth the trip. You can change them anytime.")
                        .font(.app(.callout)).foregroundStyle(Palette.body)
                }
                // Every store, by name, with where it is: people recognize "the one near me" by
                // place, and a store whose flyer wasn't read this week can still be picked.
                let all = (store.feed?.stores ?? []).sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
                if all.isEmpty {
                    // Still fetching on a first launch, or nothing could be read at all.
                    Card(padding: Space.l) {
                        HStack(spacing: Space.m) {
                            if store.loading { ProgressView() }
                            Text(store.loading ? "Getting the list of stores…" : "The stores couldn't be loaded. You can pick them later from This week.")
                                .font(.app(.callout)).foregroundStyle(Palette.body)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                    }
                } else {
                    storeList(all)
                    Text("Not sure yet? Skip this and you'll see every store.")
                        .font(.app(.subheadline)).foregroundStyle(Palette.muted)
                }

                // Its own card, worded like the switch in Settings, so it doesn't read as one
                // more store.
                Card(padding: 0) {
                    AlertToggle(isOn: Binding(get: { store.vegetarianOnly }, set: { store.vegetarianOnly = $0 }),
                                title: "Vegetarian deals only",
                                detail: "Hides meat and seafood everywhere in the app.")
                }
            }
            .padding(.horizontal, Space.xl)
        } buttons: {
            Button { saveStores(); next() } label: {
                wide(picked.isEmpty ? "Continue" : picked.count == 1 ? "Continue with 1 store" : "Continue with \(picked.count) stores", prominent: true)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    /// Every store as a checklist row.
    private func storeList(_ all: [Store]) -> some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                ForEach(all) { s in
                    let on = picked.contains(s.id)
                    Button {
                        if on { picked.remove(s.id) } else { picked.insert(s.id) }
                    } label: {
                        HStack(spacing: Space.m) {
                            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                .font(.app(.title3)).foregroundStyle(on ? Palette.accent : Palette.muted)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.name).font(.app(.headline)).foregroundStyle(Palette.ink)
                                if !s.towns.isEmpty {
                                    Text(s.towns).font(.app(.subheadline)).foregroundStyle(Palette.muted)
                                } else if s.delivery != nil {
                                    Text("Delivers").font(.app(.subheadline)).foregroundStyle(Palette.muted)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, Space.l)
                        .frame(minHeight: 56)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .overlay(alignment: .bottom) {
                        if s.id != all.last?.id { Rectangle().fill(Palette.divider).frame(height: 1) }
                    }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: picked)
    }

    private func saveStores() {
        guard picked != store.favoriteStores else { return }
        store.favoriteStores = picked
        Analytics.track("Changed Your Stores", ["count": picked.count, "source": start == .tourOnly ? "tour" : "onboarding"])
    }

    // MARK: 3. Alerts (both off until chosen; iPhone asks only if one is turned on)

    private var alertsStep: some View {
        StepScreen {
            topBar(label: label(.alerts)) { skipStep() }
        } content: {
            VStack(alignment: .leading, spacing: Space.l) {
                HStack(alignment: .top, spacing: Space.m) {
                    VStack(alignment: .leading, spacing: Space.s) {
                        Text("Want a heads-up?").font(.app(.title, .bold)).foregroundStyle(Palette.ink)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityFocused($titleFocused)
                        Text("Deals only taps you on the shoulder when it matters. Pick any, or none.")
                            .font(.app(.callout)).foregroundStyle(Palette.body)
                    }
                    Spacer(minLength: 0)
                    Buddy(.crow, mood: .surprised, size: 56).hiddenWhenTextIsLarge()
                }
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        AlertToggle(isOn: $wantNewDeals, title: "New deals from your stores",
                                    detail: picked.isEmpty ? "When a store posts its new flyer." : "When a store you picked posts its new flyer.")
                            .overlay(alignment: .bottom) { Rectangle().fill(Palette.divider).frame(height: 1) }
                        AlertToggle(isOn: $wantEnding, title: "A sale on your list is ending",
                                    detail: "The morning before it ends.")
                    }
                }
                Text("Your \(device) asks for permission once, and only if you turn one on. You can change these anytime in Settings.")
                    .font(.app(.subheadline)).foregroundStyle(Palette.muted)
            }
            .padding(.horizontal, Space.xl)
        } buttons: {
            Button {
                Task {
                    await saveAlerts()
                    next()
                }
            } label: {
                wide(wantNewDeals || wantEnding ? "Turn on alerts" : "Continue without alerts", prominent: true)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func saveAlerts() async {
        var newDeals = wantNewDeals, ending = wantEnding
        if (newDeals || ending), !(await alerts.allow()) {
            // Said no to the iPhone's prompt: leave both off rather than pretend.
            newDeals = false; ending = false
            wantNewDeals = false; wantEnding = false
        }
        if alerts.friday != newDeals { alerts.friday = newDeals }
        if alerts.endingSoon != ending { alerts.endingSoon = ending }
    }

    // MARK: 4. How it works, with the app's own pieces

    private var howItWorks: some View {
        StepScreen {
            // Last stop of the tour: Continue is the only way on, so no Skip beside it.
            topBar(label: label(.howItWorks), skipTitle: start == .tourOnly ? "Close" : nil) { skip() }
        } content: {
            VStack(alignment: .leading, spacing: Space.l) {
                Text("How it works").font(.app(.title, .bold)).foregroundStyle(Palette.ink)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($titleFocused)
                HowRow(systemImage: "star.fill", title: "Your stores, best first",
                       detail: "This week ranks your stores by their deals and says why one is worth the trip. Each links to its weekly ad.")
                HowRow(systemImage: "plus", title: "Tap + to add a deal to your list",
                       detail: "Keep the list here, or in a Reminders list you share. The price and the day the sale ends come along.")
                HowRow(systemImage: "bell", title: "Watch a price",
                       detail: "Get a nudge when something you buy drops to your price.")
                HowRow(systemImage: "magnifyingglass", title: "Search everything",
                       detail: "Deals, aisles and stores. This week's deals show up in \(device) search, too.")
                HowRow(systemImage: "apps.iphone", title: "Widget and Siri",
                       detail: "Add the Best This Week widget to your Home Screen, or ask Siri what's on sale.")
            }
            .padding(.horizontal, Space.xl)
        } buttons: {
            Button { tour = "finished"; next() } label: { wide(start == .tourOnly ? "Done" : "Continue", prominent: true) }
                .buttonStyle(.borderedProminent)
        }
    }

    // MARK: moving between steps

    /// "Step 1 of 3" for the middle steps.
    private func label(_ s: Step) -> String? {
        let middle = steps.filter { $0 != .welcome && $0 != .question }
        guard let i = middle.firstIndex(of: s) else { return nil }
        return "Step \(i + 1) of \(middle.count)"
    }

    private func next() {
        guard let i = steps.firstIndex(of: step), i + 1 < steps.count else { finish(); return }
        go(steps[i + 1])
    }

    /// Skip on a middle step passes that step only: skipping the store picker used to skip the
    /// alerts too. A replayed tour shows Close there instead, which closes it.
    private func skipStep() {
        if start == .tourOnly { skip() } else { next() }
    }

    /// Skip on the welcome goes straight to the usage question on a first run; Close ends a
    /// replayed tour.
    private func skip() {
        if tour != "finished" { tour = "skipped" }
        if start == .tourOnly { finish() } else { go(.question) }
    }

    private func finish() {
        if start == .tourOnly {
            Analytics.track("Replayed Tour", ["tour": tour])
        }
        onDone()
    }

    // MARK: helpers

    /// "iPad" on an iPad: the copy used to say iPhone everywhere.
    private var device: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    /// The step count on the left and one way out on the right. With no title passed, a first
    /// run gets Skip and a replayed tour gets Close; `nil` leaves the button out.
    private func topBar(label: String?, skipTitle: String? = "", skip: @escaping () -> Void) -> some View {
        let title = skipTitle == "" ? (start == .tourOnly ? "Close" : "Skip") : skipTitle
        return HStack {
            if let label {
                Text(label).font(.app(.footnote, .semibold)).foregroundStyle(Palette.muted)
            }
            Spacer()
            if let title {
                Button(title, action: skip)
                    .font(.app(.body, .semibold))
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityHint(title == "Close" ? "Closes the tour"
                                       : label == nil ? "Goes straight to the last step" : "Skips this step")
            }
        }
        .frame(minHeight: 44)
    }

    private var slide: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                              removal: .move(edge: .leading).combined(with: .opacity))
    }

    private func go(_ next: Step) {
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .smooth) { step = next }
    }

    private func focusTitle() {
        titleFocused = false
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            titleFocused = true
        }
    }

    private func wide(_ title: String, prominent: Bool = false) -> some View {
        Text(title)
            .font(.app(.headline))
            .foregroundStyle(prominent ? AnyShapeStyle(Palette.onAccent) : AnyShapeStyle(.tint))
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentTransition(.numericText())
    }
}

/// One alert choice: a title, a line on when it comes, and a switch.
private struct AlertToggle: View {
    @Binding var isOn: Bool
    let title: String
    let detail: String

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.app(.headline)).foregroundStyle(Palette.ink)
                Text(detail).font(.app(.subheadline)).foregroundStyle(Palette.muted)
            }
        }
        .tint(Palette.accent)
        .padding(.horizontal, Space.l)
        .frame(minHeight: 64)
        .sensoryFeedback(.selection, trigger: isOn)
    }
}

/// A top row, content that scrolls when it has to, and buttons pinned to the bottom.
private struct StepScreen<Top: View, Content: View, Buttons: View>: View {
    @ViewBuilder var top: Top
    @ViewBuilder var content: Content
    @ViewBuilder var buttons: Buttons

    var body: some View {
        VStack(spacing: 0) {
            top.padding(.horizontal, Space.l).padding(.top, Space.s)
            ScrollView {
                content.padding(.vertical, Space.l).frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            VStack(spacing: Space.m) { buttons }
                .controlSize(.large)
                .padding(.horizontal, Space.xl)
                .padding(.top, Space.m)
                .padding(.bottom, Space.l)
        }
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }
}

/// Three of this week's real top picks, fanned like flyer clippings, stamping in one by one.
private struct PreviewStack: View {
    let deals: [Deal]
    @Environment(FeedStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = 0

    var body: some View {
        VStack(spacing: -Space.s) {
            ForEach(Array(deals.enumerated()), id: \.element.id) { i, d in
                HStack(alignment: .center, spacing: Space.m) {
                    VStack(alignment: .leading, spacing: 3) {
                        TierBadge(tier: d.tier)
                        Text(shortName(d.name)).font(.app(.headline)).foregroundStyle(Palette.ink).lineLimit(1)
                        Text(store.storeName(d.store)).font(.app(.subheadline)).foregroundStyle(Palette.muted)
                    }
                    Spacer(minLength: 0)
                    PriceTag(deal: d, size: 22)
                }
                .padding(Space.m)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: Radius.large))
                .overlay(RoundedRectangle(cornerRadius: Radius.large).strokeBorder(Palette.line.opacity(0.7)))
                .shadow(color: .black.opacity(0.12), radius: 8, y: 4)
                .rotationEffect(.degrees(reduceMotion ? 0 : [-2.0, 1.5, -1.0][i % 3]))
                .opacity(i < shown ? 1 : 0)
                .scaleEffect(i < shown || reduceMotion ? 1 : 1.12)
                .zIndex(Double(i))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("This week's top picks: " + deals.map { "\(shortName($0.name)), \($0.text) at \(store.storeName($0.store))" }.joined(separator: "; "))
        .task(id: deals.count) {
            for i in 1...max(deals.count, 1) {
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 220))
                withAnimation(reduceMotion ? nil : .spring(duration: 0.35, bounce: 0.4)) { shown = i }
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: shown)
    }
}

/// One step in "How it works": an icon in a fixed column, so every row's words line up.
private struct HowRow: View {
    let systemImage: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: Space.m) {
            Image(systemName: systemImage).font(.app(.title3, .semibold)).foregroundStyle(Palette.accent)
                .frame(width: 48, height: 48)
                .background(Palette.accent.opacity(0.12), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.app(.headline)).foregroundStyle(Palette.ink)
                Text(detail).font(.app(.subheadline)).foregroundStyle(Palette.body)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
