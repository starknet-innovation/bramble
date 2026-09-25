import BrambleCore
import Observation

/// The standalone Deploy account flow (`deployAccountFlow`): review the deployment fee, confirm,
/// and report the submission. The core's plan does the work, exactly as for a send.
@MainActor
@Observable
final class DeployFlowModel {
    enum Stage: Equatable { case idle, reviewing, reviewed, submitting, submitted, alreadyDeployed, failed }

    private(set) var stage: Stage = .idle
    private(set) var fee: FeeAmount?
    private(set) var hash: String?
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

    func review() async {
        close()
        guard let plan = try? core.prepareDeployment(accountId: accountId) else {
            fail(SendFailure(code: .locked, hash: nil))
            return
        }
        track(plan)
        let started = SendDriver(plan: plan, network: network, transport: transport)
        driver = started
        stage = .reviewing
        do {
            let step = try await started.run(from: .start)
            guard case .review = step, let review = plan.currentReview() else {
                if case let .failed(failure) = step {
                    fail(failure)
                    return
                }
                fail(SendFailure(code: .nodeError, hash: nil))
                return
            }
            if review.alreadyDeployed {
                stage = .alreadyDeployed
            } else if let deploymentFee = review.deploymentFee {
                fee = deploymentFee
                stage = .reviewed
            } else {
                fail(SendFailure(code: .nodeError, hash: nil))
            }
        } catch {
            fail(SendFailure(code: .locked, hash: nil))
        }
    }

    func confirm() async {
        guard let driver, stage == .reviewed else { return }
        stage = .submitting
        let plan = driver.plan
        do {
            switch try await driver.run(from: .confirm) {
            case let .broadcast(hash):
                self.hash = hash
                stage = .submitted

            case let .failed(failure):
                fail(failure)

            default:
                fail(SendFailure(code: .nodeError, hash: nil))
            }
        } catch {
            // Closed after the signed write was handed out: report it with its hash.
            fail(plan.interruptedFailure() ?? SendFailure(code: .locked, hash: nil))
        }
    }

    func close() {
        driver?.plan.cancel()
        driver = nil
    }

    private func fail(_ failure: SendFailure) {
        failureMessage = SendFailureText.message(failure)
        hash = failure.hash
        driver = nil
        stage = .failed
    }
}
