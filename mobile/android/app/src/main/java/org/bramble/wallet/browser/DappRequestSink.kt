package org.bramble.wallet.browser

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.bramble.core.CoreException
import org.bramble.core.DappCard
import org.bramble.core.DappReply
import org.bramble.core.DappSession
import org.bramble.core.DappSettled
import org.bramble.core.DappSignStep
import org.bramble.core.NetworkId
import org.bramble.core.RiskFlagCode
import org.bramble.core.RpcPurpose
import org.bramble.core.SiteWarning
import org.bramble.core.StepReply
import org.bramble.core.TokenPreferences
import org.bramble.core.WalletCore
import org.bramble.wallet.RpcClient
import org.bramble.wallet.RpcPost
import org.bramble.wallet.endpointNetwork
import org.bramble.wallet.ledger.DeviceSigning
import org.bramble.wallet.ledger.LedgerSigner
import org.bramble.wallet.portfolio.BoundedHttp
import org.bramble.wallet.portfolio.PortfolioTransport
import org.bramble.wallet.send.RpcEndpoint
import org.json.JSONObject

/**
 * Where every admitted dapp request lands (P16), and the only code that calls wallet-core's
 * `DappSession`, as iOS `DappRequestSink`, so nothing outside this class names its shapes: the
 * browser sees reply JSON and [Card]s.
 *
 * The core answers connect, typed-data signing and the passive reads around them. A connect or a
 * signature is held as a card until the person approves it, denies it, or it expires; the core
 * reviews, signs and re-checks everything at approval, so nothing here judges or signs. Every
 * other card (switch network, watch asset, a call batch) has no screen yet and is declined at once,
 * and a request that needs a chain read first ([DappReply.Read]) is refused. Main thread only.
 */
class DappRequestSink(
    private val core: WalletCore,
    tokens: TokenPreferences = TokenPreferences(null),
    private val rpc: RpcPost = RpcClient.https,
    /** The Ledger a Ledger account signs on; null is the app's Bluetooth one ([LedgerSigner.shared]). */
    private val signer: DeviceSigning? = null,
    private val http: PortfolioTransport = BoundedHttp,
    private val now: () -> Double = { System.currentTimeMillis().toDouble() },
) {
    /**
     * A request waiting for the person: its [id], the [origin] asking, whether it is [blocked]
     * (then it can only be denied), its site [warnings] as copy, and [sign] for a signature (null
     * for a connection).
     */
    data class Card(
        val id: String,
        val origin: String,
        val blocked: Boolean,
        val warnings: List<String>,
        val sign: SignRequest? = null,
    )

    /**
     * What a typed-data card asks to sign, as the core reviewed it: the [accountId] it signs with
     * (approval echoes it back) and its [address], the [summary] (`"<primaryType> · <domain.name>"`),
     * the [document] the core hashes (it refuses any value the hash would not cover) indented for
     * reading, an outside execution's [calls], the review's [risks] in the extension's words,
     * whether it pays or approves a lookalike ([poisoned]: it can only be denied), and whether it
     * is a SNIP-9 [outsideExecution], whose signature lets the site submit the calls later.
     */
    data class SignRequest(
        val accountId: String,
        val address: String,
        val summary: String,
        val document: String,
        val calls: List<String>,
        val risks: List<String>,
        val poisoned: Boolean,
        val outsideExecution: Boolean,
    )

    /** What the page gets for a request: a reply now, or a card to wait on. */
    sealed interface Answer {
        /** The reply [json] to post now. */
        data class Now(
            val json: String,
        ) : Answer

        /** Held under [requestId] until the card is decided or expires. */
        data class Held(
            val requestId: ULong,
        ) : Answer
    }

    /** A held request's reply [json], by the [requestId] [answer] gave it. */
    data class Settled(
        val requestId: ULong,
        val json: String,
    )

    private val session = DappSession(core, tokens)
    private val pageIds = mutableMapOf<ULong, String>()

    /** The card each held request waits on, by request number. */
    private val heldCards = mutableMapOf<ULong, String>()

    /** When the person last cancelled each site's card. */
    private val deniedAt = mutableMapOf<String, Double>()
    private var lastRequestId: ULong = 0u

    /**
     * The card being signed: the core no longer lists it, but it stays first (and its sheet up,
     * under the Ledger's) until the signature settles, and a second Sign does nothing.
     */
    private var signing: Card? = null

    /** The device the card being signed is on, once it asked for one. */
    private var ledger: DeviceSigning? = null

    /** The cards waiting, oldest first. */
    var cards by mutableStateOf(emptyList<Card>())
        private set

    /**
     * Answers [request]; [shown] is the network the browser shows, which answers a locked chain-id
     * read only. A held request settles later through [approve], [deny] or [settleExpired].
     */
    fun answer(
        request: DappRequest,
        shown: NetworkId,
    ): Answer {
        val cooling = deniedAt[request.origin]?.let { now() - it < SURFACE_COOLDOWN_MS } == true
        if (cooling && request.method in CARD_METHODS) {
            return Answer.Now(errorJson(request.id, USER_REFUSED, USER_REFUSED_MESSAGE, null))
        }
        lastRequestId += 1u
        val requestId = lastRequestId
        val reply =
            try {
                session.request(request.origin, request.method, request.params, shown, requestId)
            } catch (ignored: CoreException) {
                null
            }
        return when (reply) {
            null -> {
                Answer.Now(errorJson(request.id, UNKNOWN_ERROR, UNKNOWN_ERROR_MESSAGE, null))
            }

            is DappReply.Pending -> {
                declineUnshown(session, now(), request.id, requestId, reply.approvalId) ?: run {
                    pageIds[requestId] = request.id
                    heldCards[requestId] = reply.approvalId
                    reload()
                    Answer.Held(requestId)
                }
            }

            is DappReply.Read -> {
                // wallet_deploymentData and wallet_watchAsset read the chain first; neither is
                // answered on mobile yet, so the read is dropped and the page refused.
                session.withdraw(listOf(requestId))
                Answer.Now(errorJson(request.id, UNKNOWN_ERROR, UNKNOWN_ERROR_MESSAGE, null))
            }

            is DappReply.Result, is DappReply.Error -> {
                Answer.Now(json(request.id, reply))
            }
        }
    }

    /** The person approved connection [card], sharing [accountId], which must be the active account. */
    fun approve(
        card: Card,
        accountId: String,
    ): List<Settled> = finish(session.approveConnect(card.id, accountId, now()))

    /**
     * The person approved signing [card] with the account it was reviewed for. A Ready or Braavos
     * account's live state is read first, each read posted to one endpoint that proved the card's
     * chain (a failed post is passed on empty, which the core refuses); the core then signs or
     * refuses. A Ledger account signs on its device through the same sheet a send uses, with the
     * account the card was reviewed for as the signer; the person's cancel there refuses the page.
     * Every APDU comes from the core and goes back to it unread.
     */
    suspend fun sign(card: Card): List<Settled> {
        val sign = card.sign?.takeIf { signing == null } ?: return emptyList()
        signing = card
        val account = runCatching { core.allAccountRecords() }.getOrNull()?.firstOrNull { it.id == sign.accountId }
        var endpoint: RpcEndpoint? = null
        // The signer is chosen once, at the first device step, and kept for the whole signature.
        val device = {
            ledger ?: (signer ?: checkNotNull(LedgerSigner.shared) { "no Ledger signer" }).also { ledger = it }
        }
        var step = session.approveSignTypedData(card.id, sign.accountId, now())
        while (true) {
            step =
                when (step) {
                    is DappSignStep.Read -> {
                        val bound = endpoint ?: RpcEndpoint(endpointNetwork(step.network, core), rpc)
                        endpoint = bound
                        // No purpose comes with the read, so the endpoint proves the chain with its own probe.
                        val reply = bound.exchange(step.id, step.body, RpcPurpose.ACCOUNT_SIGNER, false)
                        session.answerSignRead(card.id, step.id, (reply as? StepReply.Rpc)?.body.orEmpty())
                    }

                    is DappSignStep.Device -> {
                        session.answerDevice(card.id, device().exchange(step.apdu, account))
                    }

                    is DappSignStep.DeviceRetry -> {
                        if (device().refused(step.reason, account)) {
                            session.retrySignDevice(card.id)
                        } else {
                            session.cancelSignDevice(card.id)
                        }
                    }

                    is DappSignStep.Settled -> {
                        ledger?.finish()
                        ledger = null
                        signing = null
                        return finish(step.settled)
                    }
                }
        }
    }

    /** Whether the blocklist refuses [origin], so the browser can stop a listed page before it loads. */
    fun isBlockedSite(origin: String): Boolean = session.isBlockedSite(origin)

    /** The person declined [card]. */
    fun deny(card: Card): List<Settled> {
        deniedAt[card.origin] = now()
        return finish(session.deny(card.id, now()))
    }

    /** Requests whose cards expired, answered as declined. Call it on a timer. */
    fun settleExpired(): List<Settled> = finish(session.settleExpired())

    /** Loads the cached phishing list and fetches a fresh one when it is due. */
    suspend fun refreshPhishingFeed() {
        val request = session.refreshPhishingFeed(now()) ?: return
        session.answerPhishingFeed(http.perform(request), now())
        reload()
    }

    /**
     * The page that asked is gone (a new page, or the screen closed): its requests are withdrawn, and
     * a card no request waits on any more goes with them, so a stale card can never be approved.
     */
    fun pageGone() {
        session.withdraw(heldCards.keys.toList())
        // A signature in progress is dropped by the core; its Ledger sheet closes with the page.
        signing = null
        ledger?.finish()
        heldCards.clear()
        pageIds.clear()
        reload()
    }

    private fun finish(settled: List<DappSettled>): List<Settled> {
        reload()
        settled.forEach { heldCards.remove(it.requestId) }
        return settled.mapNotNull { item ->
            pageIds.remove(item.requestId)?.let { Settled(item.requestId, json(it, item.reply)) }
        }
    }

    private fun reload() {
        val held = signing
        cards = listOfNotNull(held) +
            session.pendingApprovals(now()).filter { hasScreen(it.card) && it.approvalId != held?.id }.map {
                Card(it.approvalId, it.origin, it.blocked, it.warnings.map(::warningCopy), signRequest(it.card))
            }
    }

    /** Wallet API error codes and the page's reply shapes. */
    companion object {
        private const val UNKNOWN_ERROR = 163L
        private const val UNKNOWN_ERROR_MESSAGE = "The wallet request failed"
        private const val USER_REFUSED = 113L
        private const val USER_REFUSED_MESSAGE = "The user refused the operation"

        /**
         * The extension's `SURFACE_COOLDOWN_MS` (`approval-surface.ts`): after the person cancels a
         * site's card, that site's next card-raising request is refused without a card for this
         * long, so a page cannot put a card straight back.
         */
        const val SURFACE_COOLDOWN_MS = 1_000.0

        /** The methods that raise a card in this slice: connect and typed-data signing. */
        private val CARD_METHODS = setOf("wallet_requestAccounts", "mc_requestAccounts", "wallet_signTypedData")

        /**
         * Declines [approvalId] at once when it is a card this app has no screen for (anything but a
         * connection or a signature), answering the page with the deny's reply; null for a card it shows.
         */
        private fun declineUnshown(
            session: DappSession,
            nowMs: Double,
            pageId: String,
            requestId: ULong,
            approvalId: String,
        ): Answer? {
            val card = session.pendingApprovals(nowMs).firstOrNull { it.approvalId == approvalId }?.card
            if (card != null && hasScreen(card)) return null
            val reply = session.deny(approvalId, nowMs).firstOrNull { it.requestId == requestId }?.reply
            val refused = errorJson(pageId, USER_REFUSED, USER_REFUSED_MESSAGE, null)
            return Answer.Now(reply?.let { json(pageId, it) } ?: refused)
        }

        /** A site warning in the extension's words (`insight-messages.ts`). */
        fun warningCopy(warning: SiteWarning): String =
            when (warning) {
                SiteWarning.Unparseable -> DappCopy.siteInsightUnparseable
                SiteWarning.Blocklisted -> DappCopy.siteInsightBlocklisted
                SiteWarning.Punycode -> DappCopy.siteInsightPunycode
                is SiteWarning.Lookalike -> DappCopy.siteInsightLookalike.replace("{target}", warning.target)
                is SiteWarning.RiskyTld -> DappCopy.siteInsightRiskyTld.replace("{tld}", warning.tld)
                SiteWarning.ConnectedBefore -> DappCopy.siteInsightConnectedBefore
                SiteWarning.FirstSeen -> DappCopy.siteInsightFirstSeen
                SiteWarning.NewSite -> DappCopy.siteInsightNewSite
            }

        /** The page's `{ id, result | error }`; [id] is a validated UUID and a result the core's JSON. */
        private fun json(
            id: String,
            reply: DappReply,
        ): String =
            when (reply) {
                is DappReply.Result -> """{"id":"$id","result":${reply.json}}"""
                is DappReply.Error -> errorJson(id, reply.code, reply.message, reply.data)
                is DappReply.Pending, is DappReply.Read -> errorJson(id, UNKNOWN_ERROR, UNKNOWN_ERROR_MESSAGE, null)
            }

        private fun errorJson(
            id: String,
            code: Long,
            message: String,
            data: String?,
        ): String {
            val error = JSONObject().put("code", code).put("message", message)
            if (data != null) error.put("data", data)
            return """{"error":$error,"id":"$id"}"""
        }
    }
}

/**
 * The device's [reply] to [approvalId]'s last APDU; null (the person cancelled on the sheet, or the
 * wallet locked) cancels, which refuses the page.
 */
private fun DappSession.answerDevice(
    approvalId: String,
    reply: StepReply?,
): DappSignStep =
    when (reply) {
        is StepReply.Device -> answerSignDevice(approvalId, reply.reply)
        is StepReply.DeviceFailure -> signDeviceTransportFailure(approvalId, reply.failure)
        else -> cancelSignDevice(approvalId)
    }

/** Whether [card] is a kind this app shows: a connection or a signature. */
private fun hasScreen(card: DappCard): Boolean =
    when (card) {
        DappCard.Connect, is DappCard.SignTypedData -> true
        is DappCard.SwitchChain, is DappCard.WatchAsset, is DappCard.Invoke -> false
    }

// ponytail: the card's decoded `domain`/`message` rows are not shown; the sheet shows the exact
// document. Rendering them is a sign-sheet redesign, not part of the v0.11.0 bump.

/** A typed-data card's request, or null for a connection. */
private fun signRequest(card: DappCard): DappRequestSink.SignRequest? =
    (card as? DappCard.SignTypedData)?.let {
        DappRequestSink.SignRequest(
            accountId = it.accountId,
            address = it.address,
            summary = it.summary,
            document = indentedJson(it.typedDataJson),
            calls = it.callSummaries,
            risks = it.flags.map { flag -> flag.message },
            poisoned = it.flags.any { flag -> flag.code == RiskFlagCode.ADDRESS_POISONING },
            outsideExecution = it.outsideExecution,
        )
    }

/**
 * [json] re-indented one value per line: it is never parsed, so no number or key order can change
 * between what is shown and what is signed (as iOS `indented`). String contents are copied verbatim;
 * only whitespace outside strings moves.
 */
internal fun indentedJson(json: String): String = JsonIndenter().apply { json.forEach(::take) }.text

/** [indentedJson]'s walk: string text is copied as is; outside it, only structure moves. */
private class JsonIndenter {
    private val out = StringBuilder()
    private var depth = 0
    private var inString = false
    private var escaped = false

    val text: String get() = out.toString()

    fun take(char: Char) = if (inString) inside(char) else outside(char)

    private fun inside(char: Char) {
        out.append(char)
        when {
            escaped -> escaped = false
            char == '\\' -> escaped = true
            char == '"' -> inString = false
        }
    }

    private fun outside(char: Char) {
        when (char) {
            '"' -> {
                inString = true
                out.append(char)
            }

            '{', '[' -> {
                depth += 1
                out.append(char)
                newline()
            }

            '}', ']' -> {
                depth -= 1
                newline()
                out.append(char)
            }

            ',' -> {
                out.append(char)
                newline()
            }

            ':' -> {
                out.append(": ")
            }

            else -> {
                if (!char.isWhitespace()) out.append(char)
            }
        }
    }

    private fun newline() {
        out.append('\n').append("  ".repeat(depth))
    }
}
