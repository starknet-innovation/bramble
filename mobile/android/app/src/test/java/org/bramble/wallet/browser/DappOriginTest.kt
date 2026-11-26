package org.bramble.wallet.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The in-app browser's admission rules (P16), as iOS `DappOriginTests`: only the main frame's
 * committed `https` origin is answered, and every admitted request is refused with the wallet API's
 * 113 until `DappSession`.
 */
class DappOriginTest {
    private val page = "https://app.example.com/swap?x=1"
    private val origin = "https://app.example.com"
    private val id = "0f8fad5b-d9cb-469f-a165-70867728950e"

    @Test
    fun addressBarOpensHttpsOnly() {
        assertEquals("https://app.example.com", DappOrigin.address("app.example.com"))
        assertEquals("https://app.example.com/a", DappOrigin.address("  https://app.example.com/a "))
        listOf(
            "",
            "http://app.example.com",
            "javascript:alert(1)",
            "file:///etc/hosts",
            "data:text/html,hi",
            "ftp://app.example.com",
            "https://user:pw@app.example.com",
            "app example.com",
        ).forEach { assertNull(it, DappOrigin.address(it)) }
    }

    @Test
    fun originsAreNormalised() {
        assertEquals(origin, DappOrigin.origin(page))
        assertEquals(origin, DappOrigin.origin("https://APP.example.com:443/"))
        assertEquals("https://app.example.com:8443", DappOrigin.origin("https://app.example.com:8443/"))
        assertNull(DappOrigin.origin("http://app.example.com"))
        assertNull(DappOrigin.origin(null))
    }

    @Test
    fun admitsOnlyCommittedMainFrame() {
        assertEquals(origin, DappOrigin.admit(isMainFrame = true, sourceOrigin = origin, committedUrl = page))
        // A subframe, even one at the page's own origin, is refused.
        assertNull(DappOrigin.admit(isMainFrame = false, sourceOrigin = origin, committedUrl = page))
        // A source whose origin is not the committed page's (a navigation raced the message).
        assertNull(DappOrigin.admit(isMainFrame = true, sourceOrigin = "https://evil.example", committedUrl = page))
        // Unattributable: an opaque or cleartext source, or nothing committed yet.
        assertNull(DappOrigin.admit(isMainFrame = true, sourceOrigin = "null", committedUrl = page))
        assertNull(DappOrigin.admit(isMainFrame = true, sourceOrigin = origin, committedUrl = null))
        assertNull(
            DappOrigin.admit(
                isMainFrame = true,
                sourceOrigin = "http://app.example.com",
                committedUrl = "http://app.example.com/",
            ),
        )
    }

    @Test
    fun readsOnlyAWellFormedRequest() {
        val method = "wallet_requestAccounts"
        assertEquals(DappRequest(origin, id, method), DappRequest.read(origin, 64, id, method))
        assertNull(DappRequest.read(origin, 64, null, method))
        assertNull(DappRequest.read(origin, 64, "1", method))
        assertNull(DappRequest.read(origin, 64, id, 7))
        assertNull(DappRequest.read(origin, 64, id, ""))
        assertNull(DappRequest.read(origin, DappRequest.MAX_BODY_BYTES + 1, id, method))
    }

    @Test
    fun everyRequestIsRefused() {
        listOf("wallet_requestAccounts", "wallet_addInvokeTransaction", "wallet_signTypedData").forEach { method ->
            assertEquals(
                """{"error":{"code":113,"message":"The user refused the operation"},"id":"$id"}""",
                DappRequestSink().answer(DappRequest(origin, id, method)),
            )
        }
    }

    @Test
    fun scriptRunsInTopFrameOnly() {
        val script = File("../../web/bramble-provider.generated.js").readText()
        assertTrue(script.contains("starknet_bramble"))
        assertTrue(script.contains("brambleBridge"))
        // Every part is guarded: document-start scripts reach every frame on Android.
        assertEquals(2, Regex("""^if \(window\.top === window\) \{$""", RegexOption.MULTILINE).findAll(script).count())
    }
}
