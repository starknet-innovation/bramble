import BrambleCore
import SwiftUI

/// One allowance's revoke, built from the Send screens (receipt, Cost box, risks panel, outcome)
/// as Deploy account is: the grant's Spender / Token / Allowance rows, the core's review summary,
/// its fee and risks, then one Revoke button. The review is fetched as the screen opens, so the
/// fee is on screen before the press. Every review, risk and refusal sentence is the core's.
struct RevokeAllowanceView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    let allowance: AllowanceView
    /// Closes every pushed flow, for View in Activity.
    let exit: () -> Void
    @State private var model: RevokeFlowModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.stageGap) {
                FlowHeader(title: AllowanceCopy.revoke, network: store.networkLabel) { leave(to: nil) }
                if let model {
                    switch model.stage {
                    case .submitted, .confirmed:
                        receipt(model)

                    default:
                        form(model)
                    }
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .onAppear {
            guard model == nil, let started = store.makeRevokeModel(allowance) else { return }
            model = started
            Task { await started.prepare() }
        }
        .onDisappear { model?.close() }
        .onChange(of: model?.stage) { _, stage in
            if stage == .submitted { store.notify(AllowanceCopy.submitted) }
        }
    }

    private func form(_ model: RevokeFlowModel) -> some View {
        let token = AllowanceCopy.token(allowance.token, in: store.allowanceTokens)
        return VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
            SendReceipt(rows: [
                SendReceipt.Row(AllowanceCopy.spenderRow, shortAddress(allowance.spender), mono: true),
                SendReceipt.Row(
                    AllowanceCopy.tokenRow,
                    token?.symbol ?? shortAddress(allowance.token),
                    mono: token == nil
                ),
                SendReceipt.Row(AllowanceCopy.amountRow, AllowanceCopy.amount(allowance, token: token))
            ])
            if let review = model.review {
                // The core's own sentence for the one call it will sign.
                Text(review.summary)
                    .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("revoke-summary")
                SendCostBox(cost: SendReviewCopy.cost(review)) { Task { await model.retryFee() } }
                SendRisksPanel(messages: model.risks)
            }
            StatusLine(text: status(model), tone: model.message == nil ? .muted : .danger)
            actions(model)
        }
    }

    /// Estimating while the review is fetched, the fee block when it cannot be confirmed, or why
    /// the revoke was refused or failed.
    private func status(_ model: RevokeFlowModel) -> String? {
        if let message = model.message { return message }
        switch model.stage {
        case .preparing:
            return SendCopy.deployEstimating

        case .review where model.review?.canConfirm == false:
            return SendCopy.feeUnavailableBlock

        default:
            return nil
        }
    }

    @ViewBuilder
    private func actions(_ model: RevokeFlowModel) -> some View {
        switch model.stage {
        case .refused:
            PillButton(SendCopy.back, kind: .secondary) { leave(to: nil) }

        case .failed where model.hash != nil:
            // It may be on chain: follow it in Activity rather than revoke blind a second time.
            PillButton(SendCopy.viewActivity, icon: .activity) { leave(to: .activity) }
            PillButton(SendCopy.back, kind: .secondary) { leave(to: nil) }

        case .failed:
            PillButton(SendCopy.tryAgain, icon: .refresh) { Task { await model.prepare() } }
            PillButton(SendCopy.back, kind: .secondary) { leave(to: nil) }

        default:
            PillButton(
                AllowanceCopy.revoke,
                icon: .check,
                busy: model.stage == .preparing || model.stage == .submitting
            ) {
                Task { await model.confirm() }
            }
            .disabled(model.stage != .review || model.review?.canConfirm != true)
            .accessibilityIdentifier("revoke-confirm")
        }
    }

    /// "Revoke submitted" with the transaction row; pending until the chain confirms it.
    private func receipt(_ model: RevokeFlowModel) -> some View {
        SendOutcomeLayout(
            icon: .check,
            tint: skin.positive,
            title: AllowanceCopy.submitted,
            message: model.stage == .confirmed ? nil : AllowanceCopy.revoking,
            hash: model.hash,
            hashLabel: SendCopy.transactionLabel,
            explorerURL: model.explorerURL
        ) {
            PillButton(SendCopy.viewActivity, icon: .activity) { leave(to: .activity) }
            PillButton(SendCopy.back, kind: .secondary) { leave(to: nil) }
        }
    }

    /// Back to the list (which reads again), or out of every flow to a dock tab.
    private func leave(to tab: WalletStore.Tab?) {
        guard let tab else {
            dismiss()
            return
        }
        Task { await store.refreshSendState() }
        store.tab = tab
        exit()
    }
}
