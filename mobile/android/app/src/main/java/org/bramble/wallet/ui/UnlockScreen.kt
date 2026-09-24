package org.bramble.wallet.ui

import android.content.Context
import android.os.SystemClock
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.bramble.core.CoreException
import org.bramble.wallet.R
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.FlexSpacer
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.securityCopy
import org.bramble.wallet.throttledText
import org.bramble.wallet.unlockWithBiometric

/** The side panel's display tracking for gate and onboarding headlines (iOS uses -0.035). */
internal const val HEADLINE_TRACKING = -0.035f

/**
 * `.gate` unlock, port of the iOS `UnlockView`: brand disc, "Welcome back", one passphrase field,
 * Unlock at the foot. A failure shows on the status line and as a toast, and the typed
 * passphrase is cleared after every attempt, successful or not. With biometrics on, the system
 * prompt starts once per appearance and a secondary button offers it again; the passphrase always
 * stays usable. While the core throttles attempts the button is disabled and the status line
 * counts down (the core refuses early attempts regardless).
 */
@Composable
fun UnlockScreen(store: WalletStore) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val activity = LocalContext.current
    var passphrase by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<String?>(null) }
    val now = rememberThrottleClock(store)
    LaunchedEffect(Unit) {
        store.refreshSecurity()
        if (store.security.biometricEnabled && store.biometricNotice == null) store.unlockWithBiometric(activity)
    }
    val remaining = store.retryRemainingMs(now)
    val unlock: () -> Unit = {
        val attempt = passphrase
        passphrase = ""
        scope.launchUnlock(store, attempt) { failure = it }
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(skin.bg)
            .safeDrawingPadding()
            .padding(start = BrambleSpace.lg, end = BrambleSpace.lg, bottom = BrambleSpace.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        UnlockHeader()
        BrambleField(
            label = null,
            placeholder = "Enter your passphrase",
            value = passphrase,
            onValueChange = { passphrase = it },
            onSubmit = { if (passphrase.isNotEmpty() && store.retryRemainingMs() == 0L) unlock() },
        )
        StatusLine(store.biometricNotice, StatusTone.DANGER)
        StatusLine(if (remaining > 0) throttledText(remaining) else failure, StatusTone.DANGER)
        FlexSpacer()
        if (store.security.biometricEnabled) BiometricUnlockButton(store, scope, activity)
        PillButton("Unlock", busy = store.busy, enabled = passphrase.isNotEmpty() && remaining == 0L, onClick = unlock)
    }
}

/**
 * The elapsed-realtime clock the throttle countdown reads: ticks every [COUNTDOWN_TICK_MS] while
 * the core's retry time is in the future, and stops once it has passed.
 */
@Composable
private fun rememberThrottleClock(store: WalletStore): Long {
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(store.retryAtElapsedMs) {
        now = SystemClock.elapsedRealtime()
        while (store.retryAtElapsedMs > now) {
            delay(COUNTDOWN_TICK_MS)
            now = SystemClock.elapsedRealtime()
        }
    }
    return now
}

/** Brand disc, "Welcome back", and the one-line prompt above the passphrase field. */
@Composable
private fun UnlockHeader() {
    val skin = LocalSkin.current
    Box(
        Modifier
            .padding(
                top = BrambleSpace.xl + BrambleSpace.xl,
            ).size(BrambleSize.brand)
            .background(skin.accent, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painterResource(R.drawable.brand_mark),
            contentDescription = null,
            colorFilter = ColorFilter.tint(skin.accentText),
            modifier = Modifier.size(BrambleLayout.unlockMark),
        )
    }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Text(
            "Welcome back",
            color = skin.text,
            style = textStyle(BrambleTypeScale.headline, BrambleWeight.heavy, HEADLINE_TRACKING),
        )
        Text(
            "Unlock your wallet to continue.",
            color = skin.muted,
            style = textStyle(BrambleTypeScale.body),
            textAlign = TextAlign.Center,
        )
    }
}

/** Offers the system biometric prompt again; the passphrase stays usable beside it. */
@Composable
private fun BiometricUnlockButton(
    store: WalletStore,
    scope: CoroutineScope,
    activity: Context,
) {
    PillButton(
        securityCopy(BrambleCopy.unlockWithBiometry),
        kind = PillKind.SECONDARY,
        icon = BrambleIconName.LOCK_KEYHOLE,
    ) {
        scope.launch { store.unlockWithBiometric(activity) }
    }
}

/**
 * Runs one passphrase attempt in [this] scope and reports the status-line text through
 * [onFailure]: null on success or when throttled (the countdown shows that), the described error
 * otherwise. A cancelled attempt reports nothing. Every failure also goes to [WalletStore.showError].
 */
private fun CoroutineScope.launchUnlock(
    store: WalletStore,
    attempt: String,
    onFailure: (String?) -> Unit,
) {
    launch {
        try {
            store.unlock(attempt)
            onFailure(null)
        } catch (ignored: CancellationException) {
            // The screen left composition mid-attempt: nothing to show.
        } catch (throttled: CoreException.Throttled) {
            // A throttled attempt is shown by the countdown below, which ends on its own.
            onFailure(null)
            store.showError(throttled)
        } catch (error: Exception) {
            onFailure(describe(error))
            store.showError(error)
        }
    }
}

/** How often the throttle countdown redraws. */
private const val COUNTDOWN_TICK_MS = 1_000L
