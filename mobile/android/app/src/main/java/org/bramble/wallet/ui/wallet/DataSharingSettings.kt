package org.bramble.wallet.ui.wallet

import android.content.Context
import android.content.Intent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import org.bramble.wallet.BuildConfig
import org.bramble.wallet.GatewayAnalytics
import org.bramble.wallet.ReliabilityDiagnostics
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.CheckRow
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.setProductAnalytics
import org.bramble.wallet.setReliabilityDiagnostics

/**
 * "Product analytics" under Settings → Network (`settings/network-views.ts`, iOS
 * `ProductAnalyticsDisclosure`): the extension's checkbox. Off by default on mobile.
 */
@Composable
fun ProductAnalyticsSettings(store: WalletStore) {
    val skin = LocalSkin.current
    var open by remember { mutableStateOf(false) }
    var on by remember { mutableStateOf(GatewayAnalytics.shared?.enabled == true) }
    Disclosure("Product analytics", open = open, onToggle = { open = !open }, detail = if (on) "On" else "Off") {
        CheckRow("Share pseudonymous gateway usage", on, { next ->
            on = next
            store.setProductAnalytics(next)
        })
        Text(
            "Helps Bramble understand feature usage and failures.",
            color = skin.muted,
            style = textStyle(BrambleTypeScale.caption),
        )
    }
}

/**
 * "Reliability diagnostics" under Settings → Network: local counters the person exports through the
 * share sheet as text. Nothing is sent.
 */
@Composable
fun ReliabilityDiagnosticsSettings(store: WalletStore) {
    val skin = LocalSkin.current
    val context = LocalContext.current
    var open by remember { mutableStateOf(false) }
    var on by remember { mutableStateOf(ReliabilityDiagnostics.enabled) }
    Disclosure("Reliability diagnostics", open = open, onToggle = { open = !open }, detail = if (on) "On" else "Off") {
        CheckRow("Keep anonymous RPC and explorer reliability counters on this device", on, { next ->
            on = next
            store.setReliabilityDiagnostics(next)
        })
        Text(
            "Stays on this device until you export it.",
            color = skin.muted,
            style = textStyle(BrambleTypeScale.caption),
        )
        PillButton("Export diagnostics", kind = PillKind.SECONDARY, icon = BrambleIconName.RECEIVE) {
            shareDiagnostics(context, store)
        }
    }
}

/** Hands the report to the share sheet as plain text; the person picks where it goes, if anywhere. */
private fun shareDiagnostics(
    context: Context,
    store: WalletStore,
) {
    val report = ReliabilityDiagnostics.report(store.allRecords.size, store.network, BuildConfig.VERSION_NAME)
    val send =
        Intent(Intent.ACTION_SEND)
            .setType("application/json")
            .putExtra(Intent.EXTRA_SUBJECT, "bramble-diagnostics.json")
            .putExtra(Intent.EXTRA_TEXT, report)
    runCatching { context.startActivity(Intent.createChooser(send, null)) }
        .onFailure { store.showToast("Diagnostic export failed") }
}
