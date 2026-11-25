import BrambleCore
import Foundation
import Observation

/// One allowance revoke (`bindAllowances` + `handleRevokeAllowance`): the core resolves the id,
/// reads the chain's `allowance` when the token is not trusted, builds and reviews
/// `approve(spender, 0)`, and runs it through the same plan as a send. Opening the screen reviews
/// it, so Revoke is pressed with the fee in view; one press submits under that review. Every
/// review, risk and refusal sentence shown is the core's, never rewritten here.
@MainActor
@Observable
final class RevokeFlowModel {
    enum Stage: Equatable {
        /// Resolving, reading and reviewing the revoke.
        case preparing
        /// The core's review is on screen; Revoke submits under it.
        case review
        /// The core refused the revoke before any plan existed; `message` is its sentence.
        case refused
        case submitting
        /// Broadcast, not confirmed yet.
        case submitted
        /// The chain accepted (or pre-confirmed) the revoke.
        case confirmed
        case failed
    }

    private(set) var stage: Stage = .preparing
    private(set) var review: TransferReview?
    /// The batch's flags as the card lists them (`TransferPlan.riskFlags`), in the core's words.
    private(set) var risks: [String] = []
    private(set) var message: String?
    private(set) var hash: String?
    private(set) var explorerURL: URL?

    let allowance: AllowanceView
    private let core: WalletCore
    private let network: NetworkInfo
    private let accountId: String
    private let tokens: TokenPreferences
    /// The live STRK balance, read at each prepare so Try again sees a refreshed one.
    private let feeBalance: () -> String?
    private let endpoints: PortfolioEndpoints
    private let transport: RpcTransport
    private let track: (TransferPlan) -> Void
    private var driver: SendDriver?
    /// Bumped when a preparation is abandoned (a new prepare, or a close before submitting), so a
    /// stale prepare or estimate that resumes afterwards changes nothing.
    private var epoch = 0

    init(
        core: WalletCore,
        network: NetworkInfo,
        accountId: String,
        allowance: AllowanceView,
        tokens: TokenPreferences,
        feeBalance: @escaping () -> String?,
        endpoints: PortfolioEndpoints,
        transport: RpcTransport,
        track: @escaping (TransferPlan) -> Void = { _ in /* Nothing tracks the plan. */ }
    ) {
        self.core = core
        self.network = network
        self.accountId = accountId
        self.allowance = allowance
        self.tokens = tokens
        self.feeBalance = feeBalance
        self.endpoints = endpoints
        self.transport = transport
        self.track = track
    }

    /// Prepares and reviews the revoke. Runs when the screen opens, and again after a failure.
    func prepare() async {
        close()
        epoch += 1
        let started = epoch
        review = nil
        risks = []
        message = nil
        hash = nil
        stage = .preparing
        let plan: TransferPlan
        do {
            let revoke = try core.prepareRevoke(accountId: accountId, allowanceId: allowance.id, tokens: tokens)
            // Unanswered, the read stays unfinished and `plan` refuses an untrusted contract.
            _ = await endpoints.drive(revoke, on: network)
            guard started == epoch else { return }
            plan = try revoke.plan(feeBalance: feeBalance())
        } catch let error as RevokeError {
            message = Self.shown(error)
            stage = .refused
            return
        } catch {
            message = Self.shown(.Locked)
            stage = .refused
            return
        }
        track(plan)
        let fresh = SendDriver(plan: plan, network: network, transport: transport)
        driver = fresh
        await settle(plan) { try await fresh.run(from: .start) }
    }

    /// The Cost box's retry: re-estimates on a freshly proven endpoint.
    func retryFee() async {
        guard let driver, stage == .review else { return }
        await driver.releaseEndpoint()
        stage = .preparing
        await settle(driver.plan) { try await driver.run(from: .retryEstimate) }
    }

    /// Revoke: the core re-reads chain state, re-checks the reviewed fee, signs and posts once.
    func confirm() async {
        guard let driver, stage == .review, review?.canConfirm == true else { return }
        stage = .submitting
        await settle(driver.plan) { try await driver.run(from: .confirm) }
    }

    /// Opening (or reopening) the screen: prepares when no review is live, so a screen that
    /// disappeared before submitting never sits on a Revoke that has no plan behind it.
    func open() async {
        guard driver == nil, stage == .preparing else { return }
        await prepare()
    }

    /// Dismissal, lock, or the screen disappearing. Before submitting, the review is withdrawn and
    /// any preparation in flight is abandoned; `open` prepares again. Once submitting, the write
    /// settles as Send's does.
    func close() {
        driver?.plan.cancel()
        driver = nil
        guard stage == .preparing || stage == .review else { return }
        epoch += 1
        review = nil
        risks = []
        stage = .preparing
    }

    /// What the screen shows for a refusal: Send's lock line for a lock (the extension's lookup
    /// would read "wallet is locked" as the generic fallback), else the core's sentence through the
    /// extension's friendly copy.
    nonisolated static func shown(_ error: RevokeError) -> String {
        if case .Locked = error { return SendFailureText.message(SendFailure(code: .locked, hash: nil)) }
        return FriendlyError.message(refusal(error))
    }

    /// The core's sentence for a refusal: `RevokeError`'s `#[error]` text in wallet-core v0.8.0
    /// (`send/revoke.rs`), byte for byte. The bindings carry only `Refused`'s sentence (the batch
    /// review's own); the other variants reach Swift without their text, so it is mirrored here
    /// until the core exports it. The screen shows it through the extension's friendly copy
    /// (`FriendlyError.message`), as the side panel does.
    nonisolated static func refusal(_ error: RevokeError) -> String {
        switch error {
        case let .Refused(reason):
            reason

        case .Locked:
            "wallet is locked"

        case .UnknownAccount:
            "unknown account"

        case .Storage:
            "a wallet file could not be read"

        case .InvalidRequest:
            "invalid revoke request"

        case .OtherAccount:
            "switch to the account that granted this allowance"

        case .NotFound:
            "allowance not found"

        case .Collection:
            "this contract is an NFT collection, not a token; revoke it from the dapp"

        case .UnconfirmedToken:
            "this wallet could not confirm that contract is a token, so it will not send a revoke "
                + "that could approve an NFT instead; revoke it from the dapp"
        }
    }

    private func settle(_ plan: TransferPlan, _ outcome: () async throws -> SendStep) async {
        let started = epoch
        do {
            let step = try await outcome()
            guard started == epoch else { return }
            try await handle(step, plan: plan)
        } catch {
            guard started == epoch else { return }
            // Closed (a lock, dismissal) after the signed write may have left: the core says so.
            fail(plan.interruptedFailure() ?? SendFailure(code: .locked, hash: nil))
        }
    }

    private func handle(_ step: SendStep, plan: TransferPlan) async throws {
        switch step {
        case .review:
            guard let current = plan.currentReview() else {
                fail(SendFailure(code: .nodeError, hash: nil))
                return
            }
            review = current
            // As Send's risks panel: the flags, then that a first transaction also deploys.
            risks = plan.riskFlags().map(\.message) + (current.requiresDeployment ? [SendCopy.deployNote] : [])
            stage = .review

        case let .broadcast(hash):
            self.hash = hash
            explorerURL = explorerTransactionUrl(network: network.network, hash: hash).flatMap(URL.init(string:))
            stage = .submitted
            if let driver { try await handle(try await driver.run(from: .proceed), plan: plan) }

        case let .finished(status, _, _):
            finish(status)

        case let .failed(failure):
            fail(failure)

        case .rpc, .wait:
            break
        }
    }

    /// The chain's answer after the broadcast: pending keeps the submitted receipt; a rejected or
    /// reverted revoke is a failure, never a confirmation.
    private func finish(_ status: TxStatus) {
        switch status {
        case .accepted, .preconfirmed:
            stage = .confirmed

        case .pending:
            break

        case .rejected:
            message = SendCopy.rejectedMessage
            stage = .failed

        case .reverted:
            message = SendCopy.revertedMessage
            stage = .failed
        }
    }

    private func fail(_ failure: SendFailure) {
        message = SendFailureText.message(failure)
        if SendFailureText.mayHaveReachedChain(failure.code) { hash = failure.hash ?? hash }
        driver = nil
        stage = .failed
    }
}
