package org.bramble.wallet.browser

import org.junit.Assert.assertEquals
import org.junit.Test

/** The sign card's pure helper: the document re-indented, never parsed. */
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
}
