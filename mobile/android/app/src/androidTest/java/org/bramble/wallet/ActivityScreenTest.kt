package org.bramble.wallet

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasStateDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performSemanticsAction
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.ActivityEntry
import org.bramble.core.ActivityKind
import org.bramble.core.NetworkId
import org.bramble.core.TxStatus
import org.bramble.core.explorerTransactionUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * The Activity dock reads the core's one activity store: a row the core holds for the active
 * account renders under its day, with its explorer link, and the link is the core's transaction
 * URL for this network. Opened, a row lists the network and token contract its own entry records:
 * the transaction here has two legs under one hash, as a swap does, and each row shows its own
 * leg's contract. The rows are written through the store's own lane (`scanApply`, the RPC scan's
 * path), so nothing here restates the core's rules.
 */
@RunWith(AndroidJUnit4::class)
class ActivityScreenTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    @Test
    fun coreRowsLinkToExplorer() {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        openPublicWalletOn(FixtureNode(deployed = true))
        r.waitForHome()
        val accountId = r.onMain { activeRecord?.id }.orEmpty()
        val entry =
            ActivityEntry(
                accountId = accountId,
                amount = "1000000000000000000",
                counterparty = COUNTERPARTY,
                failureNotice = null,
                finalizedOnL1 = null,
                hash = HASH,
                kind = ActivityKind.TRANSFER,
                network = NetworkId.MAINNET,
                notFoundCount = null,
                status = TxStatus.ACCEPTED,
                submittedAt = System.currentTimeMillis().toULong(),
                summary = "Sent 1 STRK",
                token = STRK,
                tokenAddress = STRK,
            )
        r.onMain {
            walletCore.activityBook().scanApply(
                accountId,
                NetworkId.MAINNET,
                listOf(entry, entry.copy(amount = "2000000000000000000", token = ETH, tokenAddress = ETH)),
                System.currentTimeMillis().toDouble(),
            )
            portfolio.reloadActivity()
        }

        r.tapDescribed("Activity")
        r.waitFor(hasTestTag("activity-row-$HASH"), TIMEOUT_MS)
        r.waitFor(hasTestTag("activity-link-$HASH") and hasClickAction())
        val row = r.onMain { portfolio.groups.flatMap { it.rows }.firstOrNull { it.hash == HASH } }
        assertNotNull("the core's row reaches the Activity list", row)
        assertEquals(explorerTransactionUrl(NetworkId.MAINNET, HASH), row?.explorerUrl)
        assertNotNull("mainnet has an explorer", row?.explorerUrl)

        // Open both legs' disclosures through their own action: a touch at a row's centre could
        // land on the explorer link instead.
        val collapsed = hasStateDescription("Collapsed") and hasAnyAncestor(hasTestTag("activity-row-$HASH"))
        repeat(2) {
            rule.onAllNodes(collapsed)[0].performSemanticsAction(SemanticsActions.OnClick)
            rule.waitForIdle()
        }
        r.waitForText("Token contract")
        r.waitFor(hasContentDescription("Copy token contract address") and hasClickAction())
        r.waitForText("Network")
        r.waitForText("Starknet Mainnet")
        // Each leg shows its own contract, once.
        rule.onAllNodes(hasText(STRK)).assertCountEquals(1)
        rule.onAllNodes(hasText(ETH)).assertCountEquals(1)
        r.snapshot("activity")
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
        const val HASH = "0x4a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddee"
        const val COUNTERPARTY = "0x5b7c2e1f00000000000000000000000000000000000000000000000000c0ffe"
        const val STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
        const val ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    }
}
