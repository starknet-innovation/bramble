import BrambleCore
import Foundation

/// Moves one gasless choice's paymaster requests (`GaslessFee`) over the bounded HTTP path. The
/// core describes every request, judges every reply, checks the gateway's outside execution
/// against the reviewed transfer and signs it; this only waits the delays the core asks for and
/// hands back what came back (mobile/docs/gasless.md).
struct GaslessDriver: Sendable {
    /// How a submission ended, as the Send journey shows it.
    enum Outcome: Equatable {
        /// The relay accepted the execution: its transaction hash and explorer page.
        case submitted(hash: String, explorerUrl: String?)
        /// Refused before anything was submitted; `reason` is the core's sentence.
        case refused(String)
        /// The execute's answer could not be read: the relay may hold it (the core's sentence).
        case unknown(String)
        /// The wallet locked, or was re-unlocked, since the review.
        case locked
        /// The choice no longer matches the review (a second choice, or a new estimate).
        case moved
    }

    /// Milliseconds per second, for the host clock the core reads.
    private static let millisecondsPerSecond: Double = 1_000

    let transport: any PortfolioTransport
    /// The device a Ledger account signs the relay on; nil is the app's (`LedgerSigner.shared`).
    var signer: (any DeviceSigning)?
    /// The host's wall clock in epoch milliseconds.
    var clock: @Sendable () -> UInt64 = { UInt64(Date().timeIntervalSince1970 * millisecondsPerSecond) }

    /// Opens the core's offer round for `plan` off the main actor; nil when the core offers none.
    func round(_ plan: TransferPlan, prices: PriceView?, balances: [GaslessBalance]) async -> GaslessOffers? {
        let nowMs = clock()
        return await Task.detached { plan.gaslessOffers(prices: prices, balances: balances, nowMs: nowMs) }.value
    }

    /// Runs the offer round to its end: the offers the review may show beside STRK, possibly
    /// none. A cancelled round, or a step the core refuses, offers nothing.
    func offers(_ fee: any GaslessFeeProtocol, first: GaslessOfferStep) async -> [GaslessOffer] {
        var step = first
        while true {
            switch step {
            case let .done(offers):
                return offers

            case let .post(post):
                guard (try? await pause(post.delayMs)) != nil else { return [] }
                let outcome = await transport.perform(post.request)
                guard let next = try? fee.acceptOfferReply(outcome: outcome) else { return [] }
                step = next
            }
        }
    }

    /// The person's choice, run to its end. Once the core has signed, the execute is posted even
    /// if the caller goes away: the core filed its row first, so a lost answer stays guarded. A
    /// cancelled task stops at its next pause, never cutting the core's delay short, and reads as
    /// unknown (Android's cancellation, which posts nothing more either).
    /// `account` is the record the reviewed plan was built for, shown as the Ledger's signer.
    func submit(
        _ fee: any GaslessFeeProtocol,
        offer: GaslessOffer,
        prices: PriceView?,
        account: AccountRecord? = nil
    ) async -> Outcome {
        var device: (any DeviceSigning)?
        let outcome = await submit(fee, offer: offer, prices: prices, account: account) { device = $0 }
        await device?.finish()
        return outcome
    }

    private func submit(
        _ fee: any GaslessFeeProtocol,
        offer: GaslessOffer,
        prices: PriceView?,
        account: AccountRecord?,
        using: (any DeviceSigning) -> Void
    ) async -> Outcome {
        do {
            var step = try fee.choose(offer: offer, prices: prices, nowMs: clock())
            while true {
                switch step {
                case let .submitted(hash, explorerUrl):
                    return .submitted(hash: hash, explorerUrl: explorerUrl)

                case let .post(post):
                    try await pause(post.delayMs)
                    let outcome = await transport.perform(post.request)
                    step = try fee.acceptSubmitReply(outcome: outcome, nowMs: clock())

                case let .wait(delayMs):
                    // The core posts again only if the wallet is still unlocked after the pause.
                    try await pause(delayMs)
                    step = try fee.resume()

                case let .device(apdu):
                    let ledger = await deviceSigner()
                    using(ledger)
                    guard let answer = await ledger.exchange(apdu, for: account) else { return Self.cancelled }
                    step = try fee.advanceDevice(reply: answer, nowMs: clock())

                case let .deviceRetry(reason):
                    let ledger = await deviceSigner()
                    using(ledger)
                    guard await ledger.refused(reason, for: account) else { return Self.cancelled }
                    step = try fee.advanceDevice(reply: .retryDevice, nowMs: clock())
                }
            }
        } catch let error as GaslessFeeError {
            return Self.outcome(error)
        } catch {
            // Not the core's refusal (a stray error, or cancellation at a pause), so the execute
            // may have gone out: say so, never "locked".
            return .unknown(SendCopy.failureIndeterminate)
        }
    }

    static func outcome(_ error: GaslessFeeError) -> Outcome {
        switch error {
        case .Locked:
            .locked

        case .NotFound:
            .moved

        case let .Refused(reason, _):
            .refused(reason)

        case let .Lost(reason):
            .unknown(reason)
        }
    }

    /// Cancelled on the device sheet: nothing was signed, so nothing was submitted.
    static let cancelled = Outcome.refused(SendFailureText.message(SendFailure(code: .signingFailed, hash: nil)))

    private func deviceSigner() async -> any DeviceSigning {
        if let signer { return signer }
        return await MainActor.run { LedgerSigner.shared }
    }

    /// Waits the core's delay; throws `CancellationError` instead of cutting it short.
    private func pause(_ delayMs: UInt64) async throws {
        if delayMs > 0 { try await Task.sleep(for: .milliseconds(Int(delayMs))) }
        try Task.checkCancellation()
    }
}
