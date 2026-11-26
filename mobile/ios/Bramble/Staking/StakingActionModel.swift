import BrambleCore
import Foundation
import Observation

/// One staking action (`staking-ui.ts` over `wallet.stakingPrepare` / `wallet.stakingExecute`):
/// the host names the action, validator, token and amount, never a call. The core reads the pool
/// at one pinned block, builds and reviews the calls, and hands back a `TransferPlan` with the
/// sentence to confirm; this model runs that plan through `SendDriver` exactly as Send and Deploy
/// do. The preparation is single use (the core refuses a second plan), the plan is bound to the
/// session (a lock voids it), and Confirm signs only the plan whose review is on screen.
@MainActor
@Observable
final class StakingActionModel: Identifiable {
    enum Stage: Equatable {
        /// The pinned read, the plan and its fee estimate.
        case preparing
        /// The core's sentence and fee are on screen; Confirm signs this plan.
        case review
        /// The core refused before anything was signed; `message` is its sentence.
        case refused
        case submitting
        /// The node accepted the transaction; Activity follows it from here.
        case submitted
        /// Signing or submission failed, or its outcome is unknown; `message` says which.
        case failed
    }

    let id = UUID()
    let action: StakingAction
    let symbol: String
    private(set) var stage: Stage = .preparing
    /// The core's review sentence (`StakingPlan.review`), shown verbatim.
    private(set) var sentence: String?
    private(set) var review: TransferReview?
    /// Each risk flag's message from the core's batch review, then the first-send deployment note.
    private(set) var risks: [String] = []
    private(set) var message: String?
    private(set) var hash: String?
    private(set) var explorerURL: URL?

    private let start: () throws -> StakingPreparation
    private let network: NetworkInfo
    private let endpoints: PortfolioEndpoints
    private let transport: RpcTransport
    private let feeBalance: String?
    private let clock: @Sendable () -> UInt64
    private let track: (TransferPlan) -> Void
    private var driver: SendDriver?

    /// `prepare` is the core's `prepareStaking` for this action; the store's `makeStakingAction` fills it.
    init(
        action: StakingAction,
        symbol: String,
        network: NetworkInfo,
        endpoints: PortfolioEndpoints,
        transport: RpcTransport,
        feeBalance: String?,
        clock: @escaping @Sendable () -> UInt64,
        track: @escaping (TransferPlan) -> Void = { _ in /* Nothing tracks the plan. */ },
        prepare: @escaping () throws -> StakingPreparation
    ) {
        self.action = action
        self.symbol = symbol
        self.network = network
        self.endpoints = endpoints
        self.transport = transport
        self.feeBalance = feeBalance
        self.clock = clock
        self.track = track
        start = prepare
    }

    /// The fee line under the sentence, as the extension's `review.staking.review`; the sentence
    /// alone while there is no figure.
    var reviewLine: String? {
        guard let sentence else { return nil }
        guard let fee = review?.fee else { return sentence }
        return StakingText.fill(StakingCopy.reviewReview, ["review": sentence, "fee": fee.display])
    }

    /// "Confirm · 0.01 STRK"; plain Confirm text is never offered without a figure.
    var confirmLabel: String? {
        review?.fee.map { StakingText.fill(StakingCopy.reviewConfirm, ["fee": $0.display]) }
    }

    /// Prepares the action and runs its plan to the review.
    func prepare() async {
        close()
        stage = .preparing
        do {
            let preparation = try start()
            await endpoints.drive(preparation, on: network)
            await endpoints.drive(StakingCheck(preparation), on: StakingCheck.bundled(network))
            let staking = try preparation.plan(nowSeconds: clock(), feeBalance: feeBalance)
            track(staking.plan)
            sentence = staking.review
            let started = SendDriver(plan: staking.plan, network: network, transport: transport)
            driver = started
            show(try await started.run(from: .start))
        } catch let error as StakingError {
            message = StakingText.message(error, context: StakingCopy.reviewFailed)
            stage = .refused
        } catch {
            fail(driver?.plan.interruptedFailure() ?? SendFailure(code: .locked, hash: nil))
        }
    }

    /// The Cost box's Retry after a failed estimate.
    func retryFee() async {
        guard let driver, stage == .review else { return }
        await driver.releaseEndpoint()
        stage = .preparing
        do {
            show(try await driver.run(from: .retryEstimate))
        } catch {
            fail(driver.plan.interruptedFailure() ?? SendFailure(code: .locked, hash: nil))
        }
    }

    /// Confirms the plan on screen: the core re-reads, re-checks the reviewed fee, and signs.
    func confirm() async {
        guard let driver, stage == .review, review?.canConfirm == true else { return }
        stage = .submitting
        do {
            switch try await driver.run(from: .confirm) {
            case let .broadcast(hash):
                self.hash = hash
                explorerURL = explorerTransactionUrl(network: network.network, hash: hash).flatMap(URL.init(string:))
                stage = .submitted

            case let .failed(failure):
                fail(failure)

            default:
                fail(SendFailure(code: .nodeError, hash: nil))
            }
        } catch {
            // Closed after the signed write was handed out: the core says so, with its hash.
            fail(driver.plan.interruptedFailure() ?? SendFailure(code: .locked, hash: nil))
        }
    }

    /// Dismissal or lock. A submitted transaction keeps its pending Activity record, which the
    /// wallet's observation settles; closing never loses it.
    func close() {
        driver?.plan.cancel()
        driver = nil
    }

    private func show(_ step: SendStep) {
        guard case .review = step, let plan = driver?.plan, let current = plan.currentReview() else {
            if case let .failed(failure) = step {
                fail(failure)
            } else {
                fail(SendFailure(code: .nodeError, hash: nil))
            }
            return
        }
        review = current
        risks = plan.riskFlags().map(\.message) + (current.requiresDeployment ? [SendCopy.deployNote] : [])
        stage = .review
    }

    private func fail(_ failure: SendFailure) {
        message = SendFailureText.message(failure)
        if SendFailureText.mayHaveReachedChain(failure.code) { hash = failure.hash ?? hash }
        close()
        stage = .failed
    }
}
