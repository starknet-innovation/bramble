package org.bramble.wallet.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.bramble.core.AccountFamily
import org.bramble.core.CoreException
import org.bramble.core.InternalException
import org.bramble.core.RecoveryCandidate
import org.bramble.core.recoveryLimits
import org.bramble.wallet.LiveRpcTransport
import org.bramble.wallet.RecoveryScanDriver
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.CheckRow
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.restoreRecoveredAccounts

/** The three families in the extension's order, with their disclosure titles. */
private val FAMILIES =
    listOf(
        AccountFamily.OPEN_ZEPPELIN to "Bramble accounts",
        AccountFamily.ARGENT to "Ready accounts",
        AccountFamily.BRAAVOS to "Braavos accounts",
    )

private const val FIND_ACCOUNTS_LEDE =
    "Bramble checks the first 20 account indices for Bramble, Ready, and Braavos accounts. " +
        "Accounts with on-chain activity are selected automatically."

/**
 * `data-onboarding-step="recovery-accounts"` (`recovery-account-ui.ts`), twin of the iOS
 * `FindAccountsStep`: the first 20 indices searched for Bramble, Ready and Braavos accounts (the
 * core derives and judges; [RecoveryScanDriver] only moves bytes), active ones selected, an
 * advanced manual index, and one atomic restore. The selection alone gates it, as the extension's
 * `refreshGate` since its Mainnet acknowledgement was deleted. No "Back to passphrase": the vault is
 * already sealed with recovery pending, so a lock or kill resumes here (`Route.DISCOVERY`).
 */
@Composable
fun FindAccountsStep(
    store: WalletStore,
    done: () -> Unit,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val driver = remember { RecoveryScanDriver(store.walletCore, LiveRpcTransport()) }
    var result by remember { mutableStateOf<String?>(null) }
    var restoring by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { driver.start(store.networkInfo) }
    DisposableEffect(Unit) { onDispose { driver.cancel() } }

    OnboardingStep(
        back = null,
        heading =
            StepHeading(
                icon = BrambleIconName.SEARCH,
                title = "Find your accounts",
                lede = FIND_ACCOUNTS_LEDE,
            ),
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
                ScanStatus(store, driver) { scope.launch { driver.start(store.networkInfo) } }
                FAMILIES.forEach { (family, title) -> FamilyDisclosure(store, driver, family, title) }
                ManualIndex(store, driver)
                StatusLine(result)
            }
        },
        cta = {
            PillButton(
                "Restore selected accounts",
                busy = restoring,
                enabled = driver.selected.isNotEmpty() && !driver.scanning,
            ) {
                restoring = true
                result = "Restoring the selected accounts into your encrypted vault…"
                scope.launch {
                    restoreSelected(store, driver, done) {
                        result = "Account recovery failed"
                        store.showToast("Account recovery failed")
                        restoring = false
                    }
                }
            }
        },
    )
}

/**
 * Restores the checked rows, then [done]. A refusal from the core (or a Rust panic) runs [failed]
 * instead, which shows fixed copy rather than the core's detail; cancellation propagates.
 */
private suspend fun restoreSelected(
    store: WalletStore,
    driver: RecoveryScanDriver,
    done: () -> Unit,
    failed: () -> Unit,
) {
    try {
        val count = store.restoreRecoveredAccounts(driver.selections)
        store.showNotice("$count account${if (count == 1) "" else "s"} restored")
        done()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (ignored: CoreException) {
        failed()
    } catch (ignored: InternalException) {
        failed()
    }
}

/** The search status with its retry control, and which endpoint the search asks. */
@Composable
private fun ScanStatus(
    store: WalletStore,
    driver: RecoveryScanDriver,
    retry: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.weight(1f),
        ) { StatusLine(driver.status, if (driver.failed) StatusTone.DANGER else StatusTone.MUTED) }
        IconButton(
            BrambleIconName.REFRESH,
            "Retry account search",
            tint = skin.muted,
            enabled = !driver.scanning,
            onClick = retry,
        )
    }
    Text(
        "The search asks ${store.networkInfo.name}’s RPC endpoint about each derived address.",
        color = skin.muted,
        style = textStyle(BrambleTypeScale.caption),
    )
}

/** One family's disclosure; it opens itself the first time it has a detected account. */
@Composable
private fun FamilyDisclosure(
    store: WalletStore,
    driver: RecoveryScanDriver,
    family: AccountFamily,
    title: String,
) {
    val rows = driver.candidates.filter { it.family == family }.sortedBy { it.accountIndex }
    val detected = rows.count { it.deployed || it.funded }
    var open by remember { mutableStateOf(false) }
    var autoOpened by remember { mutableStateOf(false) }
    LaunchedEffect(detected) {
        if (detected > 0 && !autoOpened) {
            autoOpened = true
            open = true
        }
    }
    Disclosure(
        title,
        open = open,
        onToggle = { open = !open },
        detail = if (detected == 0) null else "$detected ${if (detected == 1) "account" else "accounts"} detected",
    ) {
        rows.forEach { candidate -> CandidateRow(store, driver, candidate) }
    }
}

/** `.select-row`: checkbox, "Account <index>" title, the 6…4 address in mono, and the core's hint. */
@Composable
private fun CandidateRow(
    store: WalletStore,
    driver: RecoveryScanDriver,
    candidate: RecoveryCandidate,
) {
    val skin = LocalSkin.current
    CheckRow(
        candidate.title,
        checked = candidate.key in driver.selected,
        enabled = candidate.selectable,
        onCheckedChange = {
            if (!driver.toggle(candidate)) {
                store.showToast(
                    "Choose at most ${recoveryLimits().maxSelections} accounts. Uncheck one to add another.",
                )
            }
        },
    ) {
        Text(candidate.shortAddress, color = skin.muted, style = textStyle(BrambleTypeScale.caption, mono = true))
        Text(candidate.hint, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
    }
}

/** "Advanced manual index": probes one index across every family. */
@Composable
private fun ManualIndex(
    store: WalletStore,
    driver: RecoveryScanDriver,
) {
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var manual by remember { mutableStateOf("") }
    Disclosure("Advanced manual index", open = open, onToggle = { open = !open }) {
        BrambleField(
            label = "Account index",
            placeholder = "0",
            value = manual,
            onValueChange = { manual = it.filter(Char::isDigit) },
            modifier = Modifier.fillMaxWidth(),
            kind = SecretKind.AMOUNT,
        )
        PillButton("Check this index", kind = PillKind.SECONDARY, enabled = !driver.scanning) {
            val index = manual.toUIntOrNull()
            if (index == null || index > recoveryLimits().maxIndex) {
                store.showToast("Enter a valid non-negative account index")
            } else {
                scope.launch { driver.scan(store.networkInfo, index) }
            }
        }
    }
}
