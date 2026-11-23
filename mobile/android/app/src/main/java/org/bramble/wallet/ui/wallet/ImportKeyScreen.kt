package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.OptionCard
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.onboarding.clearClipboard

/**
 * `importAccountChooser`, twin of iOS `ImportAccountChooser`: the second stage of "Import an
 * existing account". Mobile imports a private key; another recovery phrase is shown as coming, as
 * onboarding shows what it lacks. "Find my other accounts" and "Ready Ledger account" are left out.
 */
@Composable
fun ImportAccountChooser(
    store: WalletStore,
    back: () -> Unit,
    importKey: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        FlowHeader("Import an existing account", network = store.networkLabel, back = back)
        OptionCard(BrambleIconName.BOOK, "Recovery phrase", "Coming to Bramble mobile.", enabled = false) {}
        OptionCard(
            BrambleIconName.LINK,
            "Private key",
            "Import a single account from its raw Starknet key.",
            onClick = importKey,
        )
    }
}

/**
 * `importKeyFlow`, twin of iOS `ImportKeyForm` (Bramble account only: the core imports no Ready key
 * and takes no salt). The key goes through the hardened [BrambleField] as a phrase word does:
 * readable, no suggestions or personalised learning, no autofill, no copy or cut, kept out of saved
 * state, and the clipboard emptied after a paste. A refused key stays for the user to correct; the
 * key leaves state on success and when the form leaves composition, and a lock removes the
 * wallet's screens with it. The extension's hint on how the vault stores the key is left out
 * (`COPY_STYLE.md` rules 4 and 5).
 */
@Composable
fun ImportKeyForm(
    store: WalletStore,
    back: () -> Unit,
    imported: () -> Unit,
) {
    val skin = LocalSkin.current
    val context = LocalContext.current
    var key by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    // Set before the import starts, so a second tap (or the keyboard's Done) cannot pass while
    // store.busy is still false and send the same key twice.
    var submitting by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { key = "" } }

    fun submit() {
        val privateKey = key.trim()
        if (store.busy || submitting) return
        if (privateKey.isEmpty()) {
            result = "Enter a private key to import"
            return
        }
        result = null
        submitting = true
        // The store's scope, not the form's: leaving mid-import must not cancel the reload and
        // toast after the core has already sealed the account.
        store.appScope.launch {
            val outcome = runCatching { store.importPrivateKey(privateKey) }
            submitting = false
            outcome
                .onSuccess {
                    key = ""
                    imported()
                }.onFailure { refused ->
                    if (refused !is CancellationException) result = describe(refused)
                    store.showError(refused)
                }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        FlowHeader(
            "Import private key",
            subtitle = "Add a standalone account on ${store.networkLabel}",
            back = back,
        )
        Text(
            "Anyone with this key controls the account.",
            color = skin.danger,
            style = textStyle(BrambleTypeScale.caption),
        )
        Text(
            "Your recovery phrase won’t restore this account. Keep a copy of this key.",
            color = skin.danger,
            style = textStyle(BrambleTypeScale.caption),
        )
        BrambleField(
            label = "Raw Starknet private key",
            placeholder = "0x…",
            value = key,
            onValueChange = { value ->
                // A jump of more than one character is a paste: empty the clipboard, never read it.
                if (value.length > key.length + 1) {
                    clearClipboard(context)
                    store.showNotice(BrambleCopy.clipboardCleared)
                }
                key = value
            },
            kind = SecretKind.WORD,
            onSubmit = ::submit,
        )
        PillButton("Import account", icon = BrambleIconName.WALLET, busy = store.busy || submitting, onClick = ::submit)
        StatusLine(result, StatusTone.DANGER)
    }
}

/**
 * "Import private key" (`wallet.importAccount`, OpenZeppelin only), twin of iOS
 * `WalletStore.importPrivateKey`: the core seals the key in the vault and makes the account active;
 * no call returns the key. Throws the core's refusal ("invalid private key", "account already
 * exists", `Locked`) for the form to show.
 */
private suspend fun WalletStore.importPrivateKey(privateKey: String) {
    val network = network
    accountCall { it.importPrivateKey(network, privateKey) }
    showNotice("Account imported")
}
