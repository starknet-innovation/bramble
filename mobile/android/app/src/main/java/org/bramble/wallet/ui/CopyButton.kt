package org.bramble.wallet.ui

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay
import org.bramble.core.copyFeedback
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin

/**
 * `[data-copy]` (`docs/accounts.md` §2.8): a ghost icon button that copies the full public [value]
 * through [AddressClipboard] and swaps to a check for the core's `copyFeedback().confirmMs`.
 * API 33+ shows the system's own copy confirmation, so "Copied" is toasted only below it; a refused
 * clip toasts "Copy failed". [label] names the action ("Copy signer public key").
 */
@Composable
fun CopyButton(
    store: WalletStore,
    value: String,
    label: String,
) {
    val context = LocalContext.current
    val skin = LocalSkin.current
    var confirmed by remember { mutableStateOf(false) }
    LaunchedEffect(confirmed) {
        if (confirmed) {
            delay(copyFeedback().confirmMs.toLong())
            confirmed = false
        }
    }
    IconButton(
        if (confirmed) BrambleIconName.CHECK else BrambleIconName.COPY,
        label,
        tint = if (confirmed) skin.positive else skin.muted,
        enabled = value.isNotEmpty(),
    ) {
        if (AddressClipboard.copy(context, value, store.appScope)) {
            confirmed = true
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) store.showNotice("Copied")
        } else {
            store.showToast("Copy failed")
        }
    }
}
