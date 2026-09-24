package org.bramble.wallet.ui

import android.content.ClipboardManager
import android.content.Context
import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.InterceptPlatformTextInput
import androidx.compose.ui.platform.PlatformTextInputMethodRequest
import org.bramble.wallet.design.BrambleCopy

// UNCOMPILED: this machine has no Android SDK. Written against Compose UI 1.7 (BOM 2024.12.01),
// whose InterceptPlatformTextInput KDoc sample sets exactly this flag.

/**
 * Hardens the keyboard session of every text field inside [content] for secrets (passwords and
 * the recovery phrase). Compose's `KeyboardOptions` cannot express these, so the platform
 * `EditorInfo` is edited after Compose fills it:
 *
 * - `IME_FLAG_NO_PERSONALIZED_LEARNING`: the IME must not learn or store what is typed
 *   (Gboard and other keyboards honour it; an IME that ignores it is outside the app's control).
 * - A password variation (`VISIBLE_PASSWORD` when [masked] is false, so the phrase stays readable)
 *   plus `TYPE_TEXT_FLAG_NO_SUGGESTIONS`: no suggestion strip, no autocorrect dictionary.
 *
 * Nothing secret is read here; only the editor attributes change.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun SecretKeyboard(masked: Boolean, content: @Composable () -> Unit) {
    InterceptPlatformTextInput(
        interceptor = { request, nextHandler ->
            val hardened = object : PlatformTextInputMethodRequest {
                override fun createInputConnection(outAttributes: EditorInfo): InputConnection {
                    val connection = request.createInputConnection(outAttributes)
                    hardenEditorInfo(outAttributes, masked)
                    return connection
                }
            }
            nextHandler.startInputMethod(hardened)
        },
        content = content,
    )
}

/** Applies the secret-field attributes to [info], keeping only Compose's layout flags (multi-line). */
internal fun hardenEditorInfo(info: EditorInfo, masked: Boolean) {
    val variation = if (masked) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
    val flags = info.inputType and InputType.TYPE_MASK_FLAGS and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT.inv() and
        InputType.TYPE_TEXT_FLAG_AUTO_COMPLETE.inv() and InputType.TYPE_TEXT_FLAG_CAP_SENTENCES.inv() and
        InputType.TYPE_TEXT_FLAG_CAP_WORDS.inv() and InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS.inv()
    info.inputType = InputType.TYPE_CLASS_TEXT or variation or flags or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    info.imeOptions = info.imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
}

/**
 * A paste into the phrase field: more than one word arrived in a single edit. Mirrors the iOS
 * recovery grid, which treats several words landing in one cell as a paste.
 */
fun isPhrasePaste(before: String, after: String): Boolean {
    fun words(text: String) = text.split(Regex("\\s+")).count { it.isNotEmpty() }
    return words(after) - words(before) > 1
}

/**
 * Clears the clipboard after a phrase was pasted, without reading it (reading would show
 * Android 12+'s paste notice and pull the phrase into app memory again), and says so with the
 * extension-generated copy. `clearPrimaryClip` is API 28, the app's minimum.
 */
fun clearClipboardAfterPaste(context: Context) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    if (clipboard.hasPrimaryClip()) clipboard.clearPrimaryClip()
    Toast.makeText(context, BrambleCopy.clipboardCleared, Toast.LENGTH_SHORT).show()
}
