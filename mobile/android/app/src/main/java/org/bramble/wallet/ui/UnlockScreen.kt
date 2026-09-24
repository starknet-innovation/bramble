package org.bramble.wallet.ui

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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.bramble.wallet.R
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.FlexSpacer
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle

/** The side panel's display tracking for gate and onboarding headlines (iOS uses -0.035). */
internal const val HEADLINE_TRACKING = -0.035f

/**
 * `.gate` unlock, port of the iOS `UnlockView`: brand disc, "Welcome back", one passphrase field,
 * Unlock at the foot. A failure shows on the status line and as a toast, and the typed
 * passphrase is cleared after every attempt, successful or not.
 */
@Composable
fun UnlockScreen(store: WalletStore) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var passphrase by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<String?>(null) }
    val unlock = {
        val attempt = passphrase
        passphrase = ""
        scope.launch {
            try {
                store.unlock(attempt)
                failure = null
            } catch (ignored: CancellationException) {
            } catch (error: Exception) {
                failure = describe(error)
                store.showError(error)
            }
        }
        Unit
    }
    Column(
        Modifier.fillMaxSize().background(skin.bg).safeDrawingPadding()
            .padding(start = BrambleSpace.lg, end = BrambleSpace.lg, bottom = BrambleSpace.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        Box(
            Modifier.padding(top = BrambleSpace.xl + BrambleSpace.xl).size(BrambleSize.brand).background(skin.accent, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painterResource(R.drawable.brand_mark),
                contentDescription = null,
                colorFilter = ColorFilter.tint(skin.accentText),
                modifier = Modifier.size(BrambleLayout.unlockMark),
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Text("Welcome back", color = skin.text, style = textStyle(BrambleTypeScale.headline, BrambleWeight.heavy, HEADLINE_TRACKING))
            Text("Unlock your wallet to continue.", color = skin.muted, style = textStyle(BrambleTypeScale.body), textAlign = TextAlign.Center)
        }
        BrambleField(
            label = null,
            placeholder = "Enter your passphrase",
            value = passphrase,
            onValueChange = { passphrase = it },
            onSubmit = { if (passphrase.isNotEmpty()) unlock() },
        )
        StatusLine(failure, StatusTone.DANGER)
        FlexSpacer()
        PillButton("Unlock", busy = store.busy, enabled = passphrase.isNotEmpty(), onClick = unlock)
    }
}
