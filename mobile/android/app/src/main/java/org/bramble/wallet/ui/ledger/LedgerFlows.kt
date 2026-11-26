package org.bramble.wallet.ui.ledger

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.bramble.core.LedgerAccountRequest
import org.bramble.wallet.WalletStore
import org.bramble.wallet.addLedgerAccounts
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.heldAddresses
import org.bramble.wallet.ledger.LedgerStage
import org.bramble.wallet.ui.onboarding.OnboardingStep
import org.bramble.wallet.ui.onboarding.StepHeading

/**
 * Onboarding's Ledger step, twin of iOS `LedgerOnboardingStep`: connect and pick, then the
 * passphrase step creates the wallet. The connection ends when the picks are taken.
 */
@Composable
fun LedgerOnboardingStep(
    store: WalletStore,
    back: () -> Unit,
    next: (List<LedgerAccountRequest>) -> Unit,
) {
    val model = rememberLedgerModel(store.network, emptySet())
    OnboardingStep(
        back = back,
        heading = StepHeading(BrambleIconName.SHIELD, LedgerCopy.title(model.stage), LedgerCopy.lede(model.stage)),
        content = { LedgerConnectContent(model) },
        cta = {
            LedgerConnectAction(model, "Continue") { requests ->
                model.close()
                next(requests)
            }
        },
    )
}

/** Add account's "Ledger account", twin of iOS `LedgerAddAccountFlow`: connect, pick, add. */
@Composable
fun LedgerAddAccountFlow(
    store: WalletStore,
    back: () -> Unit,
    added: () -> Unit,
) {
    val model = rememberLedgerModel(store.network, store.heldAddresses)
    var adding by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        FlowHeader(LedgerCopy.title(model.stage), network = store.networkLabel, back = back)
        Column(
            Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        ) {
            if (model.stage != LedgerStage.Picking) StatusLine(LedgerCopy.LEDE)
            LedgerConnectContent(model)
        }
        val count = model.chosen.size
        val title = if (count > 1) "Add selected ($count)" else "Add selected"
        LedgerConnectAction(model, title, busy = adding) { requests ->
            if (!adding) {
                adding = true
                model.close()
                // The store's scope: leaving the sheet mid-call must not skip the reload and toast.
                store.appScope.launch {
                    runCatching { store.addLedgerAccounts(requests) }
                        .onSuccess { added() }
                        .onFailure(store::showError)
                    adding = false
                }
            }
        }
    }
}
