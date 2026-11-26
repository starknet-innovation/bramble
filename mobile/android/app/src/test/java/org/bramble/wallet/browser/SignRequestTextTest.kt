package org.bramble.wallet.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The sign card's pure helpers: the document re-indented, never parsed, and the outside-execution test. */
class SignRequestTextTest {
    @Test
    fun keepsTextExact() {
        val json = """{"a":[1,"x, {y}: \"z\""],"b":{}}"""
        val shown = indentedJson(json)
        assertEquals(json.filterNot(Char::isWhitespace), shown.filterNot(Char::isWhitespace))
        assertTrue(shown.contains(""""x, {y}: \"z\"""""))
        assertTrue(shown.lines().containsAll(listOf("""  "a": [""", "    1,")))
    }

    /** The outside-execution warning follows the primary type, so one with no calls still carries it. */
    @Test
    fun outsideExecutionByType() {
        assertTrue(isOutsideExecution("OutsideExecution · Account.execute_from_outside"))
        assertTrue(isOutsideExecution("OutsideExecution"))
        assertFalse(isOutsideExecution("Mail · OutsideExecution"))
        assertFalse(isOutsideExecution("OutsideExecutionV2 · App"))
    }
}
