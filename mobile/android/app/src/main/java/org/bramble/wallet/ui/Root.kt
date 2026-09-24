package org.bramble.wallet.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import org.bramble.wallet.Route
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleMotion
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.TOAST_LIFETIME_MS
import org.bramble.wallet.design.Toast
import org.bramble.wallet.design.brambleTween
import org.bramble.wallet.ui.onboarding.OnboardingFlow
import org.bramble.wallet.ui.wallet.WalletShell

/**
 * Route switch and toast host, as the iOS `RootView`. Routes cut rather than cross-fade, so a
 * locked session's screens leave the composition (and their state) immediately. A lock during
 * onboarding before any vault exists keeps the route, so the flow is keyed on
 * [WalletStore.onboardingGeneration] and restarts from welcome with every typed secret dropped.
 */
@Composable
fun Root(store: WalletStore) {
    Box(Modifier.fillMaxSize().background(LocalSkin.current.bg)) {
        when (store.route) {
            // Keyed so a lock before the vault exists disposes the flow and its typed secrets.
            Route.ONBOARDING -> key(store.onboardingGeneration) { OnboardingFlow(store) }
            Route.LOCKED -> UnlockScreen(store)
            // An imported vault still recovery pending resumes at "Find your accounts".
            Route.DISCOVERY -> OnboardingFlow(store, resumingDiscovery = true)
            Route.WALLET -> WalletShell(store)
        }
        ToastHost(store, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun ToastHost(store: WalletStore, modifier: Modifier) {
    val message = store.toast
    var shown by remember { mutableStateOf("") }
    var positive by remember { mutableStateOf(false) }
    if (message != null) {
        shown = message
        positive = store.toastPositive
    }
    LaunchedEffect(message) {
        if (message != null) {
            delay(TOAST_LIFETIME_MS)
            store.dismissToast()
        }
    }
    AnimatedVisibility(
        visible = message != null,
        modifier = modifier.navigationBarsPadding().imePadding()
            .padding(start = BrambleSpace.md, end = BrambleSpace.md, bottom = BrambleLayout.toastBottom),
        enter = slideInVertically(brambleTween(BrambleMotion.toastMs)) { it } + fadeIn(brambleTween(BrambleMotion.toastMs)),
        exit = slideOutVertically(brambleTween(BrambleMotion.toastMs)) { it } + fadeOut(brambleTween(BrambleMotion.toastMs)),
    ) {
        Toast(shown, positive)
    }
}
