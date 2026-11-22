package org.bramble.wallet.ui.wallet

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.rpcOverride
import org.bramble.wallet.saveRpcOverride

/** The extension's "What an endpoint can learn" help, under the field. */
private const val RPC_HINT =
    "Each service sees the requests sent to it. Use only ones you trust. Clear a field to restore the default."

/**
 * "RPC endpoint" under Settings → Network, as iOS `RpcEndpointDisclosure` (the extension's
 * `advancedNetworkFlow` `#rpc-form`, bound in `endpoint-ui.ts`): one custom endpoint for the
 * selected network, tried before the bundled ones (`endpointNetwork`). The core's refusal is shown
 * as it words it. Never log the field: the URL may carry an API key.
 */
@Composable
fun RpcEndpointSettings(store: WalletStore) {
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var url by remember { mutableStateOf("") }
    var custom by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(store.network) {
        url = store.rpcOverride()
        custom = url.isNotEmpty()
        error = null
    }
    Disclosure("RPC endpoint", open = open, onToggle = { open = !open }, detail = if (custom) "Custom" else "Default") {
        BrambleField(
            "Custom endpoint for ${store.networkInfo.name}",
            "https://…",
            url,
            { url = it },
            kind = SecretKind.ADDRESS,
            invalid = error != null,
            hint = RPC_HINT,
        )
        PillButton("Save endpoint", kind = PillKind.SECONDARY, icon = BrambleIconName.CHECK) {
            val target = store.network
            val typed = url
            scope.launch {
                store.saveEndpoint(target, typed, refused = { error = it }) { saved ->
                    url = saved.orEmpty()
                    custom = saved != null
                    error = null
                }
            }
        }
        StatusLine(error, StatusTone.DANGER)
    }
}

/**
 * Saves [typed] as [target]'s endpoint, with the notice or the refusal. [shown] gets what is stored
 * only while [target] is still selected: the field shows the selected network's endpoint, and a
 * switch meanwhile has reloaded it.
 */
private suspend fun WalletStore.saveEndpoint(
    target: NetworkId,
    typed: String,
    refused: (String) -> Unit,
    shown: (String?) -> Unit,
) {
    runCatching { saveRpcOverride(target, typed) }
        .onSuccess { saved ->
            showNotice(if (saved == null) "RPC endpoint reset" else "RPC endpoint saved")
            if (network == target) shown(saved)
        }.onFailure { failure ->
            if (failure !is CancellationException) refused(rpcOverrideRefusal(failure).also { showToast(it) })
        }
}

/** The core's refusal in its own words ([describe]), else the extension's fallback line. */
private fun rpcOverrideRefusal(failure: Throwable): String =
    if (failure is CoreException.InvalidInput) describe(failure) else "RPC endpoint update failed"
