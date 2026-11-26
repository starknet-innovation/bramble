package org.bramble.wallet.send

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.bramble.core.AccountRecord
import org.bramble.core.NetworkInfo
import org.bramble.core.RpcPurpose
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.SendStep
import org.bramble.core.StepReply
import org.bramble.core.TransferPlan
import org.bramble.core.rpcChainIdRequest
import org.bramble.core.rpcVerifyChainId
import org.bramble.wallet.RpcClient
import org.bramble.wallet.RpcPost
import org.bramble.wallet.ledger.DeviceSigning
import org.bramble.wallet.ledger.LedgerSigner
import java.net.URL

/**
 * Relays one core `TransferPlan` over HTTPS, mirroring the iOS `SendDriver`. The plan decides
 * every step; this only picks the endpoint, sleeps for `Wait`, and hands replies back.
 *
 * Host guarantees (mobile/docs/transactions.md §3, "Endpoint binding"): the first endpoint that
 * proves the chain serves every later step of the plan, with no failover; a write is posted
 * exactly once, never retried, and never follows a redirect.
 * HTTP goes through [RpcClient.post], the app's one bounded, redirect-refusing-for-writes path.
 *
 * A Ledger account's plan asks for its device (`Device`, `DeviceRetry`): each APDU goes through
 * the signer and, after a refusal, the person tries again or cancels; a cancel closes the plan.
 * The device link closes whenever [run] returns.
 */
class SendDriver(
    /** The core plan this relays; closed by the owner (`SendFlowModel`), never here. */
    val plan: TransferPlan,
    network: NetworkInfo,
    /** How each step's bytes move: [RpcClient.https] unless a test passes a fixture node. */
    transport: RpcPost = RpcClient.https,
    /**
     * The record the caller built [plan] for, shown on the Ledger sheet as the signer; null shows
     * none. Never pass any other record.
     */
    private val account: AccountRecord? = null,
    /** The Ledger a device step goes to; null is the app's ([LedgerSigner.shared]). */
    private val signer: DeviceSigning? = null,
) {
    private val bound = RpcEndpoint(network, transport)

    /**
     * Advances from [reply] until the plan needs the user: Review, Broadcast, Finished, Failed.
     * Device steps are answered on the Ledger; a cancel there is Failed as `SIGNING_FAILED`, the
     * plan closed.
     */
    suspend fun run(
        reply: StepReply,
        onStep: (SendStep) -> Unit = {},
    ): SendStep {
        var used: DeviceSigning? = null
        try {
            return relay(reply, onStep) { used = it }
        } finally {
            used?.finish()
        }
    }

    private suspend fun relay(
        reply: StepReply,
        onStep: (SendStep) -> Unit,
        using: (DeviceSigning) -> Unit,
    ): SendStep {
        var next = reply
        while (true) {
            val step = withContext(Dispatchers.Default) { plan.advance(next) }
            next =
                when (step) {
                    is SendStep.Rpc -> {
                        onStep(step)
                        bound.exchange(step.id, step.body, step.purpose, step.isWrite)
                    }

                    is SendStep.Wait -> {
                        delay(step.delayMs.toLong())
                        StepReply.WaitElapsed
                    }

                    is SendStep.Device, is SendStep.DeviceRetry -> {
                        device(step, using) ?: return cancelled()
                    }

                    else -> {
                        return step
                    }
                }
        }
    }

    /** The Ledger's answer to a device step; null when the person cancelled. */
    private suspend fun device(
        step: SendStep,
        using: (DeviceSigning) -> Unit,
    ): StepReply? {
        val ledger = (signer ?: LedgerSigner.shared)?.also(using)
        return when (step) {
            is SendStep.Device -> ledger?.exchange(step.apdu, account)
            is SendStep.DeviceRetry -> StepReply.RetryDevice.takeIf { ledger?.refused(step.reason, account) == true }
            else -> null
        }
    }

    /** The person cancelled on the device sheet: the plan closes with nothing signed. */
    private fun cancelled(): SendStep {
        plan.cancel()
        return SendStep.Failed(SendFailure(SendFailureCode.SIGNING_FAILED, null, null))
    }

    /** Lets a review retry probe the endpoints again; refused once a write has been sent. */
    fun releaseEndpoint() = bound.release()
}

/**
 * One plan's endpoint binding, shared by every sans-IO plan the core hands out ([SendDriver],
 * the multisig plans): the first `ChainId` step binds the first endpoint that proves the chain,
 * every later step goes to that endpoint with no failover, and a write is posted exactly once,
 * never retried, never redirected.
 */
class RpcEndpoint(
    network: NetworkInfo,
    private val transport: RpcPost,
) {
    private val urls = network.rpcUrls.map(::URL)
    private val networkId = network.network

    /** The endpoint bound for the rest of the plan once it proved the chain, or null before. */
    var endpoint: URL? = null
        private set

    /** How many signed writes were posted; once non-zero the endpoint is never released. */
    var writesSent = 0
        private set

    /** Lets a retry probe the endpoints again; refused once a write has been sent. */
    fun release() {
        if (writesSent == 0) endpoint = null
    }

    private fun now(): ULong = System.currentTimeMillis().toULong()

    /** Sends one step and returns the reply the plan reads; every failure is a `TransportFailure`. */
    suspend fun exchange(
        id: ULong,
        body: String,
        purpose: RpcPurpose,
        write: Boolean,
    ): StepReply =
        withContext(Dispatchers.IO) {
            if (endpoint == null && purpose == RpcPurpose.CHAIN_ID && !write) {
                bind(id, body)
            } else {
                if (endpoint == null && !write) probe()
                endpoint?.let { url -> relay(url, id, body, write) } ?: StepReply.TransportFailure(id, now())
            }
        }

    /** Posts one step to the bound [url]; a [write] is counted before it is posted, and posted once. */
    private fun relay(
        url: URL,
        id: ULong,
        body: String,
        write: Boolean,
    ): StepReply {
        if (write) writesSent += 1
        return runCatching { transport.post(url, body, write) }
            .map { StepReply.Rpc(id, it, now()) as StepReply }
            .getOrElse { StepReply.TransportFailure(id, now()) }
    }

    private fun probe() {
        endpoint =
            urls.firstOrNull { url ->
                runCatching {
                    rpcVerifyChainId(
                        transport.post(url, rpcChainIdRequest(0u), false),
                        0u,
                        networkId,
                    )
                }.getOrDefault(false)
            }
    }

    private fun bind(
        id: ULong,
        body: String,
    ): StepReply {
        var mismatch: String? = null
        for (url in urls) {
            val text = runCatching { transport.post(url, body, false) }.getOrNull() ?: continue
            if (runCatching { rpcVerifyChainId(text, id, networkId) }.getOrDefault(false)) {
                endpoint = url
                return StepReply.Rpc(id, text, now())
            }
            if (mismatch == null) mismatch = text
        }
        return mismatch?.let { StepReply.Rpc(id, it, now()) } ?: StepReply.TransportFailure(id, now())
    }
}
