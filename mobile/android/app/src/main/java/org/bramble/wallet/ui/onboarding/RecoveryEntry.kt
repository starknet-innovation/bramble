package org.bramble.wallet.ui.onboarding

/** Where keyboard focus goes after an edit in the recovery grid. */
sealed interface FocusMove {
    /** Focus stays in the edited cell. */
    data object Stay : FocusMove

    /**
     * Focus moves to another cell.
     *
     * @property index The zero-based cell that receives focus.
     */
    data class To(
        val index: Int,
    ) : FocusMove

    /** Focus leaves the grid (the keyboard is dismissed). */
    data object Release : FocusMove
}

/**
 * The grid after one edit.
 *
 * @property words The cell values after the edit, lowercased.
 * @property focus Where keyboard focus goes next.
 */
data class RecoveryEdit(
    val words: List<String>,
    val focus: FocusMove,
)

/**
 * The recovery grid's input rules, port of the iOS `RecoveryEntryGrid` binding:
 * values are lowercased and split on whitespace; a space after a word moves to the next cell; a
 * multi-word paste spreads from this cell (switching a 12-cell grid to 24 when the phrase needs
 * it) and moves past the last pasted word only if the paste ended in whitespace.
 */
object RecoveryEntry {
    private const val SHORT = 12
    private const val LONG = 24

    /**
     * Applies [value] typed or pasted into cell [index] of [words]; pure, never throws for an
     * [index] inside [words].
     */
    fun apply(
        words: List<String>,
        index: Int,
        value: String,
    ): RecoveryEdit {
        val parts = value.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val endsInSpace = value.lastOrNull()?.isWhitespace() == true
        val next = words.toMutableList()
        if (parts.size > 1) {
            if (index + parts.size > SHORT && next.size == SHORT) repeat(LONG - SHORT) { next.add("") }
            parts.forEachIndexed { offset, word -> if (index + offset < next.size) next[index + offset] = word }
            val after = index + parts.size
            return RecoveryEdit(next, if (after < next.size && endsInSpace) FocusMove.To(after) else FocusMove.Release)
        }
        val word = parts.firstOrNull().orEmpty()
        next[index] = word
        val focus =
            when {
                !endsInSpace || word.isEmpty() -> FocusMove.Stay
                index + 1 < next.size -> FocusMove.To(index + 1)
                else -> FocusMove.Release
            }
        return RecoveryEdit(next, focus)
    }

    /** Several words arriving in one edit of one cell: a paste (the iOS grid's rule). */
    fun isPaste(value: String): Boolean = value.split(Regex("\\s+")).count { it.isNotEmpty() } > 1

    /** The other grid size, cleared, as the "Use a 24-word phrase" toggle. */
    fun toggled(words: List<String>): List<String> = List(if (words.size == SHORT) LONG else SHORT) { "" }

    /** A cleared 12-cell grid. */
    fun empty(): List<String> = List(SHORT) { "" }
}
