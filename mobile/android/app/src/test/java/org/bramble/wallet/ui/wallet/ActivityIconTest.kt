package org.bramble.wallet.ui.wallet

import org.bramble.wallet.design.BrambleIconName
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Activity rows name their glyph by the iOS asset's camel-case name (`ActivityRow.icon`); every
 * name the core emits resolves to its generated Android icon, and an unknown one falls back to
 * the layout grid rather than failing.
 */
class ActivityIconTest {
    @Test
    fun everyCoreGlyphResolves() {
        // The names `history/appearance.rs` checks against the generated icon set.
        val names =
            listOf(
                "arrowLeftRight",
                "lockKeyholeOpen",
                "creditCard",
                "lockKeyhole",
                "shield",
                "keyRound",
                "arrowDownLeft",
                "arrowDownRight",
                "rocket",
                "terminal",
            )
        for (name in names) assertNotEquals(name, BrambleIconName.LAYOUT_GRID, activityIcon(name))
        assertEquals(BrambleIconName.ARROW_DOWN_LEFT, activityIcon("arrowDownLeft"))
        assertEquals(BrambleIconName.LAYOUT_GRID, activityIcon("layoutGrid"))
    }

    @Test
    fun unknownGlyphFallsBack() {
        assertEquals(BrambleIconName.LAYOUT_GRID, activityIcon("notAnIcon"))
        assertEquals(BrambleIconName.LAYOUT_GRID, activityIcon(""))
    }
}
