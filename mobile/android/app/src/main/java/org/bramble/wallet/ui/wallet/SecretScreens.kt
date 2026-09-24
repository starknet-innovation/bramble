package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.onboarding.RecoveryWordGrid

/**
 * `reveal-software`, port of the iOS `RevealSecretsView`: warning, re-entered passphrase (the core
 * re-checks it; an unlocked session alone is not enough), then the words. "Hide secrets", leaving
 * the screen, and a lock all drop them; a reveal still running when the app locks is discarded by
 * the store and never reaches this screen.
 */
@Composable
fun RevealScreen(store: WalletStore, back: () -> Unit) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var passphrase by remember { mutableStateOf("") }
    var words by remember { mutableStateOf(emptyList<String>()) }
    DisposableEffect(Unit) { onDispose { words = emptyList() } }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader("Reveal secrets", subtitle = "Recovery phrase", network = store.networkLabel, back = back)
        Row(horizontalArrangement = Arrangement.spacedBy(BrambleLayout.pillGap)) {
            BrambleIcon(BrambleIconName.ALERT, skin.danger, BrambleLayout.revealAlertIcon)
            Text("Anyone who sees these can take your funds.", color = skin.danger, style = textStyle(BrambleTypeScale.title, BrambleWeight.bold))
        }
        Text(
            "Reveal only in private. Bramble will never ask you for them. They are shown once here and never leave this screen.",
            color = skin.muted,
            style = textStyle(BrambleTypeScale.body),
        )
        if (words.isEmpty()) {
            BrambleField(
                label = "Confirm vault passphrase",
                placeholder = "",
                value = passphrase,
                onValueChange = { passphrase = it },
                hint = "Re-enter it to reveal. An unlocked session alone is not enough.",
            )
            PillButton("Reveal secrets", icon = BrambleIconName.LOCK, busy = store.busy, enabled = passphrase.isNotEmpty()) {
                val attempt = passphrase
                passphrase = ""
                scope.launch {
                    runCatching { store.revealPhrase(attempt) }
                        .onSuccess { words = it }
                        .onFailure(store::showError)
                }
            }
        } else {
            RecoveryWordGrid(words, masked = false)
            PillButton("Hide secrets", kind = PillKind.SECONDARY) { words = emptyList() }
        }
    }
}

/** Removing the wallet re-checks the passphrase in the core before the vault is deleted. */
@Composable
fun RemoveWalletScreen(store: WalletStore, back: () -> Unit) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var passphrase by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(horizontal = BrambleSpace.lg), verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        FlowHeader("Remove wallet", subtitle = "From this device only", network = store.networkLabel, back = back)
        Text(
            "Your funds stay on Starknet, but you will need your recovery phrase to restore this wallet.",
            color = skin.muted,
            style = textStyle(BrambleTypeScale.body),
        )
        BrambleField(label = "Confirm vault passphrase", placeholder = "", value = passphrase, onValueChange = { passphrase = it })
        PillButton("Remove wallet", kind = PillKind.DANGER, busy = store.busy, enabled = passphrase.isNotEmpty()) {
            val attempt = passphrase
            passphrase = ""
            scope.launch { runCatching { store.deleteWallet(attempt) }.onFailure(store::showError) }
        }
    }
}
