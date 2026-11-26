import BrambleCore
import Foundation
import Observation

/// Where every admitted dapp request lands (P16), and the only code that calls wallet-core's
/// `DappSession`, so nothing outside this class names its shapes: the browser sees reply JSON and
/// `Card`s.
///
/// The core answers connect, typed-data signing and the passive reads around them. A connect or a
/// signature is held as a card until the person approves it, denies it, or it expires; the core
/// reviews, signs and re-checks everything at approval, so nothing here judges or signs. The
/// phishing feed is refreshed when the sink starts and on the browser's timer, as the core asks of
/// a host.
@MainActor
@Observable
final class DappRequestSink {
    /// A request waiting for the person, with its site's warnings as copy: a connection, or a
    /// signature when `sign` is set.
    struct Card: Identifiable, Equatable {
        let id: String
        let origin: String
        /// A blocked site's card can only be denied.
        let blocked: Bool
        let warnings: [String]
        let sign: SignRequest?
    }

    /// What a typed-data card asks to sign, as the core reviewed it. `document` is the exact JSON
    /// the core hashes (it refuses any value the hash would not cover), indented for reading.
    struct SignRequest: Equatable {
        /// The account the core reviewed it for and signs with; approval echoes it back.
        let accountId: String
        let address: String
        /// `"<primaryType> · <domain.name>"`.
        let summary: String
        let document: String
        /// A SNIP-9 outside execution's calls, empty for any other document.
        let calls: [String]
        /// The review's flags in the extension's words.
        let risks: [String]
        /// A SNIP-9 outside execution: its signature lets the site submit the calls later.
        let outsideExecution: Bool
        /// It pays or approves a lookalike of a trusted address: it can only be denied.
        let poisoned: Bool
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
    /// site's card, that site's next card-raising request is refused without a card for this long,
    /// so a page cannot put a card straight back.
    static let surfaceCooldownMs = 1_000.0
    /// The methods that raise a card in this slice: connect and typed-data signing.
    private static let cardMethods: Set<String> = [
        "wallet_requestAccounts", "mc_requestAccounts", "wallet_signTypedData"
    ]

    /// The cards waiting, oldest first.
    private(set) var cards: [Card] = []
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
        tokens: TokenPreferences = TokenPreferences(persisted: nil),
        http: PortfolioTransport = BoundedHttp.shared,
        now: @escaping () -> Double = { Date().timeIntervalSince1970 * DappRequestSink.millisecondsPerSecond }
    ) {
        session = DappSession(wallet: core, tokens: tokens)
        self.http = http
        self.now = now
    }

    /// Answers `request`; `shown` is the network the browser shows, which answers a locked chain-id
    /// read only. A held request settles later through `approve`, `deny` or `settleExpired`.
    func answer(_ request: DappRequest, shown: NetworkId) -> Answer {
        if Self.cardMethods.contains(request.method), let denied = deniedAt[request.origin],
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

    /// The person approved connection `card`, sharing `accountId`, which must be the active account.
    func approve(_ card: Card, accountId: String) -> [Settled] {
        finish(session.approveConnect(approvalId: card.id, reviewedAccountId: accountId, nowMs: now()))
    }

    /// The person approved signing `card` with the account it was reviewed for.
    func sign(_ card: Card) -> [Settled] {
        guard let sign = card.sign else { return [] }
        let settled = session.approveSignTypedData(approvalId: card.id, reviewedAccountId: sign.accountId, nowMs: now())
        return finish(settled)
    }

    /// Whether the blocklist refuses `origin`, so the browser can stop a listed page before it loads.
    func isBlockedSite(_ origin: String) -> Bool {
        session.isBlockedSite(origin: origin)
    }

    /// The person declined `card`.
    func deny(_ card: Card) -> [Settled] {
        deniedAt[card.origin] = now()
        return finish(session.deny(approvalId: card.id, nowMs: now()))
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

    /// The page that asked is gone (a new commit, or the screen closed): its requests are withdrawn,
    /// and a card no request waits on any more goes with them, so a stale card can never be approved.
    func pageGone() {
        session.withdraw(requestIds: Array(heldCards.keys))
        heldCards = [:]
        pageIds = [:]
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
            Card(
                id: approval.approvalId,
                origin: approval.origin,
                blocked: approval.blocked,
                warnings: approval.warnings.map(Self.copy),
                sign: Self.signRequest(approval.card)
            )
        }
    }

    private static func signRequest(_ card: DappCard) -> SignRequest? {
        guard case let .signTypedData(accountId, address, _, summary, json, calls, flags) = card else { return nil }
        return SignRequest(
            accountId: accountId,
            address: address,
            summary: summary,
            document: indented(json),
            calls: calls,
            risks: flags.map(\.message),
            outsideExecution: isOutsideExecution(summary: summary),
            poisoned: flags.contains { $0.code == .addressPoisoning }
        )
    }

    /// Whether a card's summary (`"<primaryType> · <domain.name>"`, or the primary type alone) names
    /// an `OutsideExecution`, the extension's `signRequestWarnings` test. The primary type is ASCII
    /// (the core's name grammar), so the first segment is exactly it.
    static func isOutsideExecution(summary: String) -> Bool {
        summary == "OutsideExecution" || summary.hasPrefix("OutsideExecution · ")
    }

    /// `json` re-indented one value per line: it is never parsed, so no number or key order can
    /// change between what is shown and what is signed. String contents are copied verbatim; only
    /// whitespace outside strings moves. It walks Unicode scalars, not `Character`s: a combining
    /// mark after a quote would otherwise fuse with it and desync the string tracking.
    static func indented(_ json: String) -> String {
        var out = String.UnicodeScalarView(), depth = 0, inString = false, escaped = false
        func newline() { out.append(contentsOf: ("\n" + String(repeating: "  ", count: depth)).unicodeScalars) }
        for char in json.unicodeScalars {
            if inString {
                out.append(char)
                if escaped {
                    escaped = false
                } else if char == "\\" {
                    escaped = true
                } else if char == "\"" {
                    inString = false
                }
                continue
            }
            switch char {
            case "\"":
                inString = true
                out.append(char)

            case "{", "[":
                depth += 1
                out.append(char)
                newline()

            case "}", "]":
                depth -= 1
                newline()
                out.append(char)

            case ",":
                out.append(char)
                newline()

            case ":":
                out.append(contentsOf: ": ".unicodeScalars)

            case " ", "\n", "\r", "\t":
                break

            default:
                out.append(char)
            }
        }
        return String(out)
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
