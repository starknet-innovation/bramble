package org.bramble.wallet.ui.onboarding

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
import org.bramble.wallet.design.fieldEdge
import org.bramble.wallet.design.textStyle

// `.recovery-grid`, port of the iOS RecoveryGrid: three numbered columns of word cells. The entry
// grid flags unknown words and offers BIP-39 completions from the core
// (`recovery_word_suggestions`); the display grid masks its words until revealed.

private const val COLUMNS = 3
private val fieldShape = RoundedCornerShape(BrambleRadius.md)

/** Rows of three cells. Not lazy: focus must reach any cell, and a phrase is at most 24 cells. */
@Composable
private fun ThreeColumnGrid(count: Int, cell: @Composable RowScope.(Int) -> Unit) {
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
private fun WordCell(number: Int, modifier: Modifier, invalid: Boolean = false, content: @Composable () -> Unit) {
    val skin = LocalSkin.current
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(BrambleLayout.wordCellGap), verticalAlignment = Alignment.CenterVertically) {
        Text(
            "$number",
            color = skin.muted,
            textAlign = TextAlign.End,
            style = textStyle(BrambleTypeScale.mono, BrambleWeight.semibold, mono = true),
            modifier = Modifier.width(BrambleLayout.wordNumberWidth),
        )
        Box(
            Modifier.weight(1f)
                .heightIn(min = BrambleSize.control)
                .background(skin.elevated, fieldShape)
                .fieldEdge(if (invalid) skin.danger else skin.border)
                .padding(horizontal = BrambleSpace.sm),
            contentAlignment = Alignment.CenterStart,
        ) { content() }
    }
}

/** The editable grid. [words] holds 12 or 24 cells; every edit goes through [RecoveryEntry]. */
@Composable
fun RecoveryEntryGrid(words: List<String>, onWordsChange: (List<String>) -> Unit) {
    val skin = LocalSkin.current
    var focused by remember { mutableStateOf<Int?>(null) }
    var focusTarget by remember { mutableStateOf<Int?>(null) }
    fun move(focus: FocusMove) {
        when (focus) {
            FocusMove.Stay -> Unit
            is FocusMove.To -> focusTarget = focus.index
            FocusMove.Release -> focusTarget = null
        }
    }
    fun choose(index: Int, word: String) {
        onWordsChange(words.toMutableList().also { it[index] = word })
        move(if (index + 1 < words.size) FocusMove.To(index + 1) else FocusMove.Release)
    }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        ThreeColumnGrid(words.size) { index ->
            val word = words[index].trim()
            val invalid = word.isNotEmpty() && focused != index && !isRecoveryWord(word)
            WordCell(index + 1, Modifier.weight(1f), invalid) {
                SecretField(
                    value = words[index],
                    onValueChange = { value ->
                        val edit = RecoveryEntry.apply(words, index, value)
                        onWordsChange(edit.words)
                        move(edit.focus)
                    },
                    accessibilityLabel = "Word ${index + 1}",
                    kind = SecretKind.WORD,
                    style = BrambleTypeScale.body,
                    imeAction = if (index == words.size - 1) EditorInfo.IME_ACTION_DONE else EditorInfo.IME_ACTION_NEXT,
                    requestFocus = focusTarget == index,
                    onFocusRequestHandled = { focusTarget = null },
                    onFocusChange = { has -> if (has) focused = index else if (focused == index) focused = null },
                    onBackspaceWhenEmpty = { if (index > 0) focusTarget = index - 1 },
                    onImeAction = {
                        val first = suggestionsFor(words[index]).firstOrNull()
                        if (first != null) choose(index, first) else move(if (index + 1 < words.size) FocusMove.To(index + 1) else FocusMove.Release)
                    },
                )
            }
        }
        val index = focused
        if (index != null && index < words.size) {
            val options = suggestionsFor(words[index])
            if (options.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                    options.forEach { option ->
                        Box(
                            Modifier.height(BrambleLayout.suggestionHeight)
                                .background(skin.elevated, RoundedCornerShape(percent = 50))
                                .clickable(role = Role.Button) { choose(index, option) }
                                .padding(horizontal = BrambleSpace.md),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(option, color = skin.text, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
                        }
                    }
                }
            }
        }
    }
}

/** BIP-39 completions for a typed prefix, without the word already typed. */
private fun suggestionsFor(typed: String): List<String> = recoveryWordSuggestions(typed).filter { it != typed }

/**
 * The read-only grid. Masked words are blurred (API 31+) or covered by a sunken fill (API 28–30,
 * where `Modifier.blur` does nothing), and hidden from accessibility until revealed. Each word
 * carries the test tag `recovery-word-N`, as the iOS accessibility identifier.
 */
@Composable
fun RecoveryWordGrid(words: List<String>, masked: Boolean) {
    val skin = LocalSkin.current
    val canBlur = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    ThreeColumnGrid(words.size) { index ->
        WordCell(index + 1, Modifier.weight(1f).then(if (masked) Modifier.clearAndSetSemantics {} else Modifier)) {
            Box {
                Text(
                    words[index],
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.body),
                    modifier = Modifier.testTag("recovery-word-${index + 1}")
                        .then(if (masked && canBlur) Modifier.blur(BrambleLayout.maskBlur) else Modifier),
                )
                if (masked && !canBlur) Box(Modifier.matchParentSize().background(skin.sunken))
            }
        }
    }
}
