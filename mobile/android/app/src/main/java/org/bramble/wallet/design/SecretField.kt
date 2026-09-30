package org.bramble.wallet.design

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Parcelable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.AbsSavedState
import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView

/**
 * What the one hardened input holds: a vault passphrase (masked), one recovery word (readable), a
 * recipient address (readable, pasteable), or a token amount (the decimal keypad). The last two are
 * not secrets, but they go through the same field so no second input path exists and no
 * suggestion strip or keyboard dictionary learns an address or an amount either.
 */
enum class SecretKind {
    /** A vault passphrase: masked. */
    PASSPHRASE,

    /** One recovery-phrase word: readable. */
    WORD,

    /** A recipient address: readable and pasteable. */
    ADDRESS,

    /** A token amount: the decimal keypad. */
    AMOUNT,
}

/**
 * Keyboard and autofill policy for every secret input (threat T4/T5 in `docs/android-parity.md`,
 * section 5.1 of `docs/vault-security.md`). The class bits are always `TYPE_CLASS_TEXT`: variation
 * and flag bits only apply inside a class, and a class of zero is `TYPE_NULL`, where an IME may
 * ignore the no-suggestions hint. Both kinds carry `TYPE_TEXT_FLAG_NO_SUGGESTIONS` and no
 * auto-correct, auto-complete or capitalisation flag, so no suggestion strip or dictionary sees
 * what is typed; passphrases are masked, phrase words stay readable.
 */
object SecretInput {
    /** Masked text with no suggestions. */
    const val PASSPHRASE_TYPE: Int =
        InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_VARIATION_PASSWORD or
            InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS

    /** Readable text with no suggestions (a visible-password variation, so no dictionary). */
    const val WORD_TYPE: Int =
        InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or
            InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS

    /** No learning from what is typed, and no full-screen extract editor that copies the text. */
    const val IME_FLAGS: Int = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING or EditorInfo.IME_FLAG_NO_EXTRACT_UI

    /** Digits and one decimal separator; a number class carries no suggestions by definition. */
    const val AMOUNT_TYPE: Int = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL

    /**
     * The input type for [kind]: addresses share the word policy. A [revealed] passphrase (the
     * creation screens' show control, never Unlock) takes the readable word policy, so it still
     * has no suggestions and no personalised learning while it is on screen.
     */
    fun inputType(
        kind: SecretKind,
        revealed: Boolean = false,
    ): Int =
        when (kind) {
            SecretKind.PASSPHRASE -> if (revealed) WORD_TYPE else PASSPHRASE_TYPE
            SecretKind.WORD, SecretKind.ADDRESS -> WORD_TYPE
            SecretKind.AMOUNT -> AMOUNT_TYPE
        }
}

/**
 * The platform field behind [SecretField]. Compose foundation in the pinned BOM cannot set
 * `IME_FLAG_NO_PERSONALIZED_LEARNING`, so secrets go through an `EditText`, hardened so its text
 * never reaches a saved-instance Bundle (which `onStop` and configuration changes hand to
 * system_server, and which can outlive the process):
 * - `isSaveEnabled = false` and no view id, so `saveHierarchyState` (which Compose's `AndroidView`
 *   feeds into its saveable registry) skips it;
 * - `EditText.getFreezesText()` is hard-wired to true, so it is overridden, and
 *   `onSaveInstanceState` returns the empty state even if called directly.
 * Copy, cut, and share are removed from its selection menu; paste stays, for importing a phrase.
 */
class SecretEditText(
    context: Context,
) : EditText(context) {
    internal var syncing = false
    internal var onChange: (String) -> Unit = {}
    internal var onFocus: (Boolean) -> Unit = {}
    internal var onBackspaceWhenEmpty: () -> Unit = {}
    internal var onImeAction: (() -> Unit)? = null

    init {
        id = View.NO_ID
        isSaveEnabled = false
        setFreezesText(false)
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        background = null
        setPadding(0, 0, 0, 0)
        maxLines = 1
        addTextChangedListener(
            object : TextWatcher {
                override fun beforeTextChanged(
                    s: CharSequence?,
                    start: Int,
                    count: Int,
                    after: Int,
                ) = Unit

                override fun onTextChanged(
                    s: CharSequence?,
                    start: Int,
                    before: Int,
                    count: Int,
                ) = Unit

                override fun afterTextChanged(s: Editable?) {
                    if (!syncing) onChange(s?.toString().orEmpty())
                }
            },
        )
        setOnFocusChangeListener { _, focused -> onFocus(focused) }
        setOnKeyListener { _, keyCode, event ->
            val emptyDelete =
                keyCode == KeyEvent.KEYCODE_DEL && event.action == KeyEvent.ACTION_DOWN && text.isNullOrEmpty()
            if (emptyDelete) onBackspaceWhenEmpty()
            emptyDelete
        }
        setOnEditorActionListener { _, _, _ ->
            val handler = onImeAction
            handler?.invoke()
            handler != null
        }
        val noCopy =
            object : ActionMode.Callback {
                override fun onCreateActionMode(
                    mode: ActionMode?,
                    menu: Menu?,
                ) = true

                override fun onPrepareActionMode(
                    mode: ActionMode?,
                    menu: Menu?,
                ): Boolean {
                    menu?.removeItem(android.R.id.copy)
                    menu?.removeItem(android.R.id.cut)
                    menu?.removeItem(android.R.id.shareText)
                    return true
                }

                override fun onActionItemClicked(
                    mode: ActionMode?,
                    item: MenuItem?,
                ) = false

                override fun onDestroyActionMode(mode: ActionMode?) = Unit
            }
        customSelectionActionModeCallback = noCopy
        customInsertionActionModeCallback = noCopy
    }

    override fun getFreezesText(): Boolean = false

    override fun onSaveInstanceState(): Parcelable? {
        super.onSaveInstanceState()
        return AbsSavedState.EMPTY_STATE
    }

    /** Applies [SecretInput] for [kind]; [imeAction] is an `EditorInfo.IME_ACTION_*` value. */
    fun configure(
        kind: SecretKind,
        imeAction: Int,
    ) {
        inputType = SecretInput.inputType(kind)
        // setInputType swaps password fields to monospace; words keep the body face, as on iOS.
        typeface = Typeface.DEFAULT
        imeOptions = imeAction or SecretInput.IME_FLAGS
    }

    /** Switches to [type] (masking or showing a passphrase) and keeps the caret where it was. */
    internal fun applyInputType(type: Int) {
        if (inputType == type) return
        val start = selectionStart
        val end = selectionEnd
        inputType = type
        typeface = Typeface.DEFAULT
        if (start >= 0 && end >= 0) setSelection(start, end)
    }

    internal fun setValue(value: String) {
        if (text?.toString() == value) return
        syncing = true
        setText(value)
        setSelection(value.length)
        syncing = false
    }

    internal fun focusAndShowKeyboard() {
        post {
            requestFocus()
            context
                .getSystemService(
                    InputMethodManager::class.java,
                )?.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
        }
    }
}

/** Test tag on the Compose wrapper of a secret field, so UI tests can scroll it into view. */
fun secretFieldTag(label: String): String = "secret:$label"

/**
 * The only input used for secrets: every passphrase and recovery-word field goes through it, and
 * no Compose `BasicTextField` takes secret text (Compose's `KeyboardOptions` cannot set
 * `IME_FLAG_NO_PERSONALIZED_LEARNING`, and its editor cannot be kept out of saved state or the
 * copy menu). [accessibilityLabel] becomes the field's content description, which is also how
 * instrumented tests find it (with Espresso: the field is a platform view, not a Compose semantics
 * node). [textColor] overrides the ink, for an invalid field. [revealed] shows a passphrase (the
 * creation screens only); a new field always starts masked. The field's text is cleared when it
 * leaves the composition.
 */
@Composable
fun SecretField(
    value: String,
    onValueChange: (String) -> Unit,
    accessibilityLabel: String,
    kind: SecretKind,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    textColor: Color? = null,
    style: BrambleTypeStyle = BrambleTypeScale.row,
    imeAction: Int = EditorInfo.IME_ACTION_DONE,
    requestFocus: Boolean = false,
    onFocusRequestHandled: () -> Unit = {},
    onFocusChange: (Boolean) -> Unit = {},
    onBackspaceWhenEmpty: () -> Unit = {},
    onImeAction: (() -> Unit)? = null,
    revealed: Boolean = false,
) {
    val skin = LocalSkin.current
    AndroidView(
        factory = { context -> SecretEditText(context).apply { configure(kind, imeAction) } },
        modifier = modifier.fillMaxWidth().testTag(secretFieldTag(accessibilityLabel)),
        onRelease = { edit -> edit.text?.clear() },
        update = { edit ->
            edit.onChange = onValueChange
            edit.onFocus = onFocusChange
            edit.onBackspaceWhenEmpty = onBackspaceWhenEmpty
            edit.onImeAction = onImeAction
            edit.applyInputType(SecretInput.inputType(kind, revealed))
            val imeOptions = imeAction or SecretInput.IME_FLAGS
            if (edit.imeOptions != imeOptions) edit.imeOptions = imeOptions
            edit.contentDescription = accessibilityLabel
            edit.hint = placeholder
            edit.setTextColor((textColor ?: skin.text).toArgb())
            edit.setHintTextColor(skin.muted.toArgb())
            edit.highlightColor = skin.accentSoft.toArgb()
            edit.setTextSize(TypedValue.COMPLEX_UNIT_SP, style.size.value)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                edit.textCursorDrawable =
                    GradientDrawable().apply {
                        setColor(skin.accent.toArgb())
                        setSize((edit.resources.displayMetrics.density * 2).toInt(), 0)
                    }
            }
            edit.setValue(value)
            if (requestFocus) {
                edit.focusAndShowKeyboard()
                onFocusRequestHandled()
            }
        },
    )
}
