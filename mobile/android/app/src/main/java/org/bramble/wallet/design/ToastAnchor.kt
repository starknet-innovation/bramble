package org.bramble.wallet.design

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned

/**
 * Top of the current screen's foot action, in root pixels, or null when the screen marks none.
 * `.toast-stack` sits `SPACE.md` above the dock; a screen with no dock (unlock, onboarding) marks
 * its primary action with [toastAnchor] so the toast stacks just above that action instead of at
 * the dock's offset, which on those screens (and above the keyboard) falls between the action and
 * the content over it. Provided by `Root`; as the iOS `ToastAnchorKey`.
 */
val LocalToastAnchor = staticCompositionLocalOf<MutableState<Float?>> { mutableStateOf(null) }

/** Marks this element as the screen's foot action; cleared when it leaves the composition. */
fun Modifier.toastAnchor(): Modifier =
    composed {
        val anchor = LocalToastAnchor.current
        DisposableEffect(anchor) { onDispose { anchor.value = null } }
        onGloballyPositioned { anchor.value = it.boundsInRoot().top }
    }
