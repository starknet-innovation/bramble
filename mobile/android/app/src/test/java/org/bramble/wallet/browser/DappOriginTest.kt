package org.bramble.wallet.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The in-app browser's admission rules (P16), as iOS `DappOriginTests`: only the main frame's
 * committed `https` origin is answered, and a request is read only in the shape the page's bridge
 * sends. Connect itself runs through the native core, covered by iOS `DappRequestSinkTests`.
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
        val params = """{"silent_mode":true}"""
        assertEquals(DappRequest(origin, id, method), DappRequest.read(origin, 64, id, method, null))
        assertEquals(DappRequest(origin, id, method, params), DappRequest.read(origin, 64, id, method, params))
        assertNull(DappRequest.read(origin, 64, null, method, null))
        assertNull(DappRequest.read(origin, 64, "1", method, null))
        assertNull(DappRequest.read(origin, 64, id, 7, null))
        assertNull(DappRequest.read(origin, 64, id, "", null))
        // Params travel as the page's JSON text, never as a parsed value.
        assertNull(DappRequest.read(origin, 64, id, method, mapOf("silent_mode" to true)))
        assertNull(DappRequest.read(origin, DappRequest.MAX_BODY_BYTES + 1, id, method, null))
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
