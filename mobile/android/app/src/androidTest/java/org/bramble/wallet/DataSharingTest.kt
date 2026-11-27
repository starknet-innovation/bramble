package org.bramble.wallet

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith
import java.net.URL

/**
 * Settings → Network's "Product analytics" and "Reliability diagnostics" on the real core: both
 * start off on a fresh install, a tick takes effect at once and is remembered, and "Remove wallet"
 * deletes the installation id. Chain reads go through the offline [FixtureNode].
 */
@RunWith(AndroidJUnit4::class)
class DataSharingTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    private val gateway = URL("https://wallet.nodes.starknet.org/rpc/mainnet/v0_10")

    private fun installationId(): String? = GatewayAnalytics.shared?.headers(gateway)?.get("X-MC-Installation-ID")

    @Test
    fun offUntilTickedThenImmediate() {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        openPublicWalletOn(FixtureNode(deployed = true))
        r.waitForHome()
        assertTrue(
            "analytics sends nothing on a fresh install",
            GatewayAnalytics.shared?.headers(gateway)?.isEmpty() == true,
        )
        assertFalse("diagnostics start off", ReliabilityDiagnostics.enabled)

        r.tapDescribed("Settings")
        r.tap("Network")
        r.tap("Product analytics")
        r.snapshot("product-analytics-off")
        r.tap(ANALYTICS_ROW)
        val first = installationId()
        assertTrue("ticking it adds the headers at once", first != null)
        assertEquals("android", GatewayAnalytics.shared?.headers(gateway)?.get("X-MC-Platform"))
        r.snapshot("product-analytics-on")
        r.tap("Reliability diagnostics")
        r.tap(DIAGNOSTICS_ROW)
        assertTrue(ReliabilityDiagnostics.enabled)
        r.snapshot("reliability-diagnostics-on")

        val prefs = r.onMain { prefs }
        assertTrue(prefs.getBoolean(GatewayAnalytics.ENABLED_KEY, false))
        assertTrue(prefs.getBoolean(ReliabilityDiagnostics.ENABLED_KEY, false))

        r.tap(DIAGNOSTICS_ROW)
        assertFalse("clearing it stops collection at once", ReliabilityDiagnostics.enabled)
        r.tap(ANALYTICS_ROW)
        assertTrue(
            "clearing it stops the headers at once",
            GatewayAnalytics.shared?.headers(gateway)?.isEmpty() == true,
        )

        r.tap(ANALYTICS_ROW)
        assertEquals("the id is kept while the wallet is", first, installationId())
        r.onMain { deleteWallet(PublicWallet.PASSPHRASE) }
        assertNotEquals("Remove wallet deletes the id", first, installationId())
    }

    private companion object {
        const val ANALYTICS_ROW = "Share pseudonymous gateway usage"
        const val DIAGNOSTICS_ROW = "Keep anonymous RPC and explorer reliability counters on this device"
    }
}
