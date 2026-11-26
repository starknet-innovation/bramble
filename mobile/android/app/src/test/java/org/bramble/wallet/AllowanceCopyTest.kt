package org.bramble.wallet

import org.bramble.core.AllowanceNotice
import org.bramble.core.AllowanceSource
import org.bramble.core.AllowanceView
import org.bramble.core.NetworkId
import org.bramble.core.RevokeException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.wallet.allowances.AllowanceCopy
import org.bramble.wallet.allowances.RevokeFlowModel
import org.bramble.wallet.allowances.amount
import org.bramble.wallet.allowances.canRevoke
import org.bramble.wallet.allowances.isUnlimited
import org.bramble.wallet.allowances.notice
import org.bramble.wallet.allowances.source
import org.bramble.wallet.allowances.subtitle
import org.bramble.wallet.errors.friendlyError
import org.bramble.wallet.send.SendFailureText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The allowance manager's row lines as the extension's `allowance-views.ts` paints them, and the
 * unlimited cut-off held to the fixture's `unlimited` block (the core does not export the judge in
 * v0.8.0). Pure: the listing, the review and the revoke run against the core in `AllowancesTest`
 * and the iOS `AllowanceFlowTests`.
 */
class AllowanceCopyTest {
    private val units = { amount: String -> "$amount units" }

    private fun view(
        amount: String,
        lowerBound: Boolean = false,
        source: AllowanceSource = AllowanceSource.WALLET,
        unconfirmed: Boolean = false,
    ) = AllowanceView("x", "a", NetworkId.SEPOLIA, "0x1", "0x2", amount, lowerBound, false, source, unconfirmed)

    @Test
    fun unlimitedFollowsTheFixture() {
        val cases =
            File("../../core/tests/fixtures/extension-allowances.jsonl")
                .readLines()
                .filter { it.contains(""""block":"unlimited"""") }
        assertEquals(6, cases.size)
        val amount = Regex(""""amount":"([^"]*)"""")
        cases.forEach { line ->
            val value = amount.find(line)!!.groupValues[1]
            assertEquals(value, line.contains(""""unlimited":true"""), AllowanceCopy.isUnlimited(value))
        }
    }

    @Test
    fun amountsReadAsTheExtensions() {
        assertEquals("1000 units", AllowanceCopy.amount(view("1000"), units))
        assertEquals("Unlimited", AllowanceCopy.amount(view("340282366920938463463374607431768211455", true), units))
        assertEquals("an unknown amount", AllowanceCopy.amount(view("0", lowerBound = true), units))
        assertEquals("at least 5 units", AllowanceCopy.amount(view("5", lowerBound = true), units))
    }

    @Test
    fun sourcesNoticesAndRevoke() {
        assertEquals("on-chain", AllowanceCopy.source(AllowanceSource.EXTERNAL))
        assertEquals("this wallet", AllowanceCopy.source(AllowanceSource.WALLET))
        assertEquals(
            "This wallet keeps 50 approvals per account and drops the smallest first, so some may be missing.",
            AllowanceCopy.notice(AllowanceNotice.RETENTION_FULL),
        )
        assertEquals(AllowanceCopy.scanIncomplete, AllowanceCopy.notice(AllowanceNotice.SCAN_INCOMPLETE))
        assertEquals("3 outstanding", AllowanceCopy.subtitle(3))
        assertTrue(AllowanceCopy.canRevoke(view("1")))
        assertFalse(
            "a multisig's grant takes its own intent",
            AllowanceCopy.canRevoke(view("1", source = AllowanceSource.MULTISIG)),
        )
        assertFalse("an unconfirmed contract would be granted", AllowanceCopy.canRevoke(view("1", unconfirmed = true)))
    }

    @Test
    fun lockReadsSendsLockLine() {
        val lockLine = SendFailureText.message(SendFailure(SendFailureCode.LOCKED, null, null))
        assertEquals(lockLine, RevokeFlowModel.shown(RevokeException.Locked()))
        assertFalse(lockLine == friendlyError("wallet is locked"))
        val notFound = RevokeFlowModel.shown(RevokeException.NotFound())
        assertEquals(friendlyError("allowance not found"), notFound)
    }

    @Test
    fun aRefusalReadsInTheCoresWords() {
        assertEquals(
            "That's an NFT contract, not a token. Revoke it from the site that asked.",
            RevokeFlowModel.shown(RevokeException.Collection()),
        )
        assertEquals(
            "Couldn't confirm that contract is a token, so the revoke wasn't sent. Revoke it from the site that asked.",
            RevokeFlowModel.shown(RevokeException.UnconfirmedToken()),
        )
    }

    @Test
    fun hashKeptOnlyIfItMayHaveLanded() {
        assertTrue(SendFailureText.mayHaveReachedChain(SendFailureCode.SUBMISSION_INDETERMINATE))
        assertTrue(SendFailureText.mayHaveReachedChain(SendFailureCode.DEPLOYMENT_THEN_INVOKE_UNCONFIRMED))
        assertFalse(SendFailureText.mayHaveReachedChain(SendFailureCode.LOCKED))
        assertFalse(SendFailureText.mayHaveReachedChain(SendFailureCode.NODE_ERROR))
    }
}
