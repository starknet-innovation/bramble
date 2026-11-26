package org.bramble.wallet.browser

import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
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

/**
 * The in-app browser (P16), as iOS `BrowserView`: an address bar that opens `https` sites only,
 * over a WebView that injects the extension's provider at document start (the script itself does
 * nothing outside the top frame). It needs `androidx.webkit`'s origin-reporting message listener
 * and document-start scripts; without either, or without the script, it does not open.
 */
@Composable
fun BrowserScreen(back: () -> Unit) {
    val context = LocalContext.current
    val script = remember { if (browserSupported()) providerScript(context) else null }
    var input by remember { mutableStateOf("") }
    var page by remember { mutableStateOf<String?>(null) }
    var invalid by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader("Browser", back = back)
        BrambleField(
            null,
            "Site address",
            input,
            { input = it },
            kind = SecretKind.ADDRESS,
            invalid = invalid,
            hint = if (invalid) "Enter an https address" else null,
            onSubmit = {
                val url = DappOrigin.address(input)
                invalid = url == null
                if (url != null) page = url
            },
        )
        val open = page
        if (script == null) {
            StatusLine("Browser unavailable", StatusTone.DANGER)
        } else if (open != null) {
            DappWebView(open, script) { input = it }
        }
    }
}

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

/** The WebView the browser shows at [url]; [committed] gets each committed main-frame URL. */
@Composable
private fun DappWebView(
    url: String,
    script: String,
    committed: (String) -> Unit,
) {
    val bridge = remember { BrowserBridge(committed) }
    AndroidView(
        factory = { bridge.attach(WebView(it), script) },
        modifier = Modifier.fillMaxSize(),
        onRelease = bridge::detach,
        update = { view ->
            if (bridge.requested != url) {
                bridge.requested = url
                view.loadUrl(url)
            }
        },
    )
}

/**
 * The native end of the page's bridge: it answers a message only from the main frame whose `https`
 * origin equals the committed page's ([DappOrigin.admit]), through the one [DappRequestSink], and
 * keeps the main frame on `https`. A refused message is never answered. `addJavascriptInterface`
 * is never used: every frame gets it and it carries no origin.
 */
private class BrowserBridge(
    private val committed: (String) -> Unit,
) : WebViewClient(),
    WebViewCompat.WebMessageListener {
    /** The URL last loaded from the address bar. */
    var requested: String? = null
    private var page: String? = null
    private val sink = DappRequestSink()

    fun attach(
        view: WebView,
        script: String,
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
        view.webViewClient = this
        // Every origin may post: the host binds each message itself, and the script is inert outside
        // the top frame.
        WebViewCompat.addWebMessageListener(view, BRIDGE_NAME, setOf("*"), this)
        WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))
        return view
    }

    /** Ends the page and clears what the web stored, so nothing outlives the screen. */
    fun detach(view: WebView) {
        WebViewCompat.removeWebMessageListener(view, BRIDGE_NAME)
        view.stopLoading()
        view.clearCache(true)
        view.destroy()
        CookieManager.getInstance().removeAllCookies(null)
        WebStorage.getInstance().deleteAllData()
    }

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        // ponytail: the sink answers synchronously, so no reply outlives the page it was asked on;
        // give each commit an epoch and drop stale replies once DappSession answers later.
        val origin = DappOrigin.admit(isMainFrame, sourceOrigin.toString(), page)
        val body = message.data
        val request = if (origin != null && body != null) readRequest(origin, body) else null
        if (request != null) replyProxy.postMessage(sink.answer(request))
    }

    override fun doUpdateVisitedHistory(
        view: WebView,
        url: String?,
        isReload: Boolean,
    ) {
        page = url
        if (url != null) committed(url)
    }

    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean = request.isForMainFrame && DappOrigin.origin(request.url.toString()) == null

    private fun readRequest(
        origin: String,
        body: String,
    ): DappRequest? {
        if (body.length > DappRequest.MAX_BODY_BYTES) return null
        val json = runCatching { JSONObject(body) }.getOrNull()
        return json?.let { DappRequest.read(origin, body.toByteArray().size, it.opt("id"), it.opt("method")) }
    }
}
