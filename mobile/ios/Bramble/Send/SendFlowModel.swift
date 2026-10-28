import BrambleCore
import Foundation
import Observation

/// Fixed numbers of the Send journey's arithmetic and formatting.
private enum SendFlowNumbers {
    /// Fraction digits the balance line shows.
    static let balanceFractionDigits: UInt8 = 4
    /// The base of the decimal strings `halve` works on.
    static let decimalBase = 10
    /// Half: the divisor `halve` applies.
    static let halvingDivisor = 2
}

/// The Send journey's state machine on the UI side, mirroring the extension's `TransferStage`.
/// All protocol decisions (validation, fees, hashing, signing, what is sent where) are the core's
/// `TransferPlan`; this type only tracks which screen to show and what the user typed. Any edit
/// drops the plan, so a new review is always a new plan (the extension's `transferKey`).
@MainActor
@Observable
final class SendFlowModel {
    /// There is no asset stage: the token is picked in a sheet over the details (the extension's
    /// dropdown inside its amount stage).
    enum Stage: Equatable {
        case recipient, details, reviewing, review, authorizing, broadcasting, confirming, pending
        case submitted, failed
    }

    private(set) var stage: Stage = .recipient
    var recipientInput = "" { didSet { recipientError = nil } }
    private(set) var recipientError: String?
    private(set) var recipient: String?
    /// The name of the row the recipient came from (a saved contact or one of the user's own
    /// accounts), never typed text; nil shows the truncated address instead.
    private(set) var recipientLabel: String?
    private(set) var token: TokenInfo
    var amount = "" { didSet { if amount != oldValue { amountError = nil; dropPlan() } } }
    private(set) var amountError: String?
    private(set) var review: TransferReview?
    private(set) var reviewBlock: String?
    private(set) var hash: String?
    private(set) var explorerURL: URL?
    private(set) var failureMessage: String?
    /// The outcome toast: a confirmation goes through `WalletStore.notify` (success tone), a
    /// transaction that was not confirmed stays an error.
    private(set) var toast: Toast?

    struct Toast: Equatable {
        let message: String
        let success: Bool
    }

    let network: NetworkInfo
    /// The sending account: a vault record the core will sign for by id.
    let account: AccountRecord
    /// Every account on this network, the sender included (`sendRecipientAccounts`): shielding
    /// sends to the account's own address, so the origin stays pickable and is marked "Current".
    let accounts: [AccountRecord]
    private let core: WalletCore
    private let balances: [String: String]
    private let transport: RpcTransport
    private let track: (TransferPlan) -> Void
    private var driver: SendDriver?

    init(
        core: WalletCore,
        network: NetworkInfo,
        account: AccountRecord,
        accounts: [AccountRecord],
        balances: [String: String],
        transport: RpcTransport,
        openingToken: String? = nil,
        track: @escaping (TransferPlan) -> Void = { _ in /* Nothing tracks the plan. */ }
    ) {
        self.core = core
        self.network = network
        self.account = account
        self.accounts = accounts
        self.balances = balances
        self.transport = transport
        self.track = track
        token = Self.token(openingToken, in: network) ?? network.tokens.first { $0.symbol == "STRK" }
            ?? network.tokens[0]
    }

    /// The network's token at `address`, compared as canonical felts; nil for none (the journey
    /// then opens on STRK, as from Home). A token screen's Send seeds the asset and nothing else.
    nonisolated static func token(_ address: String?, in network: NetworkInfo) -> TokenInfo? {
        guard let address, let wanted = validateRecipient(input: address) else { return nil }
        return network.tokens.first { validateRecipient(input: $0.address) == wanted }
    }

    var title: String { Self.title(stage) }

    /// The flow header's title for each stage (`transferStageTitle`): authorizing, broadcasting
    /// and confirming all read "Sending".
    nonisolated static func title(_ stage: Stage) -> String {
        switch stage {
        case .recipient:
            SendCopy.titleRecipient

        case .details, .reviewing:
            SendCopy.titleDetails

        case .review:
            SendCopy.titleReview

        case .authorizing:
            SendCopy.titleAuthorizing

        case .broadcasting:
            SendCopy.titleBroadcasting

        case .confirming:
            SendCopy.titleConfirming

        case .pending:
            SendCopy.titlePending

        case .submitted:
            SendCopy.titleSubmitted

        case .failed:
            SendCopy.titleFailed
        }
    }

    /// Base-unit balance of the selected token, or nil while unread.
    var rawBalance: String? { balances[token.symbol] }

    /// "Balance <amount> SYMBOL", or "Balance unavailable" while unread.
    var balanceLine: String {
        guard let raw = rawBalance,
              let text = try? formatTokenAmount(
                raw: raw,
                decimals: token.decimals,
                maxFraction: SendFlowNumbers.balanceFractionDigits
              ) else {
            return SendCopy.balanceUnavailable
        }
        return "\(SendCopy.balancePrefix)\(text) \(token.symbol)"
    }

    // MARK: Recipient and asset

    /// A tapped recipient row: its address, under the row's own name.
    func useRecipient(_ address: String, label: String) {
        recipientInput = address
        continueWithRecipient(label: label)
    }

    /// Validates with the core's `normalizeFeltInput` + `isStarkFieldElement` port. `label` is the
    /// name of the listed row the typed address matches, if any (`knownRecipientLabel`).
    func continueWithRecipient(label: String? = nil) {
        guard let canonical = validateRecipient(input: recipientInput) else {
            recipientError = SendCopy.invalidRecipient
            return
        }
        recipient = canonical
        recipientLabel = label
        dropPlan()
        stage = .details
    }

    /// The token picked in the asset sheet; the amount typed for another token is cleared.
    func choose(_ token: TokenInfo) {
        self.token = token
        amount = ""
        dropPlan()
    }

    func back() {
        switch stage {
        case .review, .failed:
            dropPlan(); stage = recipient == nil ? .recipient : .details

        case .details:
            dropPlan(); stage = .recipient

        default:
            break
        }
    }

    /// Half and Max use the full raw balance (Max does not reserve the fee), formatted exactly,
    /// as the extension's `balanceShortcut`; both do nothing while the balance is unread.
    func fill(half: Bool) {
        guard let raw = rawBalance else { return }
        let selected = half ? Self.halve(raw) : raw
        guard selected.contains(where: { $0 != "0" }),
              let text = try? formatTokenAmount(
                raw: selected,
                decimals: token.decimals,
                maxFraction: token.decimals
              ) else { return }
        amount = text
    }

    /// Integer halving of a base-10 string (floor), as `raw / 2n`.
    nonisolated static func halve(_ decimal: String) -> String {
        var remainder = 0
        var digits = ""
        for character in decimal {
            guard let digit = character.wholeNumberValue else { return "0" }
            let current = remainder * SendFlowNumbers.decimalBase + digit
            digits.append(String(current / SendFlowNumbers.halvingDivisor))
            remainder = current % SendFlowNumbers.halvingDivisor
        }
        let trimmed = digits.drop { $0 == "0" }
        return trimmed.isEmpty ? "0" : String(trimmed)
    }

    // MARK: Review and submit

    /// Builds the plan and runs it to its review.
    func reviewSend() async {
        do {
            _ = try parseTokenAmount(amount: amount, decimals: token.decimals)
        } catch let SendError.InvalidAmount(reason) {
            amountError = switch reason {
            case .notPositive:
                SendCopy.amountGate

            case .tooManyDecimals:
                SendCopy.amountTooManyDecimals

            case .invalid, .tooLarge:
                SendCopy.amountInvalid
            }
            return
        } catch {
            amountError = SendCopy.amountInvalid
            return
        }
        guard let recipient else { stage = .recipient; return }
        dropPlan()
        let request = TransferRequest(
            network: network.network,
            accountId: account.id,
            tokenAddress: token.address,
            recipient: recipient,
            amount: amount,
            feeBalance: balances["STRK"]
        )
        let plan: TransferPlan
        do {
            plan = try core.prepareTransfer(request: request)
        } catch SendError.InvalidRecipient {
            recipientError = SendCopy.invalidRecipient
            stage = .recipient
            return
        } catch {
            amountError = SendCopy.amountInvalid
            return
        }
        track(plan)
        let started = SendDriver(plan: plan, network: network, transport: transport)
        driver = started
        stage = .reviewing
        await settle { try await started.run(from: .start) }
    }

    func retryFee() async {
        guard let driver, stage == .review else { return }
        await driver.releaseEndpoint()
        stage = .reviewing
        await settle { try await driver.run(from: .retryEstimate) }
    }

    /// Confirms the reviewed plan. The core re-reads chain state, re-checks the reviewed fee, and
    /// signs; this only follows along.
    func confirm() async {
        guard let driver, stage == .review, review?.canConfirm == true else { return }
        stage = .authorizing
        await settle {
            try await driver.run(from: .confirm) { step in
                if case .rpc(_, _, _, true) = step { await self.markBroadcasting() }
            }
        }
    }

    func checkAgain() async {
        guard let driver, stage == .pending else { return }
        stage = .confirming
        await settle { try await driver.run(from: .checkAgain) }
    }

    /// Edit from review or failure: the plan is dropped and the details come back.
    func edit() {
        dropPlan()
        stage = .details
    }

    /// Dismissal, lock, or backgrounding. The core keeps the pending record of any write that
    /// already left, so closing never loses a submitted transaction.
    func close() { dropPlan() }

    private func markBroadcasting() { if stage == .authorizing { stage = .broadcasting } }

    private func dropPlan() {
        driver?.plan.cancel()
        driver = nil
        review = nil
        reviewBlock = nil
    }

    private func settle(_ outcome: () async throws -> SendStep) async {
        // Held here because a lock or dismissal drops `driver` while the step is in flight.
        let plan = driver?.plan
        do {
            let step = try await outcome()
            try await handle(step)
        } catch {
            // A refused step (`PlanClosed` after a lock, `OutOfOrder`) ends the journey closed.
            // If a signed write may already have left, the core says which and with what hash,
            // so the journey never claims "not sent" for a transaction that may be on chain.
            fail(with: plan?.interruptedFailure() ?? SendFailure(code: .locked, hash: nil))
        }
    }

    private func handle(_ step: SendStep) async throws {
        switch step {
        case .review:
            guard let current = driver?.plan.currentReview() else {
                fail(with: SendFailure(code: .nodeError, hash: nil))
                return
            }
            review = current
            reviewBlock = current.flags.contains(.addressPoisoning) ? SendCopy.poisonedBlock
                : current.canConfirm ? nil : SendCopy.feeUnavailableBlock
            stage = .review

        case let .broadcast(hash):
            self.hash = hash
            explorerURL = explorerTransactionUrl(network: network.network, hash: hash).flatMap(URL.init(string:))
            stage = .confirming
            if let driver { try await handle(try await driver.run(from: .proceed)) }

        case let .finished(status, hash, explorerUrl):
            self.hash = hash
            explorerURL = explorerUrl.flatMap(URL.init(string:))
            finish(status)

        case let .failed(failure):
            fail(with: failure)

        case .rpc, .wait:
            break
        }
    }

    private func finish(_ status: TxStatus) {
        switch status {
        case .accepted:
            stage = .submitted; toast = Toast(message: SendCopy.toastConfirmed, success: true)

        case .preconfirmed:
            stage = .submitted; toast = Toast(message: SendCopy.toastPreconfirmed, success: true)

        case .pending:
            stage = .pending

        case .rejected:
            failureMessage = SendCopy.rejectedMessage
            stage = .failed
            toast = Toast(message: SendCopy.toastNotConfirmed, success: false)

        case .reverted:
            failureMessage = SendCopy.revertedMessage
            stage = .failed
            toast = Toast(message: SendCopy.toastNotConfirmed, success: false)
        }
    }

    private func fail(with failure: SendFailure) {
        failureMessage = SendFailureText.message(failure)
        if SendFailureText.mayHaveReachedChain(failure.code) { hash = failure.hash ?? hash }
        driver = nil
        stage = .failed
    }
}
