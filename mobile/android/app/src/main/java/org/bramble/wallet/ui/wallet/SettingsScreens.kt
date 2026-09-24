package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import kotlinx.coroutines.launch
import org.bramble.core.coreInfo
import org.bramble.core.supportedNetworks
import org.bramble.wallet.NetworkPreference
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.SegmentedControl
import org.bramble.wallet.design.ThemeChoice
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.securityCopy

/** Settings hub (`settings-ui.ts`), port of the iOS `SettingsHubView`: eyebrow-labelled groups. */
@Composable
fun SettingsHubScreen(
    store: WalletStore,
    open: (Flow) -> Unit,
) {
    val skin = LocalSkin.current
    val info = remember { coreInfo() }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Text("Settings", color = skin.text, style = textStyle(BrambleTypeScale.title, BrambleWeight.bold))
        Eyebrow("Accounts & networks")
        MenuGroup {
            MenuRow(BrambleIconName.GLOBE, "Network", value = store.networkInfo.name) { open(Flow.NETWORK) }
            MenuDivider()
            MenuRow(BrambleIconName.BOOK, "Address book") { open(Flow.ADDRESS_BOOK) }
            MenuDivider()
            MenuRow(BrambleIconName.USERS, "Shared accounts") { open(Flow.SHARED_ACCOUNTS) }
        }
        Eyebrow("Preferences")
        MenuGroup {
            MenuRow(
                BrambleIconName.SETTINGS,
                "Appearance & currency",
                value = appearanceSummary(store),
            ) {
                open(Flow.APPEARANCE)
            }
        }
        Eyebrow("Backup & recovery")
        MenuGroup {
            MenuRow(BrambleIconName.LOCK, "Reveal recovery secrets") { open(Flow.REVEAL) }
        }
        Eyebrow("Security")
        MenuGroup {
            MenuRow(
                BrambleIconName.SHIELD,
                BrambleCopy.securityTitle,
                value = securityValue(store),
            ) { open(Flow.SECURITY) }
            MenuDivider()
            MenuRow(BrambleIconName.LOCK_KEYHOLE, "Lock wallet", chevron = false) { store.lock() }
            MenuDivider()
            MenuRow(BrambleIconName.ALERT, "Remove wallet from this device", tone = skin.danger) { open(Flow.REMOVE) }
        }
        Text(
            "Bramble core ${info.coreVersion} · Krusty KMS ${info.krustyVersion}",
            color = skin.muted,
            textAlign = TextAlign.Center,
            style = textStyle(BrambleTypeScale.caption, mono = true),
            modifier = Modifier.fillMaxWidth().padding(top = BrambleSpace.sm),
        )
    }
}

/** The Security row's value: "Fingerprint on" or "Passphrase only". */
private fun securityValue(store: WalletStore): String =
    if (store.security.biometricEnabled) securityCopy(BrambleCopy.securityRowOn) else BrambleCopy.securityRowOff

/** `network`: the supported networks as an option list, the active one selected. */
@Composable
fun NetworkScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val networks = remember { supportedNetworks() }
    Column(
        Modifier.fillMaxSize().padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader("Network", subtitle = "Choose where the wallet operates", network = store.networkLabel, back = back)
        MenuGroup {
            networks.forEachIndexed { offset, network ->
                if (offset > 0) MenuDivider()
                val selected = network.network == store.network
                Row(
                    Modifier
                        .fillMaxWidth()
                        .semantics(mergeDescendants = true) { this.selected = selected }
                        .fillPress(
                            if (selected) skin.accentSoft else Color.Transparent,
                            skin.softPress,
                            RoundedCornerShape(BrambleRadius.lg),
                            pressedScale = 1f,
                        ) { scope.launch { runCatching { store.switchNetwork(network.network) } } }
                        .heightIn(min = BrambleLayout.networkRowMin)
                        .padding(horizontal = BrambleSpace.lg),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                        Text(
                            network.name,
                            color = skin.text,
                            style = textStyle(BrambleTypeScale.row, BrambleWeight.medium),
                        )
                        Text(
                            NetworkPreference.chainLabel(network.network),
                            color = skin.muted,
                            style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold, mono = true),
                        )
                    }
                    if (selected) BrambleIcon(BrambleIconName.CHECK, skin.accent)
                }
            }
        }
        Text(
            "Switching selects or derives an account on the target network.",
            color = skin.muted,
            style = textStyle(BrambleTypeScale.label),
        )
        org.bramble.wallet.coordination
            .CoordinationRelaySettings(store)
    }
}

/** `appearance`: the Dark / Light theme segmented control. Dark is the default. */
@Composable
fun AppearanceScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader(
            "Appearance & currency",
            subtitle = "How the wallet looks and values assets",
            network = store.networkLabel,
            back = back,
        )
        Eyebrow("Theme")
        SegmentedControl(
            listOf("Dark" to ThemeChoice.DARK, "Light" to ThemeChoice.LIGHT),
            store.theme,
            onSelect = store::setTheme,
        )
        // The extension's "Values" section of the same screen (`settings-views.ts`).
        val scope = androidx.compose.runtime.rememberCoroutineScope()
        Eyebrow("Values")
        SegmentedControl(
            listOf(
                "USD" to org.bramble.core.DisplayCurrency.USD,
                "EUR" to org.bramble.core.DisplayCurrency.EUR,
                "GBP" to org.bramble.core.DisplayCurrency.GBP,
            ),
            store.portfolio.currency,
        ) { next -> scope.launch { store.portfolio.setCurrency(next) } }
        Text(
            "Prices and portfolio totals use this display currency. Token balances remain unchanged.",
            color = LocalSkin.current.muted,
            style = textStyle(BrambleTypeScale.caption),
        )
    }
}

/** The hub row's value: the theme, then the display currency's code. */
private fun appearanceSummary(store: WalletStore): String =
    "${if (store.theme == ThemeChoice.LIGHT) "Light" else "Dark"} · ${store.portfolio.currency.name.uppercase()}"
