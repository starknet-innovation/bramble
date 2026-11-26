import SwiftUI
import WebKit

/// The in-app browser (P16): an address bar that opens `https` sites only, over a `WKWebView` that
/// injects the extension's provider (`mobile/web/bramble-provider.generated.js`) at document start
/// in the main frame only. Nothing the web stores outlives the screen (a non-persistent data
/// store), and WebKit's fraudulent-website warning stays on.
struct BrowserView: View {
    /// The injected script, bundled from `mobile/web`. Without it the browser does not open.
    static let providerScript: String? = Bundle.main
        .url(forResource: "bramble-provider.generated", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }

    @State private var input = ""
    @State private var page: URL?
    @State private var invalid = false
    let back: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
            FlowHeader(title: "Browser", back: back)
            BrambleField(
                placeholder: "Site address",
                text: $input,
                invalid: invalid,
                hint: invalid ? "Enter an https address" : nil
            )
            .keyboardType(.URL)
            .submitLabel(.go)
            .onSubmit(open)
            .accessibilityIdentifier("browser-address")
            if let script = Self.providerScript {
                if let page {
                    DappWebView(url: page, script: script) { input = $0.absoluteString }
                        .clipShape(FieldShape())
                }
            } else {
                StatusLine(text: "Browser unavailable", tone: .danger)
            }
            Spacer(minLength: 0)
        }
        .padding(BrambleMetrics.Screen.shellPadding)
    }

    private func open() {
        let url = DappOrigin.address(input)
        invalid = url == nil
        if let url { page = url }
    }
}

/// The `WKWebView` the browser shows; `committed` reports each committed main-frame URL.
private struct DappWebView: UIViewRepresentable {
    let url: URL
    let script: String
    let committed: (URL) -> Void

    func makeCoordinator() -> BrowserBridge {
        BrowserBridge(committed: committed)
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
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.committed = committed
        if context.coordinator.requested != url {
            context.coordinator.requested = url
            webView.load(URLRequest(url: url))
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator _: BrowserBridge) {
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        webView.stopLoading()
    }
}

/// The native end of the page's bridge: it admits a message only from the main frame whose
/// `https` origin equals the committed page's (`DappOrigin.admit`), hands it to the one
/// `DappRequestSink`, and keeps the main frame on `https`. A refused message gets a bare error
/// that says nothing about why.
@MainActor
final class BrowserBridge: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    /// The `window.webkit.messageHandlers` name `mobile-bridge.ts` posts to.
    static let handlerName = "bramble"
    private static let refused = "refused"

    var committed: (URL) -> Void
    var requested: URL?
    private var page: URL?
    private let sink = DappRequestSink()

    init(committed: @escaping (URL) -> Void) {
        self.committed = committed
    }

    func userContentController(
        _: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @MainActor @Sendable (Any?, String?) -> Void
    ) {
        let frame = message.frameInfo
        let source = frame.securityOrigin
        let frameOrigin = DappOrigin.origin(scheme: source.protocol, host: source.host, port: source.port)
        // ponytail: the sink answers synchronously, so no reply can outlive the page it was asked
        // on; give each commit an epoch and drop stale replies once DappSession answers later.
        guard let origin = DappOrigin.admit(isMainFrame: frame.isMainFrame, frameOrigin: frameOrigin, committed: page),
              let body = message.body as? String,
              let request = DappRequest.read(origin: origin, body: body)
        else {
            replyHandler(nil, Self.refused)
            return
        }
        replyHandler(sink.answer(request), nil)
    }

    func webView(_ webView: WKWebView, didCommit _: WKNavigation?) {
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
}
