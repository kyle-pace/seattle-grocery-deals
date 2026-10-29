import SwiftUI

/// First-run onboarding, reworked 2026-10-28: show the real week first, ask one light question
/// (your stores, vegetarian), show how it works with the app's own pieces, then KitchenUI's
/// usage question. Everything but the usage question can be skipped. Still no system
/// permission prompts here: Reminders and notifications are asked when they're first used.
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
            "App version, iPhone model and iOS version",
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

/// The steps: welcome (the real week), your stores, how it works, the usage question.
struct DealsOnboarding: View {
    private enum Step: Int, Hashable { case welcome, stores, howItWorks, question }

    let start: Onboarding.Start
    let onDone: () -> Void

    @Environment(FeedStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step: Step
    @State private var tour = "not_shown"
    @State private var picked: Set<String> = []
    @AccessibilityFocusState private var titleFocused: Bool

    init(start: Onboarding.Start, onDone: @escaping () -> Void) {
        self.start = start
        self.onDone = onDone
        let first: Step = switch start {
        case .welcome: .welcome
        case .question: .question
        case .tourOnly: .howItWorks
        }
        _step = State(initialValue: first)
    }

    var body: some View {
        ZStack {
            Palette.ground.ignoresSafeArea()
            switch step {
            case .welcome: welcome.transition(slide)
            case .stores: stores.transition(slide)
            case .howItWorks: howItWorks.transition(slide)
            case .question:
                Onboarding(buddy: .persimmon, appName: "Deals",
                           tagline: "This week's best sales at Seattle's specialty grocers.",
                           pages: [], question: Welcome.question, start: .question) { result in
                    if let share = result.shareUsage { Analytics.setSharing(share) }
                    // Only reaches Amplitude after a yes.
                    Analytics.track("Completed Onboarding", ["tour": tour, "stores_picked": picked.count,
                                                             "veg_only": store.vegetarianOnly, "start": "\(start)"])
                    onDone()
                }
                .transition(slide)
            }
        }
        .tint(Palette.accent)
        .interactiveDismissDisabled()
        .onAppear { picked = store.favoriteStores }
        .onChange(of: step) { focusTitle() }
    }

    // MARK: 1. Welcome: the real week, up front

    private var welcome: some View {
        StepScreen {
            topBar(label: nil) { tour = "skipped"; go(.question) }
        } content: {
            VStack(spacing: Space.l) {
                HStack(spacing: Space.m) {
                    Buddy(.persimmon, mood: .happy, size: 56).hiddenWhenTextIsLarge()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Welcome to Deals").font(.app(.title, .bold)).foregroundStyle(Palette.ink)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityFocused($titleFocused)
                        Text("The best sales at Seattle's specialty grocers, every Friday.")
                            .font(.app(.callout)).foregroundStyle(Palette.body)
                    }
                    Spacer(minLength: 0)
                }
                PreviewStack(deals: store.topPicks(3, perStore: 1))
                if let feed = store.feed {
                    Text("This week: \(store.items.count) deals from \(feed.stores.filter(\.readThisWeek).count) stores, read from each store's own flyer.")
                        .font(.app(.subheadline)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, Space.xl)
        } buttons: {
            Button { go(.stores) } label: { wide("Get started", prominent: true) }
                .buttonStyle(.borderedProminent)
        }
    }

    // MARK: 2. Your stores (one light question)

    private var stores: some View {
        StepScreen {
            topBar(label: "Step 1 of 2") { go(.howItWorks) }
        } content: {
            VStack(alignment: .leading, spacing: Space.l) {
                VStack(alignment: .leading, spacing: Space.s) {
                    Text("Where do you shop?").font(.app(.title, .bold)).foregroundStyle(Palette.ink)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($titleFocused)
                    Text("Pick any. Your stores show up first; every store stays in the app.")
                        .font(.app(.callout)).foregroundStyle(Palette.body)
                }
                FlowLayout(spacing: Space.s) {
                    ForEach(store.rankedStores.filter { !store.deals(atStore: $0.id).isEmpty }) { s in
                        let on = picked.contains(s.id)
                        FilterChip(s.name, count: store.deals(atStore: s.id).count, systemImage: on ? "heart.fill" : nil, isOn: on) {
                            if on { picked.remove(s.id) } else { picked.insert(s.id) }
                        }
                        .accessibilityHint(s.towns)
                    }
                }
                .sensoryFeedback(.selection, trigger: picked)

                VStack(alignment: .leading, spacing: Space.s) {
                    SectionHeader("Anything else?")
                    FilterChip("Vegetarian deals only", systemImage: "leaf", isOn: store.vegetarianOnly) {
                        store.vegetarianOnly.toggle()
                    }
                }
                .padding(.top, Space.s)
            }
            .padding(.horizontal, Space.xl)
        } buttons: {
            Button {
                store.favoriteStores = picked
                go(.howItWorks)
            } label: {
                wide(picked.isEmpty ? "Continue" : picked.count == 1 ? "Continue with 1 store" : "Continue with \(picked.count) stores", prominent: true)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    // MARK: 3. How it works, with the app's own pieces

    private var howItWorks: some View {
        StepScreen {
            topBar(label: start == .tourOnly ? nil : "Step 2 of 2", skipTitle: start == .tourOnly ? "Close" : "Skip") { finishTour(skipped: true) }
        } content: {
            VStack(alignment: .leading, spacing: Space.l) {
                Text("How it works").font(.app(.title, .bold)).foregroundStyle(Palette.ink)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($titleFocused)
                let sample = store.topPicks(1).first
                HowRow(title: "Tap + to add it to your list", detail: "Keep the list here, or in a Reminders list you share. The price and sale end come along.") {
                    MiniDeal(deal: sample)
                }
                HowRow(title: "Watch a price", detail: "Get a nudge when it drops. Turn on the Friday reminder in Settings, too.") {
                    Label("Watch price", systemImage: "bell")
                        .font(.app(.subheadline, .semibold)).foregroundStyle(Palette.ink)
                        .padding(.horizontal, Space.m).frame(minHeight: 40)
                        .glassEffect(.regular, in: .capsule)
                }
                HowRow(title: "Flip through the flyer", detail: "Every store's weekly ad, right in the app. Pinch to zoom.") {
                    FlyerThumb(page: store.rankedStores.compactMap { $0.viewablePages.first { $0.kind == .image } }.first,
                               size: CGSize(width: 48, height: 62))
                }
                HowRow(title: "Search from anywhere", detail: "Aisles, stores and deals. This week's deals show up in iPhone search, too.") {
                    Image(systemName: "magnifyingglass").font(.app(.title3, .semibold)).foregroundStyle(Palette.ink)
                        .frame(width: 48, height: 48).glassEffect(.regular, in: .circle)
                }
            }
            .padding(.horizontal, Space.xl)
        } buttons: {
            Button { finishTour(skipped: false) } label: { wide(start == .tourOnly ? "Done" : "Continue", prominent: true) }
                .buttonStyle(.borderedProminent)
        }
    }

    private func finishTour(skipped: Bool) {
        tour = skipped ? "skipped" : "finished"
        if start == .tourOnly {
            Analytics.track("Replayed Tour", ["tour": tour])
            onDone()
        } else {
            go(.question)
        }
    }

    // MARK: helpers

    private func topBar(label: String?, skipTitle: String = "Skip", skip: @escaping () -> Void) -> some View {
        HStack {
            if let label {
                Text(label).font(.app(.footnote, .semibold)).foregroundStyle(Palette.muted)
            }
            Spacer()
            Button(skipTitle, action: skip)
                .font(.app(.body, .semibold))
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityHint(skipTitle == "Close" ? "Closes the tour" : "Goes straight to the last step")
        }
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
        .task {
            for i in 1...max(deals.count, 1) {
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 220))
                withAnimation(reduceMotion ? nil : .spring(duration: 0.35, bounce: 0.4)) { shown = i }
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: shown)
    }
}

/// One step in "How it works": a real piece of the app on the left, words on the right.
private struct HowRow<Art: View>: View {
    let title: String
    let detail: String
    @ViewBuilder var art: Art

    var body: some View {
        HStack(alignment: .center, spacing: Space.m) {
            art.frame(minWidth: 72).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.app(.headline)).foregroundStyle(Palette.ink)
                Text(detail).font(.app(.subheadline)).foregroundStyle(Palette.body)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A deal's price and a + button, looking just like a row in the app (but not tappable).
private struct MiniDeal: View {
    let deal: Deal?
    var body: some View {
        HStack(spacing: Space.xs) {
            if let deal {
                Text(deal.amount).font(.app(.headline, .bold)).foregroundStyle(Palette.ink).monospacedDigit()
            }
            Image(systemName: "plus").font(.app(.subheadline, .bold)).foregroundStyle(Palette.ink)
                .frame(width: 32, height: 32)
                .background(Palette.raised, in: Circle())
        }
    }
}
