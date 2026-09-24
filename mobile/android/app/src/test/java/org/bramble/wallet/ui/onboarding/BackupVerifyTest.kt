package org.bramble.wallet.ui.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** `backup-verify.ts`: fixed positions, trimmed, case-insensitive, empty fails. */
class BackupVerifyTest {
    private val words = (1..12).map { "word$it" }

    @Test
    fun checksPositionsThreeSevenEleven() {
        assertEquals(listOf(3, 7, 11), BackupVerify.POSITIONS)
        assertTrue(BackupVerify.confirmed(words, listOf("word3", "word7", "word11")))
    }

    @Test
    fun trimsAndIgnoresCase() {
        assertTrue(BackupVerify.confirmed(words, listOf(" WORD3", "Word7 ", "word11")))
    }

    @Test
    fun rejectsWrongEmptyOrMissingAnswers() {
        assertFalse(BackupVerify.confirmed(words, listOf("word3", "word8", "word11")))
        assertFalse(BackupVerify.confirmed(words, listOf("word3", "", "word11")))
        assertFalse(BackupVerify.confirmed(words, listOf("word3", "word7")))
        assertFalse("a short phrase cannot confirm", BackupVerify.confirmed(words.take(10), listOf("word3", "word7", "word11")))
        assertFalse(BackupVerify.confirmed(List(12) { "" }, listOf("", "", "")))
    }
}
