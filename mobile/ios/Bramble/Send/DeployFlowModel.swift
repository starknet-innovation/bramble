import BrambleCore
import Foundation
import Observation

/// The standalone Deploy account flow (`bindDeploy` in `shell-bindings.ts`): the fee is quoted as
/// soon as the screen opens, so Deploy is a decision made with the number in view; one press then
/// submits under that quote. A quote that cannot be fetched does not strand the screen: Deploy
/// quotes again, and a press that had no figure in hand only shows the new one, so no fee is
/// spent that was never on screen. The receipt says "Deployment submitted" until the chain
/// confirms, then "Account deployed". The core's plan does the work, exactly as for a send.
@MainActor
@Observable
final class DeployFlowModel {
    enum Stage: Equatable {
        /// Quoting the deployment fee (on open, or on a press after a failed quote).
        case estimating
        /// The fee is on screen; Deploy submits under it.
        case quoted
        /// No quote could be had; Deploy quotes again.
        case estimateFailed
        case alreadyDeployed
        case submitting
        /// Broadcast, not confirmed yet.
        case submitted
        /// The chain accepted (or pre-confirmed) the deployment.
        case confirmed
        case failed
    }

    private(set) var stage: Stage = .estimating
    private(set) var fee: FeeAmount?
    private(set) var hash: String?
    private(set) var explorerURL: URL?
    private(set) var failureMessage: String?

    private let core: WalletCore
    private let network: NetworkInfo
    private let accountId: String
    private let transport: RpcTransport
    private let track: (TransferPlan) -> Void
    private var driver: SendDriver?

    init(
        core: WalletCore,
        network: NetworkInfo,
        accountId: String,
        transport: RpcTransport,
        track: @escaping (TransferPlan) -> Void = { _ in /* Nothing tracks the plan. */ }
    ) {
        self.core = core
        self.network = network
        self.accountId = accountId
        self.transport = transport
        self.track = track
    }

    /// The status line under the rows: estimating, submitting, a failed quote, or a failure.
    var status: String? {
        switch stage {
        case .estimating:
            SendCopy.deployEstimating

        case .estimateFailed:
            SendCopy.deployEstimateFailed

        case .submitting:
            SendCopy.deploySubmitting

        case .failed:
            failureMessage

        default:
            nil
        }
    }

    /// The receipt's title and line: submitted until the chain answers, then deployed.
    var receipt: (title: String, message: String?) {
        stage == .confirmed
            ? (SendCopy.deployConfirmedTitle, SendCopy.deployConfirmedBody)
            : (SendCopy.deploySubmittedTitle, nil)
    }

    /// Quotes the deployment fee. Runs when the screen opens, and again on a press without a quote.
    func quote() async {
        close()
        fee = nil
        stage = .estimating
        guard let plan = try? core.prepareDeployment(accountId: accountId) else {
            fail(SendFailure(code: .locked, hash: nil))
            return
        }
        track(plan)
        let started = SendDriver(plan: plan, network: network, transport: transport)
        driver = started
        do {
            let step = try await started.run(from: .start)
            guard case .review = step, let review = plan.currentReview() else {
                stage = .estimateFailed
                return
            }
            if review.alreadyDeployed {
                close()
                stage = .alreadyDeployed
            } else if let deploymentFee = review.deploymentFee, review.canConfirm {
                fee = deploymentFee
                stage = .quoted
            } else {
                stage = .estimateFailed
            }
        } catch {
            fail(SendFailure(code: .locked, hash: nil))
        }
    }

    /// The Deploy button: submits under the quote on screen, or quotes again when there is none.
    func deploy() async {
        switch stage {
        case .quoted:
            await submit()

        case .estimateFailed, .failed:
            await quote()

        default:
            break
        }
    }

    func close() {
        driver?.plan.cancel()
        driver = nil
    }

    private func submit() async {
        guard let driver else { return }
        stage = .submitting
        let plan = driver.plan
        do {
            switch try await driver.run(from: .confirm) {
            case let .broadcast(hash):
                self.hash = hash
                explorerURL = explorerTransactionUrl(network: network.network, hash: hash).flatMap(URL.init(string:))
                stage = .submitted
                // Submitted is not deployed: the receipt firms up only once the chain answers.
                settle(try await driver.run(from: .proceed))

            case let .failed(failure):
                fail(failure)

            default:
                fail(SendFailure(code: .nodeError, hash: nil))
            }
        } catch {
            // Closed after the signed write was handed out: report it with its hash.
            if stage == .submitting { fail(plan.interruptedFailure() ?? SendFailure(code: .locked, hash: nil)) }
        }
    }

    /// The chain's answer after the broadcast. Pending keeps the submitted receipt; a rejected or
    /// reverted deployment is a failure, never a "deployed" receipt.
    private func settle(_ step: SendStep) {
        guard case let .finished(status, _, _) = step else { return }
        switch status {
        case .accepted, .preconfirmed:
            stage = .confirmed

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
        hash = failure.hash
        driver = nil
        stage = .failed
    }
}
