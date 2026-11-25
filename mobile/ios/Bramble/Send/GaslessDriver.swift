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
    /// The host's wall clock in epoch milliseconds.
    var clock: @Sendable () -> UInt64 = { UInt64(Date().timeIntervalSince1970 * millisecondsPerSecond) }

    /// Runs the offer round to its end: the offers the review may show beside STRK, possibly
    /// none. A cancelled round, or a step the core refuses, offers nothing.
    func offers(_ fee: any GaslessFeeProtocol, first: GaslessOfferStep) async -> [GaslessOffer] {
        var step = first
        while true {
            switch step {
            case let .done(offers):
                return offers

            case let .post(post):
                await pause(post.delayMs)
                guard !Task.isCancelled else { return [] }
                let outcome = await transport.perform(post.request)
                guard let next = try? fee.acceptOfferReply(outcome: outcome) else { return [] }
                step = next
            }
        }
    }

    /// The person's choice, run to its end. Once the core has signed, the execute is posted even
    /// if the caller goes away: the core filed its row first, so a lost answer stays guarded.
    func submit(_ fee: any GaslessFeeProtocol, offer: GaslessOffer, prices: PriceView?) async -> Outcome {
        do {
            var step = try fee.choose(offer: offer, prices: prices, nowMs: clock())
            while true {
                switch step {
                case let .submitted(hash, explorerUrl):
                    return .submitted(hash: hash, explorerUrl: explorerUrl)

                case let .post(post):
                    await pause(post.delayMs)
                    let outcome = await transport.perform(post.request)
                    step = try fee.acceptSubmitReply(outcome: outcome, nowMs: clock())

                case let .wait(delayMs):
                    // The core posts again only if the wallet is still unlocked after the pause.
                    await pause(delayMs)
                    step = try fee.resume()
                }
            }
        } catch let error as GaslessFeeError {
            return Self.outcome(error)
        } catch {
            return .locked
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

    private func pause(_ delayMs: UInt64) async {
        guard delayMs > 0 else { return }
        try? await Task.sleep(for: .milliseconds(Int(delayMs)))
    }
}
