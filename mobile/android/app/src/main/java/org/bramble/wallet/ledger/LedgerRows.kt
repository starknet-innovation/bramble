package org.bramble.wallet.ledger

import org.bramble.core.AccountFamily
import org.bramble.core.DeploymentState
import org.bramble.core.LedgerCandidate
import org.bramble.core.LedgerScheme
import org.bramble.core.NetworkInfo
import org.bramble.wallet.RpcClient

/**
 * Which accounts a Ledger flow reads, as iOS `LedgerRoute` (`onboard-session.ts`): Add account's
 * "Ledger account" reads Bramble's scheme, "Ready Ledger account" reads Ready's, and first-run
 * setup reads both.
 *
 * @property schemes the schemes each page is read at, in order.
 */
enum class LedgerRoute(
    val schemes: List<LedgerScheme>,
) {
    /** Bramble's scheme. */
    BRAMBLE(listOf(LedgerScheme.BRAMBLE)),

    /** Ready's scheme. */
    READY(listOf(LedgerScheme.READY)),

    /** Both, at first-run setup. */
    FIRST_RUN(listOf(LedgerScheme.BRAMBLE, LedgerScheme.READY)),
    ;

    /** Scheme families. */
    companion object {
        /**
         * The families a key read at [scheme] is placed as. The extension also places a
         * Ready-scheme key as Braavos; the core refuses Braavos Ledger accounts, so mobile does not.
         */
        fun families(scheme: LedgerScheme): List<AccountFamily> =
            if (scheme == LedgerScheme.BRAMBLE) {
                listOf(AccountFamily.OPEN_ZEPPELIN, AccountFamily.ARGENT)
            } else {
                listOf(AccountFamily.ARGENT)
            }
    }
}

/**
 * An address's on-chain state (`readLedgerAccountState`); a null half is a read that failed.
 *
 * @property deployed whether the account contract exists.
 * @property funded whether it holds any of the network's known tokens.
 */
data class LedgerActivity(
    val deployed: Boolean?,
    val funded: Boolean?,
) {
    /** `ledgerCandidateActive`: deployed, or holding a known token. Unknown counts as inactive. */
    val active: Boolean get() = deployed == true || funded == true

    /** The state nothing was read for. */
    companion object {
        /** Both reads failed. */
        val UNKNOWN = LedgerActivity(null, null)
    }
}

/**
 * One account the picker lists, as iOS `LedgerRow`.
 *
 * @property candidate what the device key places.
 * @property activity its on-chain state; null while the check runs.
 * @property existing already in this wallet: listed, never selectable.
 */
data class LedgerRow(
    val candidate: LedgerCandidate,
    val activity: LedgerActivity?,
    val existing: Boolean,
) {
    /** The row's key: its address. */
    val id: String get() = candidate.address

    /** The account's family. */
    val family: AccountFamily get() = candidate.request.family

    /** Whether the check found activity. */
    val active: Boolean get() = activity?.active == true

    /** An Argent account at Bramble's path, not Ready's. */
    val atBramblePath: Boolean
        get() = family == AccountFamily.ARGENT && candidate.request.scheme == LedgerScheme.BRAMBLE

    /**
     * `ledgerCandidateSelectable`: never a held account; an Argent one only when it is active,
     * since adding an unused one would deploy a family Bramble does not create.
     */
    val selectable: Boolean get() = !existing && (family == AccountFamily.OPEN_ZEPPELIN || active)

    /** `candidateState`: the row's status, in the recovery picker's words. */
    val status: String
        get() {
            val deployed = activity?.deployed
            val funded = activity?.funded
            val atReady = candidate.request.scheme == LedgerScheme.READY
            return when {
                existing -> "Already in this wallet"
                deployed == null -> "Checking…"
                deployed -> "Deployed on Starknet"
                funded == true && family == AccountFamily.OPEN_ZEPPELIN -> "Funded and ready to deploy"
                funded == true -> "Funded, not deployed"
                funded == null -> "Couldn't check this account's activity. Try again."
                family != AccountFamily.ARGENT -> NO_ACTIVITY
                atReady -> "$NO_ACTIVITY — Bramble only imports existing Ready accounts"
                else -> "$NO_ACTIVITY — Bramble only imports existing Argent accounts"
            }
        }

    private companion object {
        const val NO_ACTIVITY = "No on-chain activity found"
    }
}

/** The row title; an Argent account at Bramble's path is named so beside Ready's. */
fun LedgerRow.title(namingPath: Boolean): String {
    val index = candidate.request.accountIndex
    return if (namingPath && atBramblePath) "Account $index · Bramble path" else "Account $index"
}

/**
 * One group of the picker (`candidateGroup`, or Ready's flat list).
 *
 * @property title "Bramble accounts", "Argent accounts" or "Ready accounts".
 * @property rows its rows, in index order.
 * @property namingPath whether rows name their path ("Account 3 · Bramble path").
 */
data class LedgerGroup(
    val title: String,
    val rows: List<LedgerRow>,
    val namingPath: Boolean,
) {
    /** How many rows show activity. */
    val detected: Int get() = rows.count { it.active }

    /** Grouping. */
    companion object {
        /**
         * The groups [rows] form for [route]: Ready's one list, or Bramble then Argent accounts.
         * When one group holds both paths' Argent accounts, an unused one at Bramble's path is
         * left out, unless its balance read failed, so the failure is said, not hidden.
         */
        fun groups(
            rows: List<LedgerRow>,
            route: LedgerRoute,
        ): List<LedgerGroup> {
            if (route == LedgerRoute.READY) return listOf(LedgerGroup("Ready accounts", rows, false))
            return listOf(AccountFamily.OPEN_ZEPPELIN, AccountFamily.ARGENT).mapNotNull { family ->
                group(rows.filter { it.family == family }, family)
            }
        }

        private fun group(
            members: List<LedgerRow>,
            family: AccountFamily,
        ): LedgerGroup? {
            if (members.isEmpty()) return null
            val atBramble = { row: LedgerRow -> row.atBramblePath }
            val mixed = members.any { !atBramble(it) } && members.any(atBramble)
            val shown =
                if (mixed) {
                    members.filter {
                        !atBramble(it) || it.active || (it.activity?.deployed == false && it.activity.funded == null)
                    }
                } else {
                    members
                }
            val name =
                when {
                    family == AccountFamily.OPEN_ZEPPELIN -> "Bramble"
                    members.any { !atBramble(it) } -> "Ready"
                    else -> "Argent"
                }
            return LedgerGroup("$name accounts", shown.sortedBy { it.candidate.request.accountIndex }, mixed)
        }
    }
}

/**
 * `readLedgerAccountState`: whether [address] is deployed, and whether it holds any of
 * [network]'s known tokens. Each half is null when its read failed; never throws.
 */
suspend fun RpcClient.ledgerActivity(
    address: String,
    network: NetworkInfo,
): LedgerActivity {
    val deployed =
        when (deploymentState(address, network)) {
            DeploymentState.DEPLOYED -> true
            DeploymentState.UNDEPLOYED -> false
            DeploymentState.UNKNOWN -> null
        }
    val funded =
        runCatching { balances(address, network) }.getOrNull()?.values?.any {
            it.any { digit ->
                digit != '0'
            }
        }
    return LedgerActivity(deployed, funded)
}
