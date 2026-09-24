package org.bramble.wallet

import android.os.Parcelable
import android.text.InputType
import android.util.SparseArray
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.FrameLayout
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.bramble.wallet.design.SecretEditText
import org.bramble.wallet.design.SecretInput
import org.bramble.wallet.design.SecretKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Threats T4, T5 and T10 on the one input every secret goes through: the full input type
 * (class bits included), no personalised learning, no autofill, and no saved-instance state.
 */
@RunWith(AndroidJUnit4::class)
class SecretFieldTest {
    private val secret = "abandon ability able"

    private fun <T> onMain(block: () -> T): T {
        var result: Result<T>? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync { result = runCatching(block) }
        return result!!.getOrThrow()
    }

    private fun field(kind: SecretKind, action: Int = EditorInfo.IME_ACTION_DONE): SecretEditText =
        SecretEditText(InstrumentationRegistry.getInstrumentation().targetContext).apply { configure(kind, action) }

    private fun editorInfo(edit: SecretEditText): EditorInfo = EditorInfo().also { edit.onCreateInputConnection(it) }

    @Test
    fun passphraseFieldsAreMaskedTextWithoutSuggestionsOrLearning() = onMain {
        val info = editorInfo(field(SecretKind.PASSPHRASE))
        assertEquals(SecretInput.PASSPHRASE_TYPE, info.inputType)
        assertEquals(
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS,
            info.inputType,
        )
        assertEquals(InputType.TYPE_CLASS_TEXT, info.inputType and EditorInfo.TYPE_MASK_CLASS)
        assertTrue(info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
        assertTrue(info.imeOptions and EditorInfo.IME_FLAG_NO_EXTRACT_UI != 0)
    }

    @Test
    fun wordFieldsAreReadableTextWithoutSuggestionsOrLearning() = onMain {
        val info = editorInfo(field(SecretKind.WORD, EditorInfo.IME_ACTION_NEXT))
        assertEquals(SecretInput.WORD_TYPE, info.inputType)
        assertEquals(
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS,
            info.inputType,
        )
        assertEquals(InputType.TYPE_CLASS_TEXT, info.inputType and EditorInfo.TYPE_MASK_CLASS)
        assertTrue(info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
        assertEquals(EditorInfo.IME_ACTION_NEXT, info.imeOptions and EditorInfo.IME_MASK_ACTION)
    }

    @Test
    fun autofillIsExcluded() = onMain {
        assertEquals(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, field(SecretKind.PASSPHRASE).importantForAutofill)
    }

    @Test
    fun typedTextNeverReachesSavedState() = onMain {
        val edit = field(SecretKind.WORD)
        assertFalse(edit.isSaveEnabled)
        assertFalse(edit.getFreezesText())
        assertEquals(View.NO_ID, edit.id)
        edit.setText(secret)

        val own = SparseArray<Parcelable>()
        edit.saveHierarchyState(own)
        assertEquals("the field saves nothing", 0, own.size())

        // Inside a parent that does save (as Compose's AndroidView holder does), still nothing.
        val parent = FrameLayout(edit.context).apply { id = View.generateViewId(); addView(edit) }
        val tree = SparseArray<Parcelable>()
        parent.saveHierarchyState(tree)
        for (index in 0 until tree.size()) {
            assertFalse("saved state holds the secret", tree.valueAt(index).toString().contains(secret))
        }
    }
}
