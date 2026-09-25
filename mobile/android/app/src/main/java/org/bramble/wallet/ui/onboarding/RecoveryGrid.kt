package org.bramble.wallet.ui.onboarding

import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.view.inputmethod.EditorInfo
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import org.bramble.core.isRecoveryWord
import org.bramble.core.recoveryWordSuggestions
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.SecretField
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.textStyle

// `.recovery-grid`, port of the iOS RecoveryGrid: three numbered columns of word cells. The entry
// grid flags unknown words and offers BIP-39 completions from the core
// (`recovery_word_suggestions`); the display grid masks its words until revealed.

private const val COLUMNS = 3
private val fieldShape = RoundedCornerShape(BrambleRadius.md)

/** Rows of three cells. Not lazy: focus must reach any cell, and a phrase is at most 24 cells. */
@Composable
private fun ThreeColumnGrid(
    count: Int,
    cell: @Composable RowScope.(Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        for (row in 0 until count step COLUMNS) {
            Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                for (index in row until minOf(row + COLUMNS, count)) cell(index)
                repeat(row + COLUMNS - minOf(row + COLUMNS, count)) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun WordCell(
    number: Int,
    modifier: Modifier,
    invalid: Boolean = false,
    content: @Composable () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(BrambleLayout.wordCellGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "$number",
            color = skin.muted,
            textAlign = TextAlign.End,
            style = textStyle(BrambleTypeScale.mono, BrambleWeight.semibold, mono = true),
            modifier = Modifier.width(BrambleLayout.wordNumberWidth),
        )
        Box(
            Modifier
                .weight(1f)
                .heightIn(min = BrambleSize.control)
                .background(if (invalid) skin.dangerSoft else skin.elevated, fieldShape)
                .padding(horizontal = BrambleSpace.sm),
            contentAlignment = Alignment.CenterStart,
        ) { content() }
    }
}

/**
 * The editable grid. [words] holds 12 or 24 cells; every edit goes through [RecoveryEntry]. A
 * multi-word edit can only be a paste: the clipboard is then cleared, with a write and never a
 * read (a read would pull the phrase into app memory again and show Android 12+'s paste notice),
 * and [onPaste] lets the caller say so.
 */
@Composable
fun RecoveryEntryGrid(
    words: List<String>,
    onPaste: () -> Unit = {},
    onWordsChange: (List<String>) -> Unit,
) {
    val context = LocalContext.current
    var focused by remember { mutableStateOf<Int?>(null) }
    var focusTarget by remember { mutableStateOf<Int?>(null) }

    fun move(focus: FocusMove) {
        focusTarget = targetAfter(focus, focusTarget)
    }

    fun choose(
        index: Int,
        word: String,
    ) {
        onWordsChange(words.toMutableList().also { it[index] = word })
        move(focusAfter(index, words.size))
    }
    val events =
        CellEvents(
            edit = { index, value ->
                if (RecoveryEntry.isPaste(value)) {
                    clearClipboard(context)
                    onPaste()
                }
                val edit = RecoveryEntry.apply(words, index, value)
                onWordsChange(edit.words)
                move(edit.focus)
            },
            focusChanged = { index, has ->
                if (has) {
                    focused = index
                } else if (focused == index) {
                    focused = null
                }
            },
            retarget = { focusTarget = it },
            submit = { index ->
                val first = suggestionsFor(words[index]).firstOrNull()
                if (first != null) {
                    choose(index, first)
                } else {
                    move(focusAfter(index, words.size))
                }
            },
        )
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        ThreeColumnGrid(words.size) { index ->
            EntryCell(words, index, focused, focusTarget, events)
        }
        SuggestionStrip(words, focused, ::choose)
    }
}

/** What an [EntryCell] reports back to [RecoveryEntryGrid], each keyed by the cell's index. */
private data class CellEvents(
    val edit: (Int, String) -> Unit,
    val focusChanged: (Int, Boolean) -> Unit,
    val retarget: (Int?) -> Unit,
    val submit: (Int) -> Unit,
)

/** The focus request after [focus]: a move targets its cell, a release clears, staying keeps [current]. */
private fun targetAfter(
    focus: FocusMove,
    current: Int?,
): Int? =
    when (focus) {
        FocusMove.Stay -> current
        is FocusMove.To -> focus.index
        FocusMove.Release -> null
    }

/** The next cell after [index] in a grid of [size] cells, or release after the last one. */
private fun focusAfter(
    index: Int,
    size: Int,
): FocusMove = if (index + 1 < size) FocusMove.To(index + 1) else FocusMove.Release

/** One editable cell; a word is flagged unknown only while its cell is not focused. */
@Composable
private fun RowScope.EntryCell(
    words: List<String>,
    index: Int,
    focused: Int?,
    focusTarget: Int?,
    events: CellEvents,
) {
    val skin = LocalSkin.current
    val word = words[index].trim()
    val invalid = word.isNotEmpty() && focused != index && !isRecoveryWord(word)
    WordCell(index + 1, Modifier.weight(1f), invalid) {
        SecretField(
            value = words[index],
            onValueChange = { value -> events.edit(index, value) },
            accessibilityLabel = "Word ${index + 1}",
            kind = SecretKind.WORD,
            textColor = if (invalid) skin.danger else null,
            style = BrambleTypeScale.body,
            imeAction = if (index == words.size - 1) EditorInfo.IME_ACTION_DONE else EditorInfo.IME_ACTION_NEXT,
            requestFocus = focusTarget == index,
            onFocusRequestHandled = { events.retarget(null) },
            onFocusChange = { has -> events.focusChanged(index, has) },
            onBackspaceWhenEmpty = { if (index > 0) events.retarget(index - 1) },
            onImeAction = { events.submit(index) },
        )
    }
}

/** BIP-39 completions for the focused cell, as tappable chips; nothing when none apply. */
@Composable
private fun SuggestionStrip(
    words: List<String>,
    focused: Int?,
    choose: (Int, String) -> Unit,
) {
    val skin = LocalSkin.current
    val index = focused
    if (index != null && index < words.size) {
        val options = suggestionsFor(words[index])
        if (options.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
            ) {
                options.forEach { option ->
                    Box(
                        Modifier
                            .height(BrambleLayout.suggestionHeight)
                            .background(skin.elevated, RoundedCornerShape(percent = 50))
                            .clickable(role = Role.Button) { choose(index, option) }
                            .padding(horizontal = BrambleSpace.md),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            option,
                            color = skin.text,
                            style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold),
                        )
                    }
                }
            }
        }
    }
}

/** Empties the clipboard without reading it. `clearPrimaryClip` is API 28, the app's minimum. */
private fun clearClipboard(context: Context) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    if (clipboard.hasPrimaryClip()) clipboard.clearPrimaryClip()
}

/** BIP-39 completions for a typed prefix, without the word already typed. */
private fun suggestionsFor(typed: String): List<String> = recoveryWordSuggestions(typed).filter { it != typed }

/**
 * The read-only grid. Masked words are blurred (API 31+) or covered by a sunken fill (API 28–30,
 * where `Modifier.blur` does nothing), and hidden from accessibility until revealed. Each word
 * carries the test tag `recovery-word-N`, as the iOS accessibility identifier.
 */
@Composable
fun RecoveryWordGrid(
    words: List<String>,
    masked: Boolean,
) {
    val skin = LocalSkin.current
    val canBlur = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    ThreeColumnGrid(words.size) { index ->
        WordCell(index + 1, Modifier.weight(1f).then(if (masked) Modifier.clearAndSetSemantics {} else Modifier)) {
            Box {
                Text(
                    words[index],
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.body),
                    modifier =
                        Modifier
                            .testTag("recovery-word-${index + 1}")
                            .then(if (masked && canBlur) Modifier.blur(BrambleLayout.maskBlur) else Modifier),
                )
                if (masked && !canBlur) Box(Modifier.matchParentSize().background(skin.sunken))
            }
        }
    }
}
