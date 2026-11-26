package org.bramble.wallet.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The sign card's pure helpers: the document re-indented, never parsed, and the outside-execution test. */
class SignRequestTextTest {
    /** String contents survive verbatim, spaces, separators, escapes and brackets included. */
    @Test
    fun keepsTextExact() {
        val json = """{"a":[1,"x, {y}: \"z\""],"b":{},"c":"a b, c: d","d":"\\\"[]{}\\","e":"\u0301x"}"""
        val expected =
            listOf(
                "{",
                """  "a": [""",
                "    1,",
                """    "x, {y}: \"z\""""",
                "  ],",
                """  "b": {""",
                "    ",
                "  },",
                """  "c": "a b, c: d",""",
                """  "d": "\\\"[]{}\\",""",
                """  "e": "\u0301x"""",
                "}",
            ).joinToString("\n")
        assertEquals(expected, indentedJson(json))
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
