import SafariServices
import SwiftUI
import UIKit

// The weekly ad is never shown inside the app: no page images, no PDFs, no thumbnails. The app
// links out to the store's own flyer page and opens it in Safari's viewer, so the flyer stays
// on the store's site (decided 2026-11-01).

/// The card at the top of a store page: "Weekly ad · On H Mart's site · 2 days left".
struct FlyerCard: View {
    let store: Store
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: Space.m) {
                Image(systemName: "newspaper")
                    .font(.app(.title3)).foregroundStyle(Palette.muted)
                    .frame(width: 48, height: 48)
                    .background(Palette.raised, in: RoundedRectangle(cornerRadius: Radius.small))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Weekly ad").font(.app(.headline)).foregroundStyle(Palette.ink)
                    Text(detail).font(.app(.subheadline)).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.app(.subheadline, .semibold)).foregroundStyle(Palette.muted)
                    .accessibilityHidden(true)
            }
            .padding(Space.m)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: Radius.large))
            .overlay(RoundedRectangle(cornerRadius: Radius.large).strokeBorder(Palette.line.opacity(0.7)))
            .contentShape(RoundedRectangle(cornerRadius: Radius.large))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens \(store.name)'s weekly ad on their site")
    }

    private var detail: String {
        var parts = ["On \(store.name)'s site"]
        if store.readThisWeek, let through = Dates.date(store.through) {
            let cal = Calendar.current
            let left = (cal.dateComponents([.day], from: cal.startOfDay(for: .now), to: cal.startOfDay(for: through)).day ?? 0) + 1
            if left == 1 { parts.append("Ends today") }
            else if left > 1 { parts.append("\(left) days left") }
        }
        return parts.joined(separator: " · ")
    }
}

/// Opens the store's flyer page in Safari's viewer.
struct FlyerPresenter: ViewModifier {
    let store: Store
    @Binding var isPresented: Bool

    func body(content: Content) -> some View {
        content
            .fullScreenCover(isPresented: $isPresented) {
                if let url = store.flyerLinkURL {
                    SafariView(url: url) { isPresented = false }.ignoresSafeArea()
                }
            }
            .onChange(of: isPresented) { _, open in
                if open { Analytics.track("Opened Weekly Ad", ["store": store.id]) }
            }
    }
}

extension View {
    func flyer(for store: Store, isPresented: Binding<Bool>) -> some View {
        modifier(FlyerPresenter(store: store, isPresented: isPresented))
    }
}

/// Safari's own viewer: proper chrome, Reader, and the store's page in its own look instead of
/// a bare web view.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    /// Safari's Done button dismisses from UIKit; this tells SwiftUI so the binding resets.
    var onDone: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    @MainActor final class Coordinator: NSObject, @MainActor SFSafariViewControllerDelegate {
        let onDone: () -> Void
        init(onDone: @escaping () -> Void) { self.onDone = onDone }
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { onDone() }
    }

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        let vc = SFSafariViewController(url: url, configuration: config)
        vc.preferredControlTintColor = UIColor(Palette.accent)
        vc.dismissButtonStyle = .close
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}
