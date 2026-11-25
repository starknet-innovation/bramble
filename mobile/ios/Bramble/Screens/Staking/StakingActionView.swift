import BrambleCore
import SwiftUI

/// One staking action's review and outcome, as a sheet over the validator. Built from the Send
/// screens' parts (the Cost box, the risks panel, the outcome layout), so a staking confirm reads
/// like every other confirm. The sentence is the core's (`StakingPlan.review`) with the extension's
/// fee line (`review.staking.review`); Confirm carries the fee it signs under. Closing the sheet
/// cancels an unsigned plan.
struct StakingActionView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let model: StakingActionModel
    let close: () -> Void
    /// Leaves staking for the Activity tab.
    let viewActivity: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
                FlowHeader(
                    title: StakingText.label(model.action),
                    subtitle: model.symbol,
                    network: store.networkLabel,
                    back: close
                )
                stage
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .background(skin.bg.ignoresSafeArea())
        .task { await model.prepare() }
        .onDisappear { model.close() }
        .onChange(of: model.stage) { _, stage in
            if stage == .submitted { store.notify(StakingCopy.reviewSubmitted) }
        }
    }

    @ViewBuilder private var stage: some View {
        switch model.stage {
        case .preparing:
            StatusLine(text: StakingCopy.reviewEstimating)
            PillButton(StakingText.label(model.action), busy: true) {
                // No action: the review is being prepared.
            }

        case .review, .submitting:
            review

        case .refused:
            StatusLine(text: model.message, tone: .danger)
            PillButton(SendCopy.back, kind: .secondary, action: close)

        case .submitted:
            SendOutcomeLayout(
                icon: .check,
                tint: skin.positive,
                title: StakingCopy.reviewSubmitted,
                message: StakingCopy.reviewSubmittedFollow,
                hash: model.hash,
                hashLabel: SendCopy.transactionLabel,
                explorerURL: model.explorerURL
            ) {
                PillButton(SendCopy.viewActivity, icon: .activity, action: viewActivity)
                PillButton(SendCopy.back, kind: .secondary, action: close)
            }

        case .failed:
            SendOutcomeLayout(
                icon: .alert,
                tint: skin.danger,
                title: StakingCopy.reviewFailed,
                message: model.message,
                copyMessageLabel: SendCopy.copyError,
                hash: model.hash
            ) {
                PillButton(SendCopy.viewActivity, icon: .activity, action: viewActivity)
                PillButton(SendCopy.back, kind: .secondary, action: close)
            }
        }
    }

    @ViewBuilder private var review: some View {
        if let line = model.reviewLine {
            Text(line)
                .brambleText(BrambleTypeScale.body)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(BrambleMetrics.SendReview.feeLayerPadding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(skin.panel, in: RoundedRectangle(
                    cornerRadius: BrambleMetrics.SendReview.feeLayerRadius,
                    style: .continuous
                ))
                .accessibilityIdentifier("staking-review")
        }
        if let reviewed = model.review, reviewed.fee == nil {
            SendCostBox(cost: SendReviewCopy.cost(reviewed)) { Task { await model.retryFee() } }
        }
        if model.review?.affordability == .insufficient {
            Text(SendCopy.shortfall).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.warning)
        }
        SendRisksPanel(messages: model.risks)
        if model.stage == .submitting { StatusLine(text: StakingCopy.reviewSubmitting) }
        let label = model.confirmLabel ?? StakingText.label(model.action)
        PillButton(label, icon: .check, busy: model.stage == .submitting) {
            Task { await model.confirm() }
        }
        .disabled(model.review?.canConfirm != true)
    }
}
