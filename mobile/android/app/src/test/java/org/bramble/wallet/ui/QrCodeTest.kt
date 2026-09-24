package org.bramble.wallet.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Kotlin encoder draws exactly the extension's matrix. `qr-parity.txt` is written by
 * `mobile/android/scripts/qr-fixture.ts`, which runs the extension's `shared/qr.ts`.
 */
class QrCodeTest {
    private data class Case(val input: String, val rows: List<String>)

    private fun cases(): List<Case> {
        val text = checkNotNull(javaClass.classLoader?.getResource("qr-parity.txt")) { "qr-parity.txt" }.readText()
        val cases = ArrayList<Case>()
        var input: String? = null
        val rows = ArrayList<String>()
        for (line in text.lines()) {
            when {
                line.startsWith("input ") -> {
                    input?.let { cases.add(Case(it, rows.toList())) }
                    input = line.removePrefix("input ")
                    rows.clear()
                }
                line.startsWith("row ") -> rows.add(line.removePrefix("row "))
            }
        }
        input?.let { cases.add(Case(it, rows.toList())) }
        return cases
    }

    @Test
    fun matchesTheExtensionEncoder() {
        val cases = cases()
        assertTrue("fixture has cases", cases.size >= 4)
        for (case in cases) {
            val actual = QrCode.matrix(case.input).map { row -> row.joinToString("") { if (it) "1" else "0" } }
            assertEquals("matrix for ${case.input.take(20)}", case.rows, actual)
        }
    }
}
