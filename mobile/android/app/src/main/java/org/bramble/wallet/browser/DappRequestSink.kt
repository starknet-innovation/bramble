package org.bramble.wallet.browser

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.bramble.core.CoreException
import org.bramble.core.DappReply
import org.bramble.core.DappSession
import org.bramble.core.DappSettled
import org.bramble.core.NetworkId
import org.bramble.core.SiteWarning
import org.bramble.core.WalletCore
import org.bramble.wallet.portfolio.BoundedHttp
import org.bramble.wallet.portfolio.PortfolioTransport
import org.json.JSONObject

/**
 * Where every admitted dapp request lands (P16), and the only code that calls wallet-core's
 * `DappSession`, as iOS `DappRequestSink`. Its shapes are still moving (a generic deny, a card
 * kind, typed-data approval), so nothing outside this class names them: the browser sees reply
 * JSON and [ConnectCard]s.
 *
 * wallet-core #158 and #161 change it: `DappSession(wallet, tokenPreferences)`, `deny(id, nowMs)` in
 * place of `denyConnect`, a `card` (Connect | SignTypedData) on `DappApproval`, and
 * `approveSignTypedData`. Only this class and its `DappApproval` → [ConnectCard] mapping move then.
 *
 * The core answers connect and the passive reads around it, and refuses every other method until
 * its review lands; nothing here signs. A connect is held as a card until the person approves it
 * with an account, denies it, or it expires. Main thread only.
 */
class DappRequestSink(
    core: WalletCore,
    private val http: PortfolioTransport = BoundedHttp,
    private val now: () -> Double = { System.currentTimeMillis().toDouble() },
) {
    /**
     * A connection request waiting for the person: its [id], the [origin] asking, whether it is
     * [blocked] (then it can only be denied), and its site [warnings] as copy.
     */
    data class ConnectCard(
        val id: String,
        val origin: String,
        val blocked: Boolean,
        val warnings: List<String>,
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

    private val session = DappSession(core)
    private val pageIds = mutableMapOf<ULong, String>()
    private var lastRequestId: ULong = 0u

    /** The connection cards waiting, oldest first. */
    var cards by mutableStateOf(emptyList<ConnectCard>())
        private set

    /**
     * Answers [request]; [shown] is the network the browser shows, which answers a locked chain-id
     * read only. A held request settles later through [approve], [deny] or [settleExpired].
     */
    fun answer(
        request: DappRequest,
        shown: NetworkId,
    ): Answer {
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
                pageIds[requestId] = request.id
                reload()
                Answer.Held(requestId)
            }

            else -> {
                Answer.Now(json(request.id, reply))
            }
        }
    }

    /** The person approved [card], sharing [accountId], which must be the active account. */
    fun approve(
        card: ConnectCard,
        accountId: String,
    ): List<Settled> = finish(session.approveConnect(card.id, accountId, now()))

    /** The person declined [card]. */
    fun deny(card: ConnectCard): List<Settled> = finish(session.denyConnect(card.id, now()))

    /** Requests whose cards expired, answered as declined. Call it on a timer. */
    fun settleExpired(): List<Settled> = finish(session.settleExpired())

    /** Loads the cached phishing list and fetches a fresh one when it is due. */
    suspend fun refreshPhishingFeed() {
        val request = session.refreshPhishingFeed(now()) ?: return
        session.answerPhishingFeed(http.perform(request), now())
        reload()
    }

    private fun finish(settled: List<DappSettled>): List<Settled> {
        reload()
        return settled.mapNotNull { item ->
            pageIds.remove(item.requestId)?.let { Settled(item.requestId, json(it, item.reply)) }
        }
    }

    private fun reload() {
        cards =
            session.pendingApprovals(now()).map {
                ConnectCard(it.approvalId, it.origin, it.blocked, it.warnings.map(::warningCopy))
            }
    }

    /** Wallet API error codes and the page's reply shapes. */
    companion object {
        private const val UNKNOWN_ERROR = 163L
        private const val UNKNOWN_ERROR_MESSAGE = "The wallet request failed"

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
                is DappReply.Pending -> errorJson(id, UNKNOWN_ERROR, UNKNOWN_ERROR_MESSAGE, null)
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
