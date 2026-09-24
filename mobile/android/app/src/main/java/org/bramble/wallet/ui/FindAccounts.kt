package org.bramble.wallet.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.launch
import org.bramble.core.AccountFamily
import org.bramble.core.recoveryLimits
import org.bramble.wallet.LiveRpcTransport
import org.bramble.wallet.RecoveryScanDriver
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.*

// "Find your accounts" (`recovery-account-ui.ts`), twin of iOS FindAccountsStep.swift: the first 20
// indices for Bramble, Ready, and Braavos accounts, active ones selected, a manual index, and the
// acknowledgement that gates restore on every network. UNCOMPILED (no Android SDK here).
@Composable
fun FindAccounts(store: WalletStore) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val driver = remember { RecoveryScanDriver(store.walletCore, LiveRpcTransport()) }
    var acknowledged by remember { mutableStateOf(false) }
    var manual by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    var restoring by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { driver.start(store.networkInfo) }
    DisposableEffect(Unit) { onDispose { driver.cancel() } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(BrambleSpace.lg), verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Text("Find your accounts", color = skin.text, style = textStyle(BrambleTypeScale.headline, BrambleWeight.bold))
        Text("Bramble checks the first 20 account indices for Bramble, Ready, and Braavos accounts. Accounts with on-chain activity are selected automatically.",
            color = skin.muted, style = textStyle(BrambleTypeScale.body))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(driver.status, color = if (driver.failed) skin.danger else skin.muted, style = textStyle(BrambleTypeScale.caption), modifier = Modifier.weight(1f))
            Text("↻", color = skin.muted, modifier = Modifier.semantics { contentDescription = "Retry account search" }
                .clickable(enabled = !driver.scanning) { scope.launch { driver.start(store.networkInfo) } }.padding(BrambleSpace.sm))
        }
        listOf(AccountFamily.OPEN_ZEPPELIN to "Bramble accounts", AccountFamily.ARGENT to "Ready accounts", AccountFamily.BRAAVOS to "Braavos accounts")
            .forEach { (family, title) ->
                val rows = driver.candidates.filter { it.family == family }.sortedBy { it.accountIndex }
                val detected = rows.count { it.deployed || it.funded }
                Card {
                    Text(if (detected == 0) title else "$title · $detected ${if (detected == 1) "account" else "accounts"} detected",
                        color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
                    rows.forEach { candidate ->
                        Row(verticalAlignment = Alignment.Top) {
                            Checkbox(
                                checked = candidate.key in driver.selected,
                                enabled = candidate.selectable,
                                onCheckedChange = {
                                    if (!driver.toggle(candidate)) {
                                        store.toast = "Choose at most ${recoveryLimits().maxSelections} accounts. Uncheck one to add another." to false
                                    }
                                },
                                colors = CheckboxDefaults.colors(checkedColor = skin.accent),
                            )
                            Column {
                                Text(candidate.title, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
                                Text(candidate.shortAddress, color = skin.muted, style = textStyle(BrambleTypeScale.caption, mono = true))
                                Text(candidate.hint, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
                            }
                        }
                    }
                }
            }
        Card {
            Text("Advanced manual index", color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            BrambleField("Account index", manual, { manual = it.filter(Char::isDigit) })
            SecondaryButton("Check this index") {
                val index = manual.toUIntOrNull()
                if (index == null || index > recoveryLimits().maxIndex) store.toast = "Enter a valid non-negative account index" to false
                else scope.launch { driver.scan(store.networkInfo, index) }
            }
        }
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.clickable { acknowledged = !acknowledged }) {
            Checkbox(checked = acknowledged, onCheckedChange = { acknowledged = it }, colors = CheckboxDefaults.colors(checkedColor = skin.accent))
            Text("I checked these account types and indices and want to restore the selected accounts on Starknet Mainnet.",
                color = skin.text, style = textStyle(BrambleTypeScale.body))
        }
        result?.let { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption)) }
        PrimaryButton("Restore selected accounts", enabled = driver.selected.isNotEmpty() && acknowledged && !driver.scanning, busy = restoring) {
            restoring = true
            result = "Restoring the selected accounts into your encrypted vault…"
            scope.launch {
                runCatching { driver.restore(store.network) }
                    .onSuccess { count ->
                        store.toast = "$count account${if (count == 1) "" else "s"} restored" to true
                        store.finishRecovery()
                    }
                    .onFailure {
                        result = "Account recovery failed"
                        restoring = false
                    }
            }
        }
    }
}
