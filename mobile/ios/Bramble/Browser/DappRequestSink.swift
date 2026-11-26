import BrambleCore
import Foundation
import Observation

/// Where every admitted dapp request lands (P16), and the only code that calls wallet-core's
/// `DappSession`. Its shapes are still moving (a generic deny, a card kind, typed-data approval),
/// so nothing outside this class names them: the browser sees reply JSON and `ConnectCard`s.
///
/// wallet-core #158 and #161 change it: `DappSession(wallet:tokenPreferences:)`, `deny(id, nowMs)` in
/// place of `denyConnect`, a `card` (Connect | SignTypedData) on `DappApproval`, and
/// `approveSignTypedData`. Only this class and its `DappApproval` → `ConnectCard` mapping move then.
///
/// The core answers connect and the passive reads around it, and refuses every other method until
/// its review lands; nothing here signs. A connect is held as a card until the person approves it
/// with an account, denies it, or it expires. The phishing feed is refreshed when the sink starts
/// and on the browser's timer, as the core asks of a host.
@MainActor
@Observable
final class DappRequestSink {
    /// A connection request waiting for the person, with its site's warnings as copy.
    struct ConnectCard: Identifiable, Equatable {
        let id: String
        let origin: String
        /// A blocked site's card can only be denied.
        let blocked: Bool
        let warnings: [String]
    }

    /// What the page gets for a request: a reply now, or a card to wait on.
    enum Answer: Equatable {
        case now(String)
        case held(UInt64)
    }

    /// A held request's reply, by the number `answer` gave it.
    struct Settled: Equatable {
        let requestId: UInt64
        let json: String
    }

    private static let unknownError = (code: 163, message: "The wallet request failed")
    private static let millisecondsPerSecond = 1_000.0
    private static let userRefused = (code: 113, message: "The user refused the operation")
    /// The extension's `SURFACE_COOLDOWN_MS` (`approval-surface.ts`): after the person cancels a
    /// site's card, that site's next connect is refused without a card for this long, so a page
    /// cannot put the card straight back.
    static let surfaceCooldownMs = 1_000.0
    /// The connect methods, the only ones that raise a card in this slice.
    private static let connectMethods: Set<String> = ["wallet_requestAccounts", "mc_requestAccounts"]

    /// The connection cards waiting, oldest first.
    private(set) var cards: [ConnectCard] = []
    @ObservationIgnored private let session: DappSession
    @ObservationIgnored private let http: PortfolioTransport
    @ObservationIgnored private let now: () -> Double
    @ObservationIgnored private var pageIds: [UInt64: String] = [:]
    /// The card each held request waits on, by request number.
    @ObservationIgnored private var heldCards: [UInt64: String] = [:]
    @ObservationIgnored private var lastRequestId: UInt64 = 0
    /// When the person last cancelled each site's card.
    @ObservationIgnored private var deniedAt: [String: Double] = [:]

    init(
        core: WalletCore,
        http: PortfolioTransport = BoundedHttp.shared,
        now: @escaping () -> Double = { Date().timeIntervalSince1970 * DappRequestSink.millisecondsPerSecond }
    ) {
        session = DappSession(wallet: core)
        self.http = http
        self.now = now
    }

    /// Answers `request`; `shown` is the network the browser shows, which answers a locked chain-id
    /// read only. A held request settles later through `approve`, `deny` or `settleExpired`.
    func answer(_ request: DappRequest, shown: NetworkId) -> Answer {
        if Self.connectMethods.contains(request.method), let denied = deniedAt[request.origin],
           now() - denied < Self.surfaceCooldownMs {
            return .now(Self.json(id: request.id, error: Self.userRefused))
        }
        lastRequestId += 1
        let requestId = lastRequestId
        let reply: DappReply
        do {
            reply = try session.request(
                origin: request.origin,
                method: request.method,
                params: request.params,
                shown: shown,
                requestId: requestId
            )
        } catch {
            return .now(Self.json(id: request.id, error: Self.unknownError))
        }
        if case let .pending(approvalId) = reply {
            pageIds[requestId] = request.id
            heldCards[requestId] = approvalId
            reload()
            return .held(requestId)
        }
        return .now(Self.json(id: request.id, reply: reply))
    }

    /// The person approved `card`, sharing `accountId`, which must be the active account.
    func approve(_ card: ConnectCard, accountId: String) -> [Settled] {
        finish(session.approveConnect(approvalId: card.id, reviewedAccountId: accountId, nowMs: now()))
    }

    /// The person declined `card`.
    func deny(_ card: ConnectCard) -> [Settled] {
        deniedAt[card.origin] = now()
        return finish(session.denyConnect(approvalId: card.id, nowMs: now()))
    }

    /// Requests whose cards expired, answered as declined. Call it on a timer.
    func settleExpired() -> [Settled] {
        finish(session.settleExpired())
    }

    /// Loads the cached phishing list and fetches a fresh one when it is due.
    func refreshPhishingFeed() async {
        guard let request = session.refreshPhishingFeed(nowMs: now()) else { return }
        let outcome = await http.perform(request)
        session.answerPhishingFeed(outcome: outcome, nowMs: now())
        reload()
    }

    /// The page that asked is gone (a new commit, or the screen closed): each card its requests
    /// wait on is denied, so a stale card can never be approved. Its waiters are gone with the
    /// page, so the refusal reaches no one.
    func pageGone() {
        let stale = Set(heldCards.values)
        heldCards = [:]
        pageIds = [:]
        for approvalId in stale { _ = session.denyConnect(approvalId: approvalId, nowMs: now()) }
        reload()
    }

    private func finish(_ settled: [DappSettled]) -> [Settled] {
        reload()
        return settled.compactMap { item in
            heldCards[item.requestId] = nil
            guard let id = pageIds.removeValue(forKey: item.requestId) else { return nil }
            return Settled(requestId: item.requestId, json: Self.json(id: id, reply: item.reply))
        }
    }

    private func reload() {
        cards = session.pendingApprovals(nowMs: now()).map { approval in
            ConnectCard(
                id: approval.approvalId,
                origin: approval.origin,
                blocked: approval.blocked,
                warnings: approval.warnings.map(Self.copy)
            )
        }
    }

    /// A site warning in the extension's words (`insight-messages.ts`).
    static func copy(_ warning: SiteWarning) -> String {
        switch warning {
        case .unparseable:
            DappCopy.siteInsightUnparseable

        case .blocklisted:
            DappCopy.siteInsightBlocklisted

        case .punycode:
            DappCopy.siteInsightPunycode

        case let .lookalike(target):
            DappCopy.siteInsightLookalike.replacingOccurrences(of: "{target}", with: target)

        case let .riskyTld(tld):
            DappCopy.siteInsightRiskyTld.replacingOccurrences(of: "{tld}", with: tld)

        case .connectedBefore:
            DappCopy.siteInsightConnectedBefore

        case .firstSeen:
            DappCopy.siteInsightFirstSeen

        case .newSite:
            DappCopy.siteInsightNewSite
        }
    }

    /// The page's `{ id, result | error }`. `id` is a validated UUID and `result` the core's JSON,
    /// so both go in as they are.
    static func json(id: String, reply: DappReply) -> String {
        switch reply {
        case let .result(json):
            #"{"id":"\#(id)","result":\#(json)}"#

        case let .error(code, message, data):
            json(id: id, error: (Int(code), message), data: data)

        case .pending:
            json(id: id, error: unknownError)
        }
    }

    private static func json(id: String, error: (code: Int, message: String), data: String? = nil) -> String {
        var object: [String: Any] = ["code": error.code, "message": error.message]
        if let data { object["data"] = data }
        let encoded = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return #"{"error":\#(String(decoding: encoded, as: UTF8.self)),"id":"\#(id)"}"#
    }
}
