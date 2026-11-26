package org.bramble.wallet.browser

import java.net.URI
import java.net.URISyntaxException

/**
 * The in-app browser's admission rules (P16, `docs/portfolio-activity.md` T5), as iOS
 * `DappOrigin`. A dapp request is attributed only to the main frame's committed `https` origin, as
 * the WebView reports it; anything else is refused, never answered. Pure, so the JVM tests cover it.
 */
object DappOrigin {
    private const val HTTPS = "https"
    private const val DEFAULT_PORT = 443

    /**
     * The address bar's text as the `https` URL to open, or null. A bare host gets `https://`; any
     * other scheme, a missing host, whitespace or credentials in the URL are refused.
     */
    fun address(input: String): String? {
        val text = input.trim()
        val candidate = if ("://" in text) text else "$HTTPS://$text"
        val uri = if (text.isEmpty() || text.any { it.isWhitespace() }) null else parse(candidate)
        return uri?.takeIf { it.rawUserInfo == null && origin(it) != null }?.toString()
    }

    /** The serialized origin (`https://host[:port]`) of an `https` URL or origin string, else null. */
    fun origin(url: String?): String? = url?.let(::parse)?.let(::origin)

    /**
     * The origin a request is bound to, or null to refuse it: it must come from the main frame,
     * whose `https` origin ([sourceOrigin], as `onPostMessage` reports it) equals the committed
     * page's ([committedUrl]).
     */
    fun admit(
        isMainFrame: Boolean,
        sourceOrigin: String?,
        committedUrl: String?,
    ): String? {
        val page = origin(committedUrl)
        return if (isMainFrame && page != null && origin(sourceOrigin) == page) page else null
    }

    private fun parse(text: String): URI? =
        try {
            URI(text)
        } catch (ignored: URISyntaxException) {
            null
        }

    private fun origin(uri: URI): String? {
        val host = uri.host
        if (!HTTPS.equals(uri.scheme, ignoreCase = true) || host.isNullOrEmpty()) return null
        val port = if (uri.port == -1 || uri.port == DEFAULT_PORT) "" else ":${uri.port}"
        return "$HTTPS://${host.lowercase()}$port"
    }
}

/**
 * A provider request read from the page's untrusted message, bound to the [origin] the host admitted:
 * a UUID [id] and a [method] name. Without an id there is nothing to answer, so anything else is
 * dropped.
 */
data class DappRequest(
    val origin: String,
    val id: String,
    val method: String,
) {
    /** Reading rules for the fields the bridge pulled from the message body. */
    companion object {
        /** The hostile-JSON budget the extension's provider bridge applies (1 MiB). */
        const val MAX_BODY_BYTES = 1_048_576
        private const val MAX_METHOD_LENGTH = 64
        private val UUID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

        /**
         * The request for [origin], from a body of [bodyBytes] whose `id` and `method` fields are
         * [id] and [method] (any JSON value), or null when the page's provider would not send it.
         */
        fun read(
            origin: String,
            bodyBytes: Int,
            id: Any?,
            method: Any?,
        ): DappRequest? {
            if (bodyBytes > MAX_BODY_BYTES || id !is String || method !is String) return null
            val valid = UUID.matches(id) && method.isNotEmpty() && method.length <= MAX_METHOD_LENGTH
            return if (valid) DappRequest(origin, id, method) else null
        }
    }
}

/**
 * Where every admitted dapp request lands. Today it refuses each one, connect included, with the
 * wallet API's user-refused error (113), as the extension answers a request the person declined.
 * wallet-core's `DappSession` replaces [answer] once mobile pins a core that exports it.
 */
class DappRequestSink {
    /** The JSON reply for [request]: `{ id, error }`, which the page's bridge hands to the provider. */
    fun answer(request: DappRequest): String =
        // The id is a validated UUID, so it needs no escaping.
        """{"error":{"code":$USER_REFUSED,"message":"$USER_REFUSED_MESSAGE"},"id":"${request.id}"}"""

    private companion object {
        const val USER_REFUSED = 113
        const val USER_REFUSED_MESSAGE = "The user refused the operation"
    }
}
