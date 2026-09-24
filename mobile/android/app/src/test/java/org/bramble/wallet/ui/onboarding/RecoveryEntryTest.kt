package org.bramble.wallet.ui.onboarding

import org.junit.Assert.assertEquals
import org.junit.Test

/** The recovery grid's input rules, as the iOS `RecoveryEntryGrid` binding. */
class RecoveryEntryTest {
    private val empty = RecoveryEntry.empty()

    @Test
    fun lowercasesAndStaysWhileTyping() {
        val edit = RecoveryEntry.apply(empty, 0, "Aban")
        assertEquals("aban", edit.words[0])
        assertEquals(FocusMove.Stay, edit.focus)
    }

    @Test
    fun aSpaceAfterAWordAdvances() {
        assertEquals(FocusMove.To(1), RecoveryEntry.apply(empty, 0, "abandon ").focus)
        assertEquals(FocusMove.Stay, RecoveryEntry.apply(empty, 0, " ").focus)
        assertEquals(FocusMove.Release, RecoveryEntry.apply(empty, 11, "zoo ").focus)
    }

    @Test
    fun aPasteSpreadsFromTheCell() {
        val edit = RecoveryEntry.apply(empty, 2, "one two  three")
        assertEquals(listOf("", "", "one", "two", "three"), edit.words.take(5))
        assertEquals(FocusMove.Release, edit.focus)
        assertEquals(FocusMove.To(5), RecoveryEntry.apply(empty, 2, "one two three ").focus)
    }

    @Test
    fun aLongPasteGrowsTheGridTo24() {
        val phrase = (1..24).joinToString(" ") { "w$it" }
        val edit = RecoveryEntry.apply(empty, 0, phrase)
        assertEquals(24, edit.words.size)
        assertEquals("w24", edit.words[23])
    }

    @Test
    fun theToggleSwitchesSizeAndClears() {
        assertEquals(List(24) { "" }, RecoveryEntry.toggled(empty.toMutableList().also { it[0] = "abandon" }))
        assertEquals(List(12) { "" }, RecoveryEntry.toggled(List(24) { "x" }))
    }
}
