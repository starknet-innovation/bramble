package org.bramble.wallet

import android.content.SharedPreferences
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Product analytics, as the extension's `gateway-analytics.ts` and iOS `GatewayAnalytics`: while
 * the person has it on, a request to the wallet's own gateway carries a random installation id and
 * the app's version, platform and release channel as headers. It adds headers only, never a
 * request, and only to `https://wallet.nodes.starknet.org`; [apply] refuses redirects on such a
 * request, so the id cannot leave that origin. Off by default on mobile (the extension defaults on).
 *
 * The id is a random UUIDv4 in the app's preferences, never derived from the device or the wallet,
 * and removed by "Remove wallet" ([reset]). Fails open: a bad stored id or version leaves every
 * header out, and the request goes as it would have.
 */
class GatewayAnalytics(
    private val prefs: SharedPreferences,
    private val version: String = BuildConfig.VERSION_NAME,
    private val channel: String = if (BuildConfig.DEBUG) "development" else "production",
) {
    /** The person's choice; read on every request, so turning it off takes effect at once. */
    var enabled: Boolean
        get() = prefs.getBoolean(ENABLED_KEY, false)
        set(value) {
            prefs.edit().putBoolean(ENABLED_KEY, value).apply()
        }

    /** The headers for a request to [url]: all four, or none. */
    fun headers(url: URL): Map<String, String> {
        if (!enabled || !isGateway(url) || !APP_VERSION.matches(version)) return emptyMap()
        val id = installationId()
        return mapOf(
            "X-MC-Installation-ID" to id,
            "X-MC-App-Version" to version,
            "X-MC-Platform" to "android",
            "X-MC-Release-Channel" to channel,
        )
    }

    /** Removes the id; the next request while on makes a new one ("Remove wallet"). */
    @Synchronized
    fun reset() {
        prefs.edit().remove(INSTALLATION_ID_KEY).apply()
    }

    @Synchronized
    private fun installationId(): String {
        prefs.getString(INSTALLATION_ID_KEY, null)?.takeIf(UUID_V4::matches)?.let { return it }
        return UUID.randomUUID().toString().lowercase().also {
            prefs.edit().putString(INSTALLATION_ID_KEY, it).apply()
        }
    }

    /** The gateway's address, the storage keys, and the process's instance. */
    companion object {
        /** The only host that receives the headers (over https, default port). */
        const val HOST = "wallet.nodes.starknet.org"

        /** The remembered choice, in the app's preferences. */
        const val ENABLED_KEY = "bramble:product-analytics"

        /** The extension's storage key for the same id. */
        const val INSTALLATION_ID_KEY = "bramble:analytics-installation-id"

        private const val HTTPS_PORT = 443
        private val UUID_V4 = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
        private val APP_VERSION = Regex("[A-Za-z0-9.+-]{1,32}")

        /** The process's instance, set by [WalletStore]; none (no headers) before that. */
        @Volatile
        var shared: GatewayAnalytics? = null

        /** Whether [name] is one of the analytics headers, which only this type may set. */
        fun isAnalyticsHeader(name: String): Boolean = name.lowercase().startsWith("x-mc-")

        private fun isGateway(url: URL): Boolean =
            url.protocol == "https" && url.host == HOST && (url.port == -1 || url.port == HTTPS_PORT)

        /**
         * Adds the headers to [connection] when it goes to the gateway while analytics is on, and
         * then refuses redirects for it. Call before the request is sent.
         */
        fun apply(connection: HttpURLConnection) {
            val headers = shared?.headers(connection.url).orEmpty()
            if (headers.isEmpty()) return
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            connection.instanceFollowRedirects = false
        }
    }
}
