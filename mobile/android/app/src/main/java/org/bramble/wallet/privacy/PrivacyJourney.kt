package org.bramble.wallet.privacy

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import org.bramble.core.DeploymentState
import org.bramble.core.NetworkId
import org.bramble.core.PrivacyBlocker
import org.bramble.core.PrivacyEntry
import org.bramble.core.PrivacyReading
import org.bramble.core.privacyEntry
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.textStyle

/**
 * `startJourney` / `continueJourney`, twin of the iOS `PrivacyJourney.start`, decided by the
 * core's [privacyEntry] from [deployment] (the store's last judgement, never assumed): the host
 * only reads what an answer asks for, [checkDeployment] or one fresh private-balance [read], and
 * asks again. A deployment that still cannot be judged, or a second `Discovering`, ends at the
 * service blocker with its hint. Never throws for a network failure: the reads report `UNKNOWN`
 * or a failed [reading].
 */
suspend fun resolvePrivacyJourney(
    network: NetworkId,
    deployment: DeploymentState,
    reading: () -> PrivacyReading,
    checkDeployment: suspend () -> DeploymentState,
    read: suspend () -> Unit,
): PrivacyJourneyBlock {
    var known = deployment
    var afterRead = false
    var stop: PrivacyJourneyBlock? = null
    while (stop == null) {
        stop =
            when (val entry = privacyEntry(network, known, reading(), afterRead)) {
                is PrivacyEntry.Blocked -> {
                    PrivacyJourneyBlock(entry.blocker, journeyHint(entry.blocker))
                }

                is PrivacyEntry.CheckDeployment -> {
                    known = checkDeployment()
                    PrivacyJourneyBlock(PrivacyBlocker.SERVICE, PrivacyCopy.deploymentUnchecked)
                        .takeIf { known == DeploymentState.UNKNOWN }
                }

                is PrivacyEntry.Discovering -> {
                    // One fresh read; a second `Discovering` after it ends at the service blocker.
                    val readNow = !afterRead
                    if (readNow) {
                        read()
                        afterRead = true
                    }
                    PrivacyJourneyBlock(PrivacyBlocker.SERVICE, PrivacyCopy.blockedServiceTitle).takeIf { !readNow }
                }
            }
    }
    return stop
}

/**
 * Where the privacy journey stopped. Mobile submits nothing yet (docs/privacy.md §1), so every
 * journey ends at a blocker.
 *
 * @property blocker the core's blocker for this account and network.
 * @property hint the reason line under it, or null when the blocker's own copy says it all.
 */
data class PrivacyJourneyBlock(
    val blocker: PrivacyBlocker,
    val hint: String?,
)

/** The reason line under a blocker; service text is never shown, so a failed read has the fallback. */
private fun journeyHint(blocker: PrivacyBlocker): String? =
    when (blocker) {
        PrivacyBlocker.DEPLOY -> PrivacyCopy.deployRequired
        PrivacyBlocker.SERVICE -> PrivacyCopy.blockedServiceTitle
        else -> null
    }

/**
 * Re-reads the active account's private balances and feeds them to the portfolio's Home rows and
 * hero (`unifiedHomeBalances`); a reading for another scope is dropped by [PrivacyModel].
 */
suspend fun WalletStore.refreshPrivacy() {
    val account = activeRecord
    if (account == null) {
        privacy.reset()
    } else {
        privacy.retain(network, account.id)
        privacy.refresh(walletCore, networkInfo, account.id)
    }
    portfolio.setPrivacy(privacy.reading, privacy.state)
}

/** The journey for the active account, from the store's deployment and privacy reading. */
suspend fun WalletStore.privacyJourney(): PrivacyJourneyBlock {
    val account = activeRecord ?: return PrivacyJourneyBlock(PrivacyBlocker.SERVICE, PrivacyCopy.blockedServiceTitle)
    val info = networkInfo
    return resolvePrivacyJourney(
        network,
        deployment,
        reading = { privacy.reading },
        checkDeployment = { rpc.deploymentState(account.address, info) },
        read = { refreshPrivacy() },
    )
}

/**
 * The privacy flow screen, twin of the iOS `PrivacyJourneyView`: the preparing wait while the
 * journey reads, then one blocker with its next step. Retry runs the journey again.
 */
@Composable
fun PrivacyJourneyScreen(
    store: WalletStore,
    chooseNetwork: () -> Unit,
    back: () -> Unit,
) {
    var attempt by remember { mutableIntStateOf(0) }
    var block by remember { mutableStateOf<PrivacyJourneyBlock?>(null) }
    LaunchedEffect(attempt) {
        block = null
        block = store.privacyJourney()
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(PrivacyCopy.headerJourney, subtitle = "STRK", network = store.networkLabel, back = back)
        val current = block
        if (current == null) {
            Preparing(back)
        } else {
            PrivacyBlockedScreen(
                current.blocker,
                current.hint,
                chooseNetwork = chooseNetwork,
                retry = { attempt += 1 },
                back = back,
            )
        }
    }
}

/** The preparing wait: a spinner, the title and body, and the way back. */
@Composable
private fun Preparing(back: () -> Unit) {
    val skin = LocalSkin.current
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        CircularProgressIndicator(color = skin.text, modifier = Modifier.size(BrambleControl.hit))
        Text(
            PrivacyCopy.preparingTitle,
            color = skin.text,
            style = textStyle(BrambleTypeScale.title, BrambleWeight.bold),
        )
        Text(PrivacyCopy.preparingBody, color = skin.muted, style = textStyle(BrambleTypeScale.body))
        Text(PrivacyCopy.preparingHint, color = skin.muted, style = textStyle(BrambleTypeScale.label))
        PillButton(PrivacyCopy.backToWallet, kind = PillKind.SECONDARY, onClick = back)
    }
}
