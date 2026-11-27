package org.bramble.wallet

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URL

/** Product analytics: off by default, remembered, immediate, gateway-only, and reset with the wallet. */
class GatewayAnalyticsTest {
    private val gateway = URL("https://wallet.nodes.starknet.org/rpc/mainnet/v0_10")
    private val uuidV4 = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")

    private fun analytics(prefs: SharedPreferences = MapPrefs()) = GatewayAnalytics(prefs, "0.1.0", "production")

    @Test
    fun offByDefaultSendsNothing() {
        val subject = analytics()
        assertFalse(subject.enabled)
        assertTrue(subject.headers(gateway).isEmpty())
    }

    @Test
    fun gatewayOnly() {
        val subject = analytics().apply { enabled = true }
        val headers = subject.headers(gateway)
        assertEquals(
            setOf("X-MC-Installation-ID", "X-MC-App-Version", "X-MC-Platform", "X-MC-Release-Channel"),
            headers.keys,
        )
        assertTrue(uuidV4.matches(headers.getValue("X-MC-Installation-ID")))
        assertEquals("android", headers["X-MC-Platform"])
        assertEquals("0.1.0", headers["X-MC-App-Version"])
        for (other in listOf(
            "https://mainnet.nodes.starknet.org/rpc/v0_10",
            "http://wallet.nodes.starknet.org/rpc",
            "https://wallet.nodes.starknet.org:8443/rpc",
            "https://wallet.nodes.starknet.org.evil.test/rpc",
            "https://api.starkscan.co/api/v0/transactions",
        )) {
            assertTrue(other, subject.headers(URL(other)).isEmpty())
        }
    }

    @Test
    fun rememberedAndImmediate() {
        val prefs = MapPrefs()
        analytics(prefs).enabled = true
        val reopened = analytics(prefs)
        assertTrue(reopened.enabled)
        assertTrue(reopened.headers(gateway).isNotEmpty())
        reopened.enabled = false
        assertTrue(reopened.headers(gateway).isEmpty())
    }

    @Test
    fun idIsStableUntilReset() {
        val subject = analytics().apply { enabled = true }
        val first = subject.headers(gateway).getValue("X-MC-Installation-ID")
        assertEquals(first, subject.headers(gateway).getValue("X-MC-Installation-ID"))
        subject.reset()
        assertNotEquals(first, subject.headers(gateway).getValue("X-MC-Installation-ID"))
    }

    @Test
    fun malformedValuesFailOpen() {
        val prefs = MapPrefs().apply { values[GatewayAnalytics.INSTALLATION_ID_KEY] = "not-a-uuid" }
        val subject = analytics(prefs).apply { enabled = true }
        assertTrue(uuidV4.matches(subject.headers(gateway).getValue("X-MC-Installation-ID")))
        val badVersion = GatewayAnalytics(MapPrefs(), "1.0 beta\"", "production").apply { enabled = true }
        assertTrue(badVersion.headers(gateway).isEmpty())
    }

    @Test
    fun reservedHeaderNames() {
        assertTrue(GatewayAnalytics.isAnalyticsHeader("x-mc-installation-id"))
        assertTrue(GatewayAnalytics.isAnalyticsHeader("X-MC-Flow-ID"))
        assertFalse(GatewayAnalytics.isAnalyticsHeader("Content-Type"))
    }
}

/** An in-memory [SharedPreferences]; edits apply at once. */
class MapPrefs : SharedPreferences {
    val values = mutableMapOf<String, Any?>()

    override fun getAll(): MutableMap<String, *> = values

    override fun getString(
        key: String,
        defValue: String?,
    ): String? = values[key] as? String ?: defValue

    override fun getStringSet(
        key: String,
        defValues: MutableSet<String>?,
    ): MutableSet<String>? = defValues

    override fun getInt(
        key: String,
        defValue: Int,
    ): Int = values[key] as? Int ?: defValue

    override fun getLong(
        key: String,
        defValue: Long,
    ): Long = values[key] as? Long ?: defValue

    override fun getFloat(
        key: String,
        defValue: Float,
    ): Float = values[key] as? Float ?: defValue

    override fun getBoolean(
        key: String,
        defValue: Boolean,
    ): Boolean = values[key] as? Boolean ?: defValue

    override fun contains(key: String): Boolean = key in values

    override fun edit(): SharedPreferences.Editor = Editor()

    override fun registerOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener,
    ) = Unit

    override fun unregisterOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener,
    ) = Unit

    private inner class Editor : SharedPreferences.Editor {
        override fun putString(
            key: String,
            value: String?,
        ) = apply { values[key] = value }

        override fun putStringSet(
            key: String,
            values: MutableSet<String>?,
        ) = this

        override fun putInt(
            key: String,
            value: Int,
        ) = apply { values[key] = value }

        override fun putLong(
            key: String,
            value: Long,
        ) = apply { values[key] = value }

        override fun putFloat(
            key: String,
            value: Float,
        ) = apply { values[key] = value }

        override fun putBoolean(
            key: String,
            value: Boolean,
        ) = apply { values[key] = value }

        override fun remove(key: String) = apply { values.remove(key) }

        override fun clear() = apply { values.clear() }

        override fun commit() = true

        override fun apply() = Unit
    }
}
