package org.bramble.wallet.send

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.StarkNameAnswer
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcVerifyChainId
import org.bramble.core.starkNameAddressRequest
import org.bramble.core.starkNameJudgeAddress
import org.bramble.core.starkNameNormalize
import org.bramble.core.validateRecipient
import org.bramble.wallet.RpcPost
import java.net.URL

// Starknet ID name → address on Send's recipient step, as iOS `StarkNameLookup.swift`: the
// extension's `resolveStarkName` (`packages/platform/starknet/src/rpc/stark-name.ts`) over the
// core's sans-IO body and judge. Each endpoint proves the network's chain first and is never asked
// about a name otherwise; `TryNextEndpoint` and transport failures move on; a node's own answer
// stops. With no endpoint left the lookup fails closed: no address is ever taken from it.

/** A resolved address, or the line the recipient step shows instead (`resolutionFailure`). */
sealed interface StarkNameOutcome {
    /**
     * The naming contract's nonzero answer.
     *
     * @property address the address the name resolved to, as the core judged it.
     */
    data class Resolved(
        val address: String,
    ) : StarkNameOutcome

    /**
     * Nothing was committed.
     *
     * @property line why, in the extension's words.
     */
    data class Refused(
        val line: String,
    ) : StarkNameOutcome
}

/**
 * The core calls a lookup makes. Production uses the core's own; the JVM suite, which has no
 * native core, passes stand-ins to check the endpoint order and failover around them.
 */
internal data class StarkNameCalls(
    val chainRequest: (ULong) -> String = ::rpcChainIdRequest,
    val verifyChain: (String, ULong, NetworkId) -> Boolean = ::rpcVerifyChainId,
    val request: (ULong, NetworkId, String) -> String = ::starkNameAddressRequest,
    val judge: (String, ULong) -> StarkNameAnswer = ::starkNameJudgeAddress,
)

/** The note while the read runs. */
fun starkNameResolving(name: String): String = "Resolving $name…"

private fun couldNotResolve(name: String) = "Could not resolve $name."

private const val UNSUPPORTED = "Starknet names are not available on this network."
private const val CHAIN_REQUEST_ID: ULong = 1u
private const val NAME_REQUEST_ID: ULong = 2u

/** Resolves [name] (already `starkNameNormalize`d) on [network], endpoints in order. Blocking. */
internal fun resolveStarkName(
    name: String,
    network: NetworkInfo,
    post: RpcPost,
    calls: StarkNameCalls = StarkNameCalls(),
): StarkNameOutcome {
    val body = runCatching { calls.request(NAME_REQUEST_ID, network.network, name) }.getOrNull()
    // An endpoint on another chain is failed over like a fault; if none matches, the lookup fails
    // as an error rather than reading as an unreachable network, as the extension's does.
    var sawOtherChain = false
    val answered =
        body?.let { request ->
            network.rpcUrls.firstNotNullOfOrNull { url ->
                when (provesChain(URL(url), network.network, post, calls)) {
                    true -> asked(URL(url), request, name, post, calls)
                    false -> null.also { sawOtherChain = true }
                    null -> null
                }
            }
        }
    return answered ?: StarkNameOutcome.Refused(
        if (body == null || sawOtherChain) couldNotResolve(name) else "Could not reach the network to resolve $name.",
    )
}

/** Whether [url] proves [network]'s chain; null when it could not be read at all. */
private fun provesChain(
    url: URL,
    network: NetworkId,
    post: RpcPost,
    calls: StarkNameCalls,
): Boolean? =
    runCatching {
        calls.verifyChain(post.post(url, calls.chainRequest(CHAIN_REQUEST_ID), false), CHAIN_REQUEST_ID, network)
    }.getOrNull()

/** [url]'s answer to the name call; null (move on) for a transport failure or `TryNextEndpoint`. */
private fun asked(
    url: URL,
    request: String,
    name: String,
    post: RpcPost,
    calls: StarkNameCalls,
): StarkNameOutcome? =
    runCatching { post.post(url, request, false) }
        .getOrNull()
        ?.let { reply -> judged(calls.judge(reply, NAME_REQUEST_ID), name) }

/** One endpoint's answer as an outcome; null moves on to the next endpoint. */
private fun judged(
    answer: StarkNameAnswer,
    name: String,
): StarkNameOutcome? =
    when (answer) {
        is StarkNameAnswer.Resolved -> StarkNameOutcome.Resolved(answer.address)
        StarkNameAnswer.NotFound -> StarkNameOutcome.Refused("No address found for $name.")
        StarkNameAnswer.UnsupportedNetwork -> StarkNameOutcome.Refused(UNSUPPORTED)
        StarkNameAnswer.Failed -> StarkNameOutcome.Refused(couldNotResolve(name))
        StarkNameAnswer.TryNextEndpoint -> null
    }

/**
 * "Continue with address" (`commitTyped`): an address goes on as before ([continueWithRecipient]);
 * other text that names a listed row is taken as that row (more than one match commits nothing),
 * so a name is never resolved over a row the screen shows; a Starknet name is resolved; anything
 * else is refused as before. [networkNow] is the wallet's network when the answer lands.
 */
suspend fun SendFlowModel.continueWithTyped(
    book: RecipientBook,
    networkNow: () -> NetworkId,
) {
    val listed = book.named(recipientInput)
    val name = starkNameNormalize(recipientInput)
    when {
        validateRecipient(recipientInput) != null -> continueWithRecipient(book::labelFor)
        listed.size == 1 -> useRecipient(listed[0].address, listed[0].label)
        listed.isNotEmpty() -> Unit
        name == null -> continueWithRecipient(book::labelFor)
        !resolvingName -> resolveName(name, book, networkNow)
    }
}

/**
 * Resolves [name] and, if the field still spells it and the wallet is still on this network when
 * the answer lands, takes the address under the canonical name (`choose(…, "stark-name")`).
 */
private suspend fun SendFlowModel.resolveName(
    name: String,
    book: RecipientBook,
    networkNow: () -> NetworkId,
) {
    val typed = recipientInput.trim()
    resolvingName = true
    recipientNote = starkNameResolving(name)
    val outcome =
        try {
            withContext(Dispatchers.IO) { resolveStarkName(name, network, transport) }
        } finally {
            resolvingName = false
        }
    // Edited since, or read for a network the wallet has left: dropped.
    val current = recipientInput.trim() == typed && networkNow() == network.network
    val address = (outcome as? StarkNameOutcome.Resolved)?.let { validateRecipient(it.address) }
    if (!current) return
    when {
        address != null -> {
            recipientNote = null
            takeResolvedName(address, name, isNew = book.labelFor(address) == null)
        }

        outcome is StarkNameOutcome.Refused -> {
            recipientNote = outcome.line
        }

        // The core resolves only a nonzero felt; anything the address rules still refuse is a
        // failed lookup, never a silent stop on "Resolving…".
        else -> {
            recipientNote = couldNotResolve(name)
        }
    }
}
