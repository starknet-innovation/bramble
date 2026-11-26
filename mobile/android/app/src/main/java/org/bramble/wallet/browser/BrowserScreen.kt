package org.bramble.wallet.browser

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.bramble.core.NetworkId
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.json.JSONObject
import java.io.IOException

/** The injected script, copied from `mobile/web` into the app's assets at build time. */
private const val PROVIDER_ASSET = "bramble-provider.generated.js"

/** The `window` name `mobile-bridge.ts` posts to. */
private const val BRIDGE_NAME = "brambleBridge"

/** How often expired cards are settled. */
private const val TICK_MS = 5_000L

/** Ticks between phishing-feed refreshes (30 minutes); the core skips a fresh list cheaply. */
private const val FEED_EVERY = 360

/**
 * The in-app browser (P16), as iOS `BrowserView`: an address bar that opens `https` sites only,
 * over a WebView that injects the extension's provider at document start (the script itself does
 * nothing outside the top frame). It needs `androidx.webkit`'s origin-reporting message listener
 * and document-start scripts; without either, or without the script, it does not open. A site's
 * connection or signing request opens its card over it, and a page on the blocklist is never
 * loaded.
 */
@Composable
fun BrowserScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    val context = LocalContext.current
    val script = remember { if (browserSupported()) providerScript(context) else null }
    var input by remember { mutableStateOf("") }
    var page by remember { mutableStateOf<String?>(null) }
    var invalid by remember { mutableStateOf(false) }
    // The blocklisted origin the last navigation was stopped at, until another page commits.
    var blockedSite by remember { mutableStateOf<String?>(null) }
    val bridge =
        remember {
            BrowserBridge(store.dappRequests, store.network, { blockedSite = it }) {
                input = it
                blockedSite = null
            }
        }
    bridge.shown = store.network
    LaunchedEffect(bridge) { bridge.run() }
    Column(
        Modifier.fillMaxSize().padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader(DappCopy.browserTitle, back = back)
        AddressBar(input, { input = it }, invalid) {
            val url = DappOrigin.address(input)
            invalid = url == null
            if (url != null) page = url
        }
        blockedSite?.let { BlockedSitePanel(it, back) }
        val open = page
        if (script == null) {
            StatusLine(DappCopy.browserUnavailable, StatusTone.DANGER)
        } else if (open != null) {
            DappWebView(open, script, bridge, back)
        }
    }
    CardSheet(store, bridge, back)
}

/** The oldest card's sheet, sign or connect; only a decision closes it. Leave site denies and closes. */
@Composable
private fun CardSheet(
    store: WalletStore,
    bridge: BrowserBridge,
    back: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val card = bridge.sink.cards.firstOrNull() ?: return
    val sink = bridge.sink
    val leave = {
        bridge.deliver(sink.deny(card))
        back()
    }
    val sign = card.sign
    if (sign != null) {
        SignSheet(store, card, sign, leave) { approved ->
            if (approved) scope.launch { bridge.deliver(sink.sign(card)) } else bridge.deliver(sink.deny(card))
        }
    } else {
        ConnectSheet(store, card, leave) { accountId ->
            bridge.deliver(if (accountId != null) sink.approve(card, accountId) else sink.deny(card))
        }
    }
}

/** The https-only address field; [open] runs on the keyboard's action. */
@Composable
private fun AddressBar(
    input: String,
    onInput: (String) -> Unit,
    invalid: Boolean,
    open: () -> Unit,
) = BrambleField(
    null,
    DappCopy.addressPlaceholder,
    input,
    onInput,
    kind = SecretKind.ADDRESS,
    invalid = invalid,
    hint = if (invalid) DappCopy.addressInvalid else null,
    onSubmit = open,
)

private fun browserSupported(): Boolean =
    WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

private fun providerScript(context: Context): String? =
    try {
        context.assets
            .open(PROVIDER_ASSET)
            .bufferedReader()
            .use { it.readText() }
    } catch (ignored: IOException) {
        null
    }

/** The WebView the browser shows at [url], wired to [bridge]; [gone] closes the browser. */
@Composable
private fun DappWebView(
    url: String,
    script: String,
    bridge: BrowserBridge,
    gone: () -> Unit,
) {
    AndroidView(
        factory = { bridge.attach(WebView(it), script, gone) },
        modifier = Modifier.fillMaxSize(),
        onRelease = bridge::detach,
        update = { view ->
            if (bridge.requested != url) {
                bridge.requested = url
                // `loadUrl` skips `shouldOverrideUrlLoading`, so the blocklist is checked here too.
                if (!bridge.stopsBlocked(url)) view.loadUrl(url)
            }
        },
    )
}

/** A message's text, or null unless it is a string: `getData` throws for an array buffer. */
internal fun messageText(message: WebMessageCompat): String? =
    if (message.type == WebMessageCompat.TYPE_STRING) message.data else null

/** The request in [body] for [origin], or null unless it is a request the page's bridge sends. */
private fun readRequest(
    origin: String,
    body: String,
): DappRequest? {
    if (body.length > DappRequest.MAX_BODY_BYTES) return null
    val json = runCatching { JSONObject(body) }.getOrNull()
    return json?.let {
        val params = it.opt("params").takeUnless { value -> value == JSONObject.NULL }
        DappRequest.read(origin, body.toByteArray().size, it.opt("id"), it.opt("method"), params)
    }
}

/**
 * The native end of the page's bridge: it admits a message only from the main frame whose `https`
 * origin equals the committed page's ([DappOrigin.admit]), and only as text, hands it to the one
 * [DappRequestSink], and keeps the main frame on `https` and off the blocklist ([BrowserClient]). A refused message is
 * never answered. A held request's reply goes only to the page that asked: a new page drops every
 * held reply and denies its cards. `addJavascriptInterface` is never used: every frame gets it and
 * it carries no origin.
 */
private class BrowserBridge(
    val sink: DappRequestSink,
    /** The network the browser shows, for a locked chain-id read. */
    var shown: NetworkId,
    private val blocked: (String) -> Unit,
    private val committed: (String) -> Unit,
) : WebViewCompat.WebMessageListener {
    /** The URL last loaded from the address bar. */
    var requested: String? = null
    private var page: String? = null
    private val held = mutableMapOf<ULong, JavaScriptReplyProxy>()

    /** Refreshes the phishing feed now and every 30 minutes, and settles expired cards every few seconds. */
    suspend fun run() {
        var ticks = 0
        while (true) {
            if (ticks % FEED_EVERY == 0) sink.refreshPhishingFeed()
            deliver(sink.settleExpired())
            ticks += 1
            delay(TICK_MS)
        }
    }

    /** Whether [url] is on the blocklist; if so, the browser is told and the address restored. */
    fun stopsBlocked(url: String): Boolean {
        val origin = DappOrigin.origin(url)?.takeIf(sink::isBlockedSite) ?: return false
        restoreAddress()
        blocked(origin)
        return true
    }

    /** Wires [view] to this bridge; [gone] closes the browser when the page's process dies. */
    fun attach(
        view: WebView,
        script: String,
        gone: () -> Unit,
    ): WebView {
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            setSupportMultipleWindows(false)
        }
        view.webViewClient = BrowserClient(this, gone)
        // Every origin may post: the host binds each message itself, and the script is inert outside
        // the top frame.
        WebViewCompat.addWebMessageListener(view, BRIDGE_NAME, setOf("*"), this)
        WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))
        return view
    }

    /** Ends the page and clears what the web stored, so nothing outlives the screen. */
    fun detach(view: WebView) {
        newPage()
        WebViewCompat.removeWebMessageListener(view, BRIDGE_NAME)
        view.stopLoading()
        view.clearCache(true)
        view.destroy()
        CookieManager.getInstance().removeAllCookies(null)
        WebStorage.getInstance().deleteAllData()
    }

    /** A new document, or none: no held reply may reach it, and its cards are denied. */
    fun newPage() {
        held.clear()
        sink.pageGone()
    }

    /** The main frame committed [url]. */
    fun commit(url: String?) {
        page = url
        if (url != null) committed(url)
    }

    /** Puts the committed page back in the address bar after a navigation fails or is refused. */
    fun restoreAddress() {
        page?.let(committed)
    }

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        val origin = DappOrigin.admit(isMainFrame, sourceOrigin.toString(), page)
        val body = origin?.let { messageText(message) }
        val request = if (origin != null && body != null) readRequest(origin, body) else null
        when (val answer = request?.let { sink.answer(it, shown) }) {
            is DappRequestSink.Answer.Now -> replyProxy.postMessage(answer.json)
            is DappRequestSink.Answer.Held -> held[answer.requestId] = replyProxy
            null -> Unit
        }
    }

    /** Posts each settled reply to the page still waiting on it: a card's decision, or an expiry. */
    fun deliver(settled: List<DappRequestSink.Settled>) {
        settled.forEach { held.remove(it.requestId)?.postMessage(it.json) }
    }
}

/**
 * The browser's navigation rules over [bridge]: the main frame stays on `https`, the address bar
 * shows the committed page again when a navigation fails or is refused, and a dead page process
 * closes the browser ([gone]), whose teardown denies the page's cards and clears its data.
 */
private class BrowserClient(
    private val bridge: BrowserBridge,
    private val gone: () -> Unit,
) : WebViewClient() {
    override fun onPageStarted(
        view: WebView,
        url: String?,
        favicon: Bitmap?,
    ) {
        bridge.newPage()
        stopsBlocked(view, url)
    }

    override fun doUpdateVisitedHistory(
        view: WebView,
        url: String?,
        isReload: Boolean,
    ) {
        if (!stopsBlocked(view, url)) bridge.commit(url)
    }

    /**
     * A main-frame POST never reaches [shouldOverrideUrlLoading], so a blocklisted page is also
     * stopped as it starts, and never committed as the page.
     */
    private fun stopsBlocked(
        view: WebView,
        url: String?,
    ): Boolean = (url != null && bridge.stopsBlocked(url)).also { if (it) view.stopLoading() }

    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        val url = request.url.toString()
        return request.isForMainFrame && (bridge.stopsBlocked(url) || refusesInsecure(url))
    }

    /** A main-frame navigation off `https` is refused and the committed page shown again. */
    private fun refusesInsecure(url: String): Boolean {
        val refused = DappOrigin.origin(url) == null
        if (refused) bridge.restoreAddress()
        return refused
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        if (request.isForMainFrame) bridge.restoreAddress()
    }

    override fun onRenderProcessGone(
        view: WebView,
        detail: RenderProcessGoneDetail,
    ): Boolean {
        gone()
        return true
    }
}
