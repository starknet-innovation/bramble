import BrambleCore
import SwiftUI

/// `#swap-confirm` (`swapConfirmReceipt`) on the Send review's parts: what is sold and received,
/// the core's line for each call it will sign (the approval, then the route with its floor and
/// payee) and the minimum the signed route enforces, the plan's Cost box, the risks panel, and
/// Confirm swap. Nothing here is recomputed: the minimum is the one the core decoded from the
/// frozen route, and every review and risk sentence is the core's, unedited.
struct SwapReviewSection: View {
    @Environment(\.skin) private var skin
    let model: SwapFlowModel

    var body: some View {
        if let review = model.review, let judged = model.swapReview, let quote = model.quote,
           let sell = model.sell, let buy = model.buy {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
                VStack(alignment: .leading, spacing: BrambleMetrics.SendReview.stackGap) {
                    SendReceipt(rows: [
                        SendReceipt.Row(SwapCopy.reviewSell, "\(quote.sellAmount) \(sell.symbol)"),
                        SendReceipt.Row(SwapCopy.reviewReceive, "\(quote.buyAmount) \(buy.symbol)"),
                        SendReceipt.Row(SwapCopy.minimumReceived, "\(judged.minBuyAmount) \(buy.symbol)")
                    ])
                    calls(judged.summaries)
                    SendCostBox(cost: SendReviewCopy.cost(review)) { Task { await model.retryFee() } }
                    SendRisksPanel(messages: model.risks)
                }
                PillButton(
                    model.stage == .submitting ? SwapCopy.submitting : SwapCopy.confirm,
                    icon: .check,
                    busy: model.stage == .submitting
                ) {
                    Task { await model.confirm() }
                }
                .disabled(!review.canConfirm)
            }
        }
    }

    /// The core's summary of each call, in the order signed.
    private func calls(_ summaries: [String]) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            ForEach(Array(summaries.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .brambleText(BrambleTypeScale.caption)
                    .foregroundStyle(skin.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(BrambleMetrics.SendReview.feeLayerPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            skin.panel,
            in: RoundedRectangle(cornerRadius: BrambleMetrics.SendReview.feeLayerRadius, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

/// `#swap-success`, or the failure: the chain's answer so far, the hash, then View in Activity
/// tab and Back. A submitted swap reads "Swap submitted" with the not-confirmed note until the
/// chain answers; a failure says what the core knows (`SendFailureText`), never "not sent" for a
/// write that may have left.
struct SwapOutcomeView: View {
    @Environment(\.skin) private var skin
    let model: SwapFlowModel
    let leave: (WalletStore.Tab) -> Void

    var body: some View {
        let failed = model.stage == .failed
        SendOutcomeLayout(
            icon: failed ? .alert : .check,
            tint: failed ? skin.danger : skin.positive,
            title: failed ? SwapCopy.swapFailed : model.confirmed ? SwapCopy.complete : SwapCopy.submitted,
            message: failed ? model.failureMessage : model.confirmed ? nil : SwapCopy.notConfirmed,
            hash: model.hash,
            hashLabel: SwapCopy.transaction,
            explorerURL: model.explorerURL
        ) {
            PillButton(SwapCopy.viewActivity, icon: .activity) { leave(.activity) }
            PillButton(SwapCopy.back, kind: .secondary) { leave(.home) }
        }
    }
}
