import BrambleCore
import SwiftUI
import WebKit

/// The in-app browser (P16): an address bar that opens `https` sites only, over a `WKWebView` that
/// injects the extension's provider (`mobile/web/bramble-provider.generated.js`) at document start
/// in the main frame only. Nothing the web stores outlives the screen (a non-persistent data
/// store), and WebKit's fraudulent-website warning stays on. A site's connection request opens the
/// connection card over it.
struct BrowserView: View {
    /// The injected script, bundled from `mobile/web`. Without it the browser does not open.
    static let providerScript: String? = Bundle.main
        .url(forResource: "bramble-provider.generated", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }

    @Environment(WalletStore.self) private var store
    @State private var input = ""
    @State private var page: URL?
    @State private var invalid = false
    @State private var bridge: BrowserBridge?
    let back: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
            FlowHeader(title: DappCopy.browserTitle, back: back)
            BrambleField(
                placeholder: DappCopy.addressPlaceholder,
                text: $input,
                invalid: invalid,
                hint: invalid ? DappCopy.addressInvalid : nil
            )
            .keyboardType(.URL)
            .submitLabel(.go)
            .onSubmit(open)
            .accessibilityIdentifier("browser-address")
            if let script = Self.providerScript {
                if let page, let bridge {
                    DappWebView(url: page, script: script, bridge: bridge)
                        .clipShape(FieldShape())
                }
            } else {
                StatusLine(text: DappCopy.browserUnavailable, tone: .danger)
            }
            Spacer(minLength: 0)
        }
        .padding(BrambleMetrics.Screen.shellPadding)
        .sheet(item: pendingCard) { card in
            SkinProvider {
                ConnectSheet(card: card) { accountId in
                    if let accountId { bridge?.approve(card, accountId: accountId) } else { bridge?.deny(card) }
                }
            }
            .environment(store)
            .interactiveDismissDisabled()
        }
        .onChange(of: store.network, initial: true) { bridge?.shown = store.network }
        .task {
            let started = BrowserBridge(sink: DappRequestSink(core: store.core), shown: store.network) { url in
                input = url.absoluteString
            }
            bridge = started
            await started.run()
        }
    }

    /// The oldest connection card; only a decision closes its sheet.
    private var pendingCard: Binding<DappRequestSink.ConnectCard?> {
        Binding(get: { bridge?.sink.cards.first }, set: { _ in /* Cancel or Connect decides it. */ })
    }

    private func open() {
        let url = DappOrigin.address(input)
        invalid = url == nil
        if let url { page = url }
    }
}

/// The connection card (the extension's `approval-connect-card.ts`): the site, its warnings, the
/// account it would see, and Cancel before Connect. The core shares the active account, so
/// choosing another account switches to it first. A blocked site can only be cancelled.
private struct ConnectSheet: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let card: DappRequestSink.ConnectCard
    /// The account approved, or nil for Cancel.
    let decide: (String?) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                Eyebrow(text: DappCopy.connectTitle)
                Text(card.origin)
                    .brambleText(BrambleTypeScale.mono, weight: BrambleWeight.semibold, mono: true)
                    .accessibilityAddTraits(.isHeader)
                ForEach(card.warnings, id: \.self) { warning in
                    StatusLine(text: warning, tone: card.blocked ? .danger : .muted)
                }
                Text(DappCopy.connectAccount)
                    .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                    .foregroundStyle(skin.muted)
                if store.visibleRecords.isEmpty {
                    StatusLine(text: DappCopy.connectSelectAccount)
                }
                ForEach(store.visibleRecords, id: \.id) { record in accountRow(record) }
                StatusLine(text: DappCopy.connectShares)
                StatusLine(text: DappCopy.connectNoFee)
                HStack(spacing: BrambleSpace.sm) {
                    PillButton(DappCopy.connectCancel, kind: .secondary) { decide(nil) }
                    PillButton(DappCopy.connectAction, icon: .check) { decide(store.activeRecord?.id) }
                        .disabled(card.blocked || store.activeRecord == nil || store.busy)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .background(skin.bg.ignoresSafeArea())
    }

    private func accountRow(_ record: AccountRecord) -> some View {
        let selected = record.id == store.activeRecord?.id
        return Button {
            if !selected { Task { await store.select(id: record.id) } }
        } label: {
            HStack(spacing: BrambleSpace.sm) {
                AccountAvatarView(address: record.address)
                VStack(alignment: .leading) {
                    Text(record.displayName)
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                        .lineLimit(1)
                    Text(record.shortAddress)
                        .brambleText(BrambleTypeScale.mono, mono: true)
                        .foregroundStyle(skin.muted)
                }
                Spacer(minLength: 0)
                if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
            }
            .padding(BrambleSpace.sm)
        }
        .buttonStyle(
            FillPressStyle(
                fill: selected ? skin.accentSoft : .clear,
                pressed: skin.softPress,
                shape: FieldShape(),
                scale: BramblePress.drawerRow
            )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(record.displayName), \(record.shortAddress)")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// The `WKWebView` the browser shows, wired to `bridge`.
private struct DappWebView: UIViewRepresentable {
    let url: URL
    let script: String
    let bridge: BrowserBridge

    func makeCoordinator() -> BrowserBridge {
        bridge
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.isFraudulentWebsiteWarningEnabled = true
        let content = configuration.userContentController
        content.addUserScript(
            WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
        )
        content.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: BrowserBridge.handlerName)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.requested != url {
            context.coordinator.requested = url
            webView.load(URLRequest(url: url))
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: BrowserBridge) {
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        webView.stopLoading()
        coordinator.release()
    }
}

/// The native end of the page's bridge: it admits a message only from the main frame whose
/// `https` origin equals the committed page's (`DappOrigin.admit`), hands it to the one
/// `DappRequestSink`, and keeps the main frame on `https`. A refused message gets a bare error
/// that says nothing about why. A held request's reply goes only to the page that asked: a new
/// commit releases every held reply unanswered.
@MainActor
final class BrowserBridge: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    typealias Reply = @MainActor @Sendable (Any?, String?) -> Void

    /// The `window.webkit.messageHandlers` name `mobile-bridge.ts` posts to.
    static let handlerName = "bramble"
    private static let refused = "refused"
    private static let tickSeconds = 5
    /// Ticks between phishing-feed refreshes (30 minutes); the core skips a fresh list cheaply.
    private static let feedEvery = 360

    let sink: DappRequestSink
    /// The network the browser shows, for a locked chain-id read.
    var shown: NetworkId
    var requested: URL?
    private let committed: (URL) -> Void
    private var page: URL?
    private var held: [UInt64: Reply] = [:]

    init(sink: DappRequestSink, shown: NetworkId, committed: @escaping (URL) -> Void) {
        self.sink = sink
        self.shown = shown
        self.committed = committed
    }

    /// Refreshes the phishing feed now and every 30 minutes, and settles expired cards every few
    /// seconds, until the screen goes.
    func run() async {
        var ticks = 0
        while !Task.isCancelled {
            if ticks.isMultiple(of: Self.feedEvery) { await sink.refreshPhishingFeed() }
            deliver(sink.settleExpired())
            ticks += 1
            try? await Task.sleep(for: .seconds(Self.tickSeconds))
        }
    }

    func approve(_ card: DappRequestSink.ConnectCard, accountId: String) {
        deliver(sink.approve(card, accountId: accountId))
    }

    func deny(_ card: DappRequestSink.ConnectCard) {
        deliver(sink.deny(card))
    }

    /// The page is gone: its cards are denied, and every held reply is let go (WebKit needs each
    /// answered once).
    func release() {
        sink.pageGone()
        let replies = held.values
        held = [:]
        for reply in replies { reply(nil, Self.refused) }
    }

    func userContentController(
        _: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping Reply
    ) {
        let frame = message.frameInfo
        let source = frame.securityOrigin
        let frameOrigin = DappOrigin.origin(scheme: source.protocol, host: source.host, port: source.port)
        guard let origin = DappOrigin.admit(isMainFrame: frame.isMainFrame, frameOrigin: frameOrigin, committed: page),
              let body = message.body as? String,
              let request = DappRequest.read(origin: origin, body: body)
        else {
            replyHandler(nil, Self.refused)
            return
        }
        switch sink.answer(request, shown: shown) {
        case let .now(json):
            replyHandler(json, nil)

        case let .held(requestId):
            held[requestId] = replyHandler
        }
    }

    func webView(_ webView: WKWebView, didCommit _: WKNavigation?) {
        release()
        page = webView.url
        if let url = webView.url { committed(url) }
    }

    func webView(
        _: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let secure = DappOrigin.origin(of: navigationAction.request.url) != nil
        decisionHandler(mainFrame && !secure ? .cancel : .allow)
    }

    private func deliver(_ settled: [DappRequestSink.Settled]) {
        for item in settled {
            held.removeValue(forKey: item.requestId)?(item.json, nil)
        }
    }
}
