import BrambleCore
import Foundation
import Observation

/// Fixed numbers of the Send journey's arithmetic and formatting.
enum SendFlowNumbers {
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
    var recipientInput = "" { didSet { recipientError = nil; recipientNote = nil } }
    private(set) var recipientError: String?
    /// The Starknet-name readout under the field (`#send-recipient-note`): "Resolving …" while the
    /// read runs, then why it did not commit. Any keystroke retires it.
    var recipientNote: String?
    /// True while a typed Starknet name is being resolved (StarkNameLookup.swift).
    var resolvingName = false
    /// Set when the recipient came from a resolved Starknet name (`recipientResolvedFrom`): the
    /// review shows the full address it resolved to, and warns when no listed row has it.
    private(set) var resolvedName: ResolvedName?

    /// The review's facts about a name-resolved recipient.
    struct ResolvedName: Equatable {
        /// No contact or account of the user's lists the address (`isNewResolvedRecipient`).
        let isNew: Bool
    }

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
    /// The tokens the core offers to pay the network fee in, when the review found STRK short.
    private(set) var gaslessOffers: [GaslessOffer] = []
    /// The failure is an unknown outcome (a gasless execute whose answer was lost): "Status
    /// unknown", and Activity rather than a re-send.
    private(set) var outcomeUnknown = false
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
    /// The tracked tokens on this network the review warns about paying (`trustedTokenAddresses`).
    private let trackedTokens: [String]
    let transport: RpcTransport
    private let track: (TransferPlan) -> Void
    /// The wallet's price cache and display currency, which price the send's activity record as it
    /// is written (`withSubmittedPrice`); nil records it without a price.
    private let pricing: (prices: PriceBook, currency: DisplayCurrency)?
    private var driver: SendDriver?
    /// The gasless path's host half and the wallet's USD prices; nil turns it off.
    private let gasless: Gasless?
    private var gaslessFee: GaslessFee?
    /// The relay's hash once a gasless send went out; its status is read through the core.
    private var relayedHash: String?

    /// What the gasless path needs from the wallet (mobile/docs/gasless.md).
    struct Gasless {
        let driver: GaslessDriver
        /// The wallet's own fresh USD prices for STRK and these token addresses.
        let prices: ([String]) async -> PriceView?
    }

    init(
        core: WalletCore,
        network: NetworkInfo,
        account: AccountRecord,
        accounts: [AccountRecord],
        balances: [String: String],
        transport: RpcTransport,
        trackedTokens: [String] = [],
        openingToken: String? = nil,
        pricing: (prices: PriceBook, currency: DisplayCurrency)? = nil,
        gasless: Gasless? = nil,
        track: @escaping (TransferPlan) -> Void = { _ in /* Nothing tracks the plan. */ }
    ) {
        self.core = core
        self.network = network
        self.account = account
        self.accounts = accounts
        self.balances = balances
        self.trackedTokens = trackedTokens
        self.transport = transport
        self.track = track
        self.pricing = pricing
        self.gasless = gasless
        token = Self.token(openingToken, in: network) ?? network.tokens.first { $0.symbol == "STRK" }
            ?? network.tokens[0]
    }

    /// The network's token at `address`, compared as canonical felts; nil for none (the journey
    /// then opens on STRK, as from Home). A token screen's Send seeds the asset and nothing else.
    nonisolated static func token(_ address: String?, in network: NetworkInfo) -> TokenInfo? {
        guard let address, let wanted = validateRecipient(input: address) else { return nil }
        return network.tokens.first { validateRecipient(input: $0.address) == wanted }
    }

    /// An unknown outcome did not fail, so the header names the operation only (the extension's).
    var title: String { outcomeUnknown ? SendCopy.titleRecipient : Self.title(stage) }

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
        resolvedName = nil
        dropPlan()
        stage = .details
    }

    /// A Starknet name's address, under the canonical name (never the typed spelling).
    func takeResolvedName(_ address: String, name: String, isNew: Bool) {
        recipient = address
        recipientLabel = name
        resolvedName = ResolvedName(isNew: isNew)
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
            feeBalance: balances["STRK"],
            trackedTokens: trackedTokens
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
        // Before Confirm: the core reads the cached, fresh price only when it writes the record.
        if let pricing { plan.priceWith(prices: pricing.prices, currency: pricing.currency) }
        track(plan)
        let started = SendDriver(plan: plan, network: network, transport: transport)
        driver = started
        stage = .reviewing
        await settle { try await started.run(from: .start) }
        await offerGasless()
    }

    func retryFee() async {
        guard let driver, stage == .review else { return }
        await driver.releaseEndpoint()
        // A new estimate voids the offers made for the old one.
        gaslessFee = nil
        gaslessOffers = []
        stage = .reviewing
        await settle { try await driver.run(from: .retryEstimate) }
        await offerGasless()
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
        if let relayedHash, stage == .pending {
            await watch(relayedHash)
            return
        }
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
        gaslessFee = nil
        gaslessOffers = []
        relayedHash = nil
        outcomeUnknown = false
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

        case .rpc, .wait, .device, .deviceRetry:
            // The driver answers these (`SendDriver.run`); a device step comes back as `.failed`.
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

// MARK: Gasless (mobile/docs/gasless.md)

extension SendFlowModel {
    /// Runs the core's offer round for the open review, only when the review already shows the
    /// STRK shortfall (the core decides whether anything is offered).
    private func offerGasless() async {
        guard stage == .review, review?.affordability == .insufficient, let gasless,
              let plan = driver?.plan else { return }
        let prices = await gasless.prices(network.tokens.map(\.address))
        let held = network.tokens.map { GaslessBalance(tokenAddress: $0.address, balance: balances[$0.symbol]) }
        guard stage == .review, driver?.plan === plan,
              let round = plan.gaslessOffers(prices: prices, balances: held, nowMs: gasless.driver.clock())
        else { return }
        let offers = await gasless.driver.offers(round.fee, first: round.step)
        guard stage == .review, driver?.plan === plan else { return }
        gaslessFee = round.fee
        gaslessOffers = offers
    }

    /// Pays the network fee in `offer`'s token instead of Confirm. The core takes the reviewed
    /// transfer (closing the STRK plan), checks the gateway's build against it, and signs.
    func payFee(with offer: GaslessOffer) async {
        guard stage == .review, let gasless, let fee = gaslessFee else { return }
        stage = .authorizing
        let prices = await gasless.prices(network.tokens.map(\.address))
        let outcome = await gasless.driver.submit(fee, offer: offer, prices: prices)
        // `choose` closed the STRK plan; the review stays for the receipt.
        driver?.plan.cancel()
        driver = nil
        gaslessFee = nil
        gaslessOffers = []
        switch outcome {
        case let .submitted(hash, explorerUrl):
            self.hash = hash
            relayedHash = hash
            explorerURL = explorerUrl.flatMap(URL.init(string:))
            await watch(hash)

        case let .refused(reason):
            failureMessage = SendCopy.failurePrefix + reason
            stage = .failed

        case let .unknown(reason):
            failureMessage = reason
            outcomeUnknown = true
            stage = .failed

        case .moved:
            failureMessage = SendCopy.failurePrefix + SendCopy.feeMoved
            stage = .failed

        case .locked:
            fail(with: SendFailure(code: .locked, hash: nil))
        }
    }

    /// Reads a relayed transaction's status through the core, which settles its activity row.
    private func watch(_ hash: String) async {
        stage = .confirming
        guard let plan = try? core.refreshActivity(accountId: account.id, hash: hash) else {
            stage = .pending
            return
        }
        let started = SendDriver(plan: plan, network: network, transport: transport)
        driver = started
        await settle { try await started.run(from: .start) }
    }
}
