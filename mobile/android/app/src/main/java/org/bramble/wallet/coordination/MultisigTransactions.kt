package org.bramble.wallet.coordination

import org.bramble.core.CoreException
import org.bramble.core.MultisigIntent
import org.bramble.core.MultisigProposalRequest
import org.bramble.core.MultisigRecord
import org.bramble.core.MultisigTxFailure
import org.bramble.core.MultisigTxStep
import org.bramble.core.NetworkInfo
import org.bramble.core.StepReply
import org.bramble.core.TokenPreferences
import org.bramble.core.redactEndpoints
import org.bramble.wallet.RpcPost
import org.bramble.wallet.describe
import org.bramble.wallet.errors.friendlyError
import org.bramble.wallet.send.RpcEndpoint

// Multisig transactions (M18, mobile/docs/multisig-transactions.md), port of the iOS
// `CoordinationStore+Transactions.swift`: propose, co-sign, submit and import around wallet-core's
// `multisig_tx_ops`. The core builds and reviews every call, signs inside itself by vault record,
// and judges every reply; this only moves bytes and keeps no key. Every chain read is fresh, so the
// core's stale-intent and resend guards see the chain as it is.

/**
 * The signing intents stored for [multisigId], newest first; empty when the core refuses.
 *
 * TODO(M18): a submitted intent settles only once its activity row does, and that row is read by
 * `refresh_activity` for the multisig id: wallet-core #115, after v0.7.0. Until the pin moves past
 * it, a submitted intent stays "Submitted to Starknet" here.
 */
suspend fun CoordinationStore.intents(multisigId: String): List<MultisigIntent> =
    runCatching { work { core.multisigIntents(multisigId) } }.getOrDefault(emptyList())

/**
 * Freezes and stores [request] from [record] (`prepareIntent`) after a fresh authority read, over
 * the person's tracked [tokens]. [confirmResend] is the person's "Send anyway" after
 * `RESEND_UNCONFIRMED`. Throws the core's refusal, or [MultisigTxException] with how the plan ended.
 */
suspend fun CoordinationStore.propose(
    request: MultisigProposalRequest,
    record: MultisigRecord,
    tokens: TokenPreferences,
    confirmResend: Boolean = false,
): MultisigIntent {
    val info = network()
    val read = readAuthority(record.address, info, chainPost)
    val proposal = work { core.proposeMultisigTransaction(read, request, tokens, confirmResend) }
    val step = runPlan(info, txPost) { proposal.advance(it) }
    val intent = proposal.intent()
    if (step !is MultisigTxStep.Proposed || intent == null) throw MultisigTxException(step)
    refresh()
    return intent
}

/** Co-signs [intent] with the vault record [accountId]; the core signs the frozen hash. */
suspend fun CoordinationStore.sign(
    intent: MultisigIntent,
    accountId: String,
): MultisigIntent {
    val read = intentRead(intent.id)
    val signed = work { core.signMultisigIntent(intent.id, accountId, read) }
    refresh()
    return signed
}

/** Sends a ready (or fee-stale) intent's threshold signature exactly once; returns the hash. */
suspend fun CoordinationStore.submit(intent: MultisigIntent): String {
    val info = network()
    val read = intentRead(intent.id)
    val submission = work { core.submitMultisigIntent(intent.id, read) }
    val step = runPlan(info, txPost) { submission.advance(it) }
    refresh()
    return (step as? MultisigTxStep.Submitted)?.hash ?: throw MultisigTxException(step)
}

/**
 * Imports a co-signer's [pkg] for [record] against a fresh read of it. The core drops the
 * package's own summary and lifecycle and reviews the calls itself.
 */
suspend fun CoordinationStore.importIntent(
    pkg: String,
    record: MultisigRecord,
    tokens: TokenPreferences,
): MultisigIntent {
    val info = network()
    val read = readState(info, chainPost) { org.bramble.core.MultisigStateRead(info.network, record.address) }
    val imported = work { core.importMultisigIntent(pkg.trim(), read, tokens) }
    refresh()
    return imported
}

/** The read a sign or submit takes, made by the core for that intent, over each endpoint. */
private suspend fun CoordinationStore.intentRead(id: String) =
    readState(network(), chainPost) { core.multisigIntentRead(id, System.currentTimeMillis().toULong()) }

/** How a multisig plan ended when it did not reach its goal; the message is the extension's. */
class MultisigTxException(
    step: MultisigTxStep,
) : Exception(
        (step as? MultisigTxStep.Failed)?.failure?.let(MultisigTxText::failure) ?: MultisigTxText.FAILURE_DEFAULT,
    ) {
    /** The plan's failure, or null when it ended some other way. */
    val failure: MultisigTxFailure? = (step as? MultisigTxStep.Failed)?.failure
}

/**
 * Relays one multisig plan's steps over one bound endpoint ([RpcEndpoint]: the endpoint that
 * proves the chain serves the whole plan; a write is posted exactly once, never redirected).
 */
internal suspend fun runPlan(
    info: NetworkInfo,
    transport: RpcPost,
    advance: (StepReply) -> MultisigTxStep,
): MultisigTxStep {
    val endpoint = RpcEndpoint(info, transport)
    var reply: StepReply = StepReply.Start
    while (true) {
        val step = work { advance(reply) }
        if (step !is MultisigTxStep.Rpc) return step
        reply = endpoint.exchange(step.id, step.body, step.purpose, step.isWrite)
    }
}

/**
 * A multisig step's refusal as the screen shows it, twin of the iOS `describeRefusal`: the core's
 * refusal ([CoreException.InvalidInput]) read through the extension's friendly copy
 * ([friendlyError]), as the side panel's multisig screens show it, then redacted like every
 * failure text; any other error as [describe] words it.
 */
fun describeRefusal(error: Throwable): String =
    (error as? CoreException.InvalidInput)?.let { redactEndpoints(friendlyError(it.reason)) } ?: describe(error)
