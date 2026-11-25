import BrambleCore
import Foundation
import Observation

/// The Swap journey on the UI side (`swap-ui.ts`): a pair, an amount, the quote, then the review
/// and the submission. Every decision is the core's `TokenSwap` (the quote and build requests,
/// their judgement, the pinned router, the reviewed floor) and then its `TransferPlan` (fee,
/// signing, broadcast), run by the same `SendDriver` as a send. This type only moves bytes the
/// core described over the app's one bounded HTTP path and tracks which face to show.
///
/// One `TokenSwap` is one quote: any edit, a refused step, or Back from the review drops it, and
/// the next quote is a new one (`generation` drops a reply that lands after its edit).
@MainActor
@Observable
final class SwapFlowModel {
    enum Stage: Equatable {
        /// The pair, the amount and the quote.
        case edit
        /// Review swap was pressed: the build is fetched, judged and planned to its fee.
        case preparing
        case review
        case submitting
        /// Broadcast; `confirmed` follows the chain.
        case submitted
        case failed
    }

    /// One side of the pair.
    enum Side { case sell, buy }

    private(set) var stage: Stage = .edit
    /// The tracked tokens on the account's network, in the portfolio's order.
    let tokens: [TokenConfig]
    private(set) var sell: TokenConfig?
    private(set) var buy: TokenConfig?
    var amount = "" { didSet { if amount != oldValue { invalidate() } } }
    private(set) var quote: SwapQuoteView?
    private(set) var quoting = false
    /// Why the last quote or build was refused (the core's sentence, through the friendly copy), or
    /// why a review fell back.
    private(set) var note: String?
    private(set) var swapReview: SwapReview?
    private(set) var review: TransferReview?
    private(set) var confirmed = false
    private(set) var hash: String?
    private(set) var explorerURL: URL?
    private(set) var failureMessage: String?

    let network: NetworkInfo
    private let core: WalletCore
    private let accountId: String
    private let preferences: TokenPreferences
    /// Base units per tracked token id, from the portfolio's loaded balances.
    private let balances: [String: String]
    /// The wallet's own price feed for the quote's value check; nil leaves the price unverified.
    private let prices: PriceView?
    private let http: any PortfolioTransport
    private let rpc: RpcTransport
    private let track: (TransferPlan) -> Void
    private var swap: TokenSwap?
    private var driver: SendDriver?
    private var generation = 0

    init(
        core: WalletCore,
        network: NetworkInfo,
        accountId: String,
        preferences: TokenPreferences,
        balances: [String: String],
        prices: PriceView?,
        http: any PortfolioTransport,
        rpc: RpcTransport,
        openingToken: String? = nil,
        track: @escaping (TransferPlan) -> Void = { _ in /* Nothing tracks the plan. */ }
    ) {
        self.core = core
        self.network = network
        self.accountId = accountId
        self.preferences = preferences
        self.balances = balances
        self.prices = prices
        self.http = http
        self.rpc = rpc
        self.track = track
        tokens = preferences.tracked(network: network.network).map(\.token)
        let pair = Self.pair(opening: openingToken, in: tokens)
        sell = pair.sell
        buy = pair.buy
    }

    /// The pair the journey opens on (`swapPresetPair`, `healSelection`): the chosen token, else
    /// ETH, else the first; bought against STRK, else the first other token.
    nonisolated static func pair(
        opening: String?,
        in tokens: [TokenConfig]
    ) -> (sell: TokenConfig?, buy: TokenConfig?) {
        let sold = tokens.first { $0.id == opening } ?? tokens.first { $0.symbol == "ETH" } ?? tokens.first
        let others = tokens.filter { $0.id != sold?.id }
        return (sold, others.first { $0.symbol == "STRK" } ?? others.first)
    }

    // MARK: Edit

    /// What a quote is keyed on: the view re-quotes (debounced) whenever it changes.
    var quoteKey: String { "\(sell?.id ?? "")|\(buy?.id ?? "")|\(amount)" }

    /// A token picked for one side; picking the other side's token swaps the pair.
    func choose(_ token: TokenConfig, for side: Side) {
        switch side {
        case .sell:
            if token.id == buy?.id { buy = sell }
            sell = token

        case .buy:
            if token.id == sell?.id { sell = buy }
            buy = token
        }
        invalidate()
    }

    /// Swaps the sides; a quoted buy amount becomes the amount sold, as the extension's flip.
    func flip() {
        let bought = quote?.buyAmount
        (sell, buy) = (buy, sell)
        if let bought { amount = bought }
        invalidate()
    }

    /// The selling token's base-unit balance, nil while unread.
    var rawBalance: String? { sell.flatMap { balances[$0.id] } }

    /// Max: the whole balance, exactly; does nothing while it is unread.
    func fillMax() {
        guard let sell, let raw = rawBalance,
              let text = try? formatTokenAmount(raw: raw, decimals: sell.decimals, maxFraction: sell.decimals) else {
            return
        }
        amount = text
    }

    /// The amount is more than the balance (unknown balances never block, as the extension).
    var insufficient: Bool {
        guard let sell, let raw = rawBalance, !amount.isEmpty,
              let wanted = try? parseTokenAmount(amount: amount, decimals: sell.decimals) else { return false }
        return Self.decimalGreater(wanted, raw)
    }

    /// The quote's loss in percent (0 for a gain or no figure), by `swapValueDeltaPercent`.
    var lossPercent: Double { quote.flatMap(Self.valueDelta).map { max(0, -$0) } ?? 0 }

    /// `swapValueDeltaPercent`: the worse of the wallet's feed delta and the aggregator's own.
    nonisolated static func valueDelta(_ quote: SwapQuoteView) -> Double? {
        let percent: Double = 100
        let aggregator = quote.sellAmountInUsd > 0
            ? (quote.buyAmountInUsd - quote.sellAmountInUsd) / quote.sellAmountInUsd * percent
            : nil
        guard let feed = quote.valueDeltaPercent else { return aggregator }
        return aggregator.map { min(feed, $0) } ?? feed
    }

    /// Review swap's label (`paintSwapMeta`): the shortfall, "Swap anyway" at a high loss, or Review.
    var reviewLabel: String {
        if insufficient, let sell {
            return SwapCopy.insufficientToken.replacingOccurrences(of: "{symbol}", with: sell.symbol)
        }
        if quote != nil, lossPercent >= SwapCopy.lossHighRiskPercent {
            return SwapCopy.swapAnyway.replacingOccurrences(of: "{percent}", with: String(format: "%.1f", lossPercent))
        }
        return SwapCopy.review
    }

    var canReview: Bool { stage == .edit && quote != nil && !insufficient }

    /// Asks for a fresh quote of the pair and amount on screen. A reply that lands after an edit
    /// is dropped; a refusal ends that quote and shows the core's sentence through the friendly copy.
    func requestQuote() async {
        // A late debounce must not drop the quote a build is already using.
        guard stage == .edit else { return }
        invalidate()
        let mine = generation
        let typed = amount.trimmingCharacters(in: .whitespaces)
        guard !typed.isEmpty, let sell, let buy else { return }
        quoting = true
        defer { if mine == generation { quoting = false } }
        do {
            let started = try core.prepareSwap(
                accountId: accountId,
                sellTokenId: sell.id,
                buyTokenId: buy.id,
                amount: typed,
                tokens: preferences
            )
            let outcome = await http.perform(started.quoteRequest())
            guard mine == generation else { return }
            quote = try started.acceptQuote(outcome: outcome, prices: prices)
            swap = started
        } catch {
            if mine == generation { note = Self.reason(error) }
        }
    }

    // MARK: Review and submit

    /// Builds the quoted swap, judges the build, and runs its plan to the review.
    func reviewSwap() async {
        guard canReview, let swap else { return }
        let mine = generation
        stage = .preparing
        do {
            let request = try swap.buildRequest(slippage: nil)
            let outcome = await http.perform(request)
            guard mine == generation, stage == .preparing else { return }
            let judged = try swap.acceptBuild(outcome: outcome)
            let plan = try swap.plan(feeBalance: feeBalance)
            self.swap = nil
            track(plan)
            let started = SendDriver(plan: plan, network: network, transport: rpc)
            driver = started
            if showReview(try await started.run(from: .start), from: started) { swapReview = judged }
        } catch {
            if mine == generation { backToEdit(Self.reason(error)) }
        }
    }

    /// The account's STRK, which the plan checks the fee against.
    private var feeBalance: String? {
        tokens.first { $0.symbol == "STRK" }.flatMap { balances[$0.id] }
    }

    /// The review's warnings: the core's risk flags for the batch, then the plan's own (a first
    /// transaction also deploys the account).
    var risks: [String] {
        (swapReview?.flags.map(\.message) ?? []) + (review.map { SendReviewCopy.risks($0) } ?? [])
    }

    /// Re-probes the endpoints and asks the plan for a new fee estimate.
    func retryFee() async {
        guard let driver, stage == .review else { return }
        await driver.releaseEndpoint()
        stage = .preparing
        do {
            showReview(try await driver.run(from: .retryEstimate), from: driver)
        } catch {
            if self.driver === driver { backToEdit(Self.reason(error)) }
        }
    }

    /// Shows `started`'s review after `step`, or goes back to the edit face with the core's reason
    /// for a refused step. False, painting nothing, when the user left that plan meanwhile.
    @discardableResult
    private func showReview(_ step: SendStep, from started: SendDriver) -> Bool {
        guard driver === started else { return false }
        guard case .review = step, let current = started.plan.currentReview() else {
            var failure = Self.nodeError
            if case let .failed(reported) = step { failure = reported }
            backToEdit(SendFailureText.message(failure))
            return false
        }
        review = current
        stage = .review
        return true
    }

    /// Confirms the reviewed plan; the core re-checks, signs and posts it once.
    func confirm() async {
        guard stage == .review, let driver, review?.canConfirm == true else { return }
        stage = .submitting
        let plan = driver.plan
        do {
            switch try await driver.run(from: .confirm) {
            case let .broadcast(hash):
                self.hash = hash
                explorerURL = explorerTransactionUrl(network: network.network, hash: hash).flatMap(URL.init(string:))
                stage = .submitted
                settle(try await driver.run(from: .proceed))

            case let .failed(failure):
                fail(failure)

            default:
                fail(SendFailure(code: .nodeError, hash: nil))
            }
        } catch {
            // Closed after the signed write may have left: the core says so, with its hash.
            if stage == .submitting { fail(plan.interruptedFailure() ?? SendFailure(code: .locked, hash: nil)) }
        }
    }

    /// Back: from the review (or a failure) to a fresh quote of the same amount; true when the
    /// journey should leave instead. Ignored while the swap is submitting.
    func back() -> Bool {
        switch stage {
        case .edit:
            return true

        case .submitting:
            return false

        case .submitted:
            return true

        case .preparing, .review, .failed:
            backToEdit(nil)
            return false
        }
    }

    /// Dismissal or lock. The core keeps the pending record of any write that already left.
    func close() {
        invalidate()
        driver?.plan.cancel()
        driver = nil
    }

    // MARK: Private

    private func invalidate() {
        generation += 1
        quote = nil
        swap = nil
        note = nil
        quoting = false
    }

    private func backToEdit(_ reason: String?) {
        close()
        swapReview = nil
        review = nil
        stage = .edit
        note = reason
    }

    private func settle(_ step: SendStep) {
        guard case let .finished(status, _, _) = step else { return }
        switch status {
        case .accepted, .preconfirmed:
            confirmed = true

        case .pending:
            break

        case .rejected:
            failureMessage = SendCopy.rejectedMessage
            stage = .failed

        case .reverted:
            failureMessage = SendCopy.revertedMessage
            stage = .failed
        }
    }

    private func fail(_ failure: SendFailure) {
        failureMessage = SendFailureText.message(failure)
        if SendFailureText.mayHaveReachedChain(failure.code) { hash = failure.hash ?? hash }
        driver = nil
        stage = .failed
    }

    nonisolated static let nodeError = SendFailure(code: .nodeError, hash: nil)

    /// What a refused step shows: the core's sentence (`SwapError`'s, for the variants that carry
    /// none) read through the extension's friendly copy (`FriendlyError`), as the side panel's
    /// `errorLine`; the lock's own line for a lock.
    nonisolated static func reason(_ error: Error) -> String {
        switch error {
        case let SwapError.Refused(reason):
            FriendlyError.message(reason)

        case SwapError.Locked:
            SendFailureText.message(SendFailure(code: .locked, hash: nil))

        case SwapError.NotFound:
            FriendlyError.message("swap preparation not found")

        case SwapError.UnknownAccount:
            FriendlyError.message("unknown account")

        case SwapError.Storage:
            FriendlyError.message("a wallet file could not be read")

        default:
            SwapCopy.swapFailed
        }
    }

    /// `a > b` for base-10 integer strings.
    nonisolated static func decimalGreater(_ left: String, _ right: String) -> Bool {
        let lhs = String(left.drop { $0 == "0" })
        let rhs = String(right.drop { $0 == "0" })
        return lhs.count == rhs.count ? lhs > rhs : lhs.count > rhs.count
    }
}
