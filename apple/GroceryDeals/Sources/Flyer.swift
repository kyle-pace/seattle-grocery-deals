import PDFKit
import SafariServices
import SwiftUI
import UIKit

// The weekly ad, shown in the app's own viewer: page images (or a PDF) on black, swipe between
// pages, pinch or double-tap to zoom, a page strip at the bottom, and a way out to the store's
// site. Stores with only a web page open it in Safari's own viewer, never squeezed into the
// store page under the segmented control.

/// The card at the top of a store page: "Weekly ad · 9 pages · 2 days left".
struct FlyerCard: View {
    let store: Store
    let open: () -> Void

    var body: some View {
        let pages = store.viewablePages
        Button(action: open) {
            HStack(spacing: Space.m) {
                FlyerThumb(page: pages.first, size: CGSize(width: 56, height: 72))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Weekly ad").font(.app(.headline)).foregroundStyle(Palette.ink)
                    Text(detail(pages)).font(.app(.subheadline)).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: pages.isEmpty ? "arrow.up.right" : "chevron.right")
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
        .accessibilityHint(pages.isEmpty ? "Opens the store's flyer page" : "Opens the flyer")
    }

    private func detail(_ pages: [Store.FlyerPage]) -> String {
        var parts: [String] = []
        if pages.count == 1, pages[0].kind == .pdf { parts.append("PDF") }
        else if pages.count == 1 { parts.append("1 page") }
        else if pages.count > 1 { parts.append("\(pages.count) pages") }
        else { parts.append("On the store's site") }
        if store.readThisWeek, let through = Dates.date(store.through) {
            let cal = Calendar.current
            let left = (cal.dateComponents([.day], from: cal.startOfDay(for: .now), to: cal.startOfDay(for: through)).day ?? 0) + 1
            if left == 1 { parts.append("Ends today") }
            else if left > 1 { parts.append("\(left) days left") }
        }
        return parts.joined(separator: " · ")
    }
}

/// A small preview of a flyer page: the image itself, or a symbol for a PDF or web page.
struct FlyerThumb: View {
    let page: Store.FlyerPage?
    let size: CGSize

    var body: some View {
        ZStack {
            Palette.raised
            if let page, page.kind == .image, let url = URL(string: page.url) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Image(systemName: "newspaper").foregroundStyle(Palette.muted)
                    }
                }
            } else {
                Image(systemName: page?.kind == .pdf ? "doc.richtext" : "safari").font(.app(.title3)).foregroundStyle(Palette.muted)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: Radius.small))
        .overlay(RoundedRectangle(cornerRadius: Radius.small).strokeBorder(Palette.line))
        .accessibilityHidden(true)
    }
}

/// Opens the right thing for a store's weekly ad.
struct FlyerPresenter: ViewModifier {
    let store: Store
    @Binding var isPresented: Bool

    func body(content: Content) -> some View {
        content
            .fullScreenCover(isPresented: $isPresented) {
                if !store.viewablePages.isEmpty {
                    FlyerViewer(store: store)
                } else if let url = store.flyerWebURL {
                    SafariView(url: url).ignoresSafeArea()
                }
            }
            .onChange(of: isPresented) { _, open in
                if open { Analytics.track("Opened Weekly Ad", ["store": store.id, "pages": store.viewablePages.count]) }
            }
    }
}

extension View {
    func flyer(for store: Store, isPresented: Binding<Bool>) -> some View {
        modifier(FlyerPresenter(store: store, isPresented: isPresented))
    }
}

/// The full-screen flyer.
struct FlyerViewer: View {
    let store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0
    @State private var chromeHidden = false

    var body: some View {
        let pages = store.viewablePages
        NavigationStack {
            TabView(selection: $page) {
                ForEach(Array(pages.enumerated()), id: \.element.id) { i, p in
                    FlyerPageView(page: p) { withAnimation(.snappy) { chromeHidden.toggle() } }
                        .tag(i)
                        .accessibilityLabel("\(store.name) flyer, \(p.label)")
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .background(Color.black)
            .ignoresSafeArea()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(store.name).font(.app(.headline)).foregroundStyle(.white)
                        if pages.indices.contains(page) {
                            Text(pages.count > 1 ? "\(page + 1) of \(pages.count) · \(pages[page].label)" : pages[page].label)
                                .font(.app(.caption)).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                                .contentTransition(.numericText())
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu("More", systemImage: "ellipsis") {
                        if pages.indices.contains(page), let url = URL(string: pages[page].url) {
                            ShareLink(item: url) { Label("Share this page", systemImage: "square.and.arrow.up") }
                        }
                        if let site = store.flyerWebURL {
                            Link(destination: site) { Label("Open on \(store.name)'s site", systemImage: "safari") }
                        }
                    }
                }
            }
            .toolbarVisibility(chromeHidden ? .hidden : .visible, for: .navigationBar)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if pages.count > 1 && !chromeHidden {
                    PageStrip(pages: pages, current: $page)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .statusBarHidden(chromeHidden)
        }
        .preferredColorScheme(.dark)
        .sensoryFeedback(.selection, trigger: page)
    }
}

/// The row of page thumbnails under the flyer. The current page is outlined.
private struct PageStrip: View {
    let pages: [Store.FlyerPage]
    @Binding var current: Int

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Space.s) {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { i, p in
                        Button { withAnimation(.snappy) { current = i } } label: {
                            FlyerThumb(page: p, size: CGSize(width: 44, height: 58))
                                .overlay(RoundedRectangle(cornerRadius: Radius.small).strokeBorder(i == current ? Palette.accent : .clear, lineWidth: 2.5))
                                .opacity(i == current ? 1 : 0.6)
                        }
                        .buttonStyle(.plain)
                        .frame(minWidth: 44, minHeight: 44)
                        .id(i)
                        .accessibilityLabel("Page \(i + 1), \(p.label)")
                        .accessibilityAddTraits(i == current ? .isSelected : [])
                    }
                }
                .padding(.horizontal, Space.l)
                .padding(.vertical, Space.s)
            }
            .glassEffect(.regular, in: .capsule)
            .padding(.horizontal, Space.l)
            .padding(.bottom, Space.s)
            .onChange(of: current) { _, i in withAnimation { proxy.scrollTo(i, anchor: .center) } }
        }
    }
}

/// One page: an image or a PDF, loading with the persimmon, failing with a way out.
private struct FlyerPageView: View {
    let page: Store.FlyerPage
    let onTap: () -> Void

    var body: some View {
        if let url = URL(string: page.url) {
            switch page.kind {
            case .pdf: PDFPage(url: url)
            default: ZoomableRemoteImage(url: url, onTap: onTap)
            }
        } else {
            FlyerFailed(url: nil)
        }
    }
}

private struct FlyerLoading: View {
    var body: some View {
        WorkingView(.persimmon, title: Lines.pick(Lines.flyerLoading), compact: true)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct FlyerFailed: View {
    let url: URL?
    var body: some View {
        EmptyState(.persimmon, mood: .sad, title: "Couldn't load this page",
                   message: "The store may have moved it. It might still be on their site.")
            .overlay(alignment: .bottom) {
                if let url {
                    Link("Open the page", destination: url).font(.app(.headline)).padding(.bottom, Space.xl)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Downloads a page image and shows it fitted to the width, zoomable.
private struct ZoomableRemoteImage: View {
    enum Phase { case loading, loaded(UIImage), failed }
    let url: URL
    let onTap: () -> Void
    @State private var phase: Phase = .loading

    var body: some View {
        Group {
            switch phase {
            case .loading: FlyerLoading()
            case .loaded(let image): ZoomableImage(image: image, onTap: onTap).ignoresSafeArea()
            case .failed: FlyerFailed(url: url)
            }
        }
        .task(id: url) {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let image = UIImage(data: data) { phase = .loaded(image) } else { phase = .failed }
            } catch {
                phase = .failed
            }
        }
    }
}

/// A UIScrollView around the image: fit to width, pinch to zoom up to 5x, double-tap to zoom
/// in where you tapped (or back out), single tap to hide the chrome.
private struct ZoomableImage: UIViewRepresentable {
    let image: UIImage
    let onTap: () -> Void

    func makeUIView(context: Context) -> ZoomingImageView {
        let view = ZoomingImageView(image: image)
        view.onSingleTap = onTap
        return view
    }

    func updateUIView(_ view: ZoomingImageView, context: Context) {
        view.onSingleTap = onTap
    }
}

final class ZoomingImageView: UIScrollView, UIScrollViewDelegate {
    private let imageView = UIImageView()
    private var laidOutFor: CGSize = .zero
    var onSingleTap: (() -> Void)?

    init(image: UIImage) {
        super.init(frame: .zero)
        delegate = self
        imageView.image = image
        imageView.contentMode = .scaleAspectFit
        imageView.isAccessibilityElement = true
        imageView.accessibilityTraits = .image
        addSubview(imageView)
        minimumZoomScale = 1
        maximumZoomScale = 5
        bouncesZoom = true
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        backgroundColor = .black
        decelerationRate = .fast

        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        double.numberOfTapsRequired = 2
        addGestureRecognizer(double)
        let single = UITapGestureRecognizer(target: self, action: #selector(singleTapped))
        single.require(toFail: double)
        addGestureRecognizer(single)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let image = imageView.image, image.size.width > 0, bounds.width > 0 else { return }
        if bounds.size != laidOutFor {
            laidOutFor = bounds.size
            zoomScale = 1
            let height = bounds.width * image.size.height / image.size.width
            imageView.frame = CGRect(x: 0, y: 0, width: bounds.width, height: height)
            contentSize = imageView.frame.size
            contentOffset = .zero
        }
        center()
    }

    /// Short pages sit in the middle of the screen; tall ones start at the top and scroll.
    private func center() {
        let y = max(0, (bounds.height - contentSize.height) / 2)
        let x = max(0, (bounds.width - contentSize.width) / 2)
        contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { center() }

    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale + 0.01 {
            setZoomScale(minimumZoomScale, animated: true)
        } else {
            let point = gesture.location(in: imageView)
            let scale: CGFloat = 2.5
            let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }

    @objc private func singleTapped() { onSingleTap?() }
}

/// A PDF flyer, scrolling page after page, zoomable.
private struct PDFPage: View {
    let url: URL
    @State private var document: PDFDocument?
    @State private var failed = false

    var body: some View {
        Group {
            if let document {
                PDFKitView(document: document).ignoresSafeArea()
            } else if failed {
                FlyerFailed(url: url)
            } else {
                FlyerLoading()
            }
        }
        .task(id: url) {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let doc = PDFDocument(data: data) { document = doc } else { failed = true }
            } catch {
                failed = true
            }
        }
    }
}

private struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.document = document
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .black
        view.pageShadowsEnabled = false
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}

/// Safari's own viewer, for stores whose flyer is only a web page: proper chrome, Reader, and
/// the store's page in its own light or dark look instead of a bare web view.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        let vc = SFSafariViewController(url: url, configuration: config)
        vc.preferredControlTintColor = UIColor(Palette.accent)
        vc.dismissButtonStyle = .close
        return vc
    }

    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}
