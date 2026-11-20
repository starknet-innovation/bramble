package org.bramble.wallet.portfolio

import org.bramble.core.DiscoveryOutcome
import org.bramble.core.TokenBalance
import org.bramble.core.TokenMetaOutcome
import org.bramble.core.balanceRequests
import org.bramble.core.discoveryJudge
import org.bramble.core.tokenAddAddress
import org.bramble.core.tokenMetadataJudge
import org.bramble.core.tokenMetadataRequests
import org.bramble.core.tokenNetworkError

// Token management (`token-ops.ts`), port of iOS `PortfolioStore+Tokens.swift`: show/hide, add by
// contract (metadata read on chain before anything is saved), and find held registry tokens. The
// core builds every request, judges every reply and owns the error copy; a result that lands after
// a lock or a scope change is dropped.

private const val ADD_FAILED = "Add token failed"
private const val SCAN_FAILED = "Token scan failed, try again"

/** Writes the token preferences with the other documents and recomputes Home. */
private fun PortfolioStore.tokensChanged() {
    persistDocuments(directory, preferences, priceBook, balanceSnapshots)
    preferencesRevision += 1
    recompute()
}

/** `setTokenHidden`; false when the core refuses the id (the caller shows "Token update failed"). */
fun PortfolioStore.setHidden(
    tokenId: String,
    hidden: Boolean,
): Boolean =
    runCatching { preferences.setHidden(tokenId, hidden) }
        .onSuccess { tokensChanged() }
        .isSuccess

/** `wallet.addToken`: null on success, else the message to show. */
suspend fun PortfolioStore.addToken(input: String): String? {
    val current = scope
    val address = tokenAddAddress(input)
    val gen = readGeneration
    val outcome =
        when {
            current == null -> TokenMetaOutcome.Failed(ADD_FAILED)
            address == null -> TokenMetaOutcome.Failed("invalid add token request")
            else -> readMetadata(current, address)
        }
    return when {
        gen != readGeneration -> ADD_FAILED
        outcome is TokenMetaOutcome.Token -> track(outcome)
        outcome is TokenMetaOutcome.Failed -> outcome.message
        else -> tokenNetworkError()
    }
}

/** The token's metadata from the first endpoint that proves its chain and answers; null when none does. */
private suspend fun PortfolioStore.readMetadata(
    current: PortfolioStore.Scope,
    address: String,
): TokenMetaOutcome? {
    val reads = reads
    return reads.firstAnswer(current.network) { url ->
        runCatching { tokenMetadataRequests(1u, address) }
            .map { tokenMetadataJudge(current.network.network, address, 1u, reads.sendAll(it, url)) }
            .getOrDefault(TokenMetaOutcome.Failed(ADD_FAILED))
            .takeUnless { it is TokenMetaOutcome.Transport }
    }
}

/** Saves a read token, then reloads balances so it shows; null on success, else the failure copy. */
private suspend fun PortfolioStore.track(read: TokenMetaOutcome.Token): String? {
    if (runCatching { preferences.add(read.token) }.isFailure) return ADD_FAILED
    tokensChanged()
    refresh(force = true)
    return null
}

/**
 * `wallet.detectTokens`: held registry tokens not yet tracked, or the failure copy. Nothing is
 * added until the user adds a result. A scan that outlived a lock or a scope change finds nothing.
 */
suspend fun PortfolioStore.discoverTokens(): Result<List<TokenBalance>> {
    val current = scope ?: return Result.failure(DiscoveryFailure(SCAN_FAILED))
    val candidates = preferences.discoveryCandidates(current.network.network)
    val gen = readGeneration
    val reads = reads
    val outcome =
        if (candidates.isEmpty()) {
            DiscoveryOutcome.Found(emptyList())
        } else {
            reads.firstAnswer(current.network) { url ->
                runCatching { balanceRequests(1u, current.address, candidates) }
                    .getOrNull()
                    ?.let { discoveryJudge(1u, candidates, reads.sendAll(it, url)) }
                    ?.takeUnless { it is DiscoveryOutcome.Transport }
            }
        }
    return when {
        gen != readGeneration -> Result.success(emptyList())
        outcome is DiscoveryOutcome.Found -> Result.success(outcome.tokens)
        outcome is DiscoveryOutcome.Failed -> Result.failure(DiscoveryFailure(outcome.message))
        else -> Result.failure(DiscoveryFailure(tokenNetworkError()))
    }
}

/** A discovery failure; [message] is the user-facing line. */
class DiscoveryFailure(
    override val message: String,
) : Exception(message)
