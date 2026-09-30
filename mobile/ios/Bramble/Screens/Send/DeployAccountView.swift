import BrambleCore
import SwiftUI

/// `deploy-account` (`deployAccountFlow` in `flows.ts`, bound by `bindDeploy`): the Account,
/// Address and Network rows, the fee quoted on open in the Cost box, one Deploy button, and the
/// receipt once submitted. Opened from Settings › This account whatever the deployment state:
/// an account already on chain reads "Account already deployed" on a disabled button. Built from
/// the Send screens' receipt, Cost box and outcome, so both flows share one layout.
struct DeployAccountView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var model: DeployFlowModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.stageGap) {
                FlowHeader(title: SendCopy.deployTitle, network: store.networkLabel) { dismiss() }
                if let model, let account = store.account {
                    if model.stage == .submitted || model.stage == .confirmed {
                        receipt(model)
                    } else {
                        form(model, account: account)
                    }
                } else {
                    // A view-only account has nothing this wallet can deploy; say why.
                    StatusLine(text: store.sendRefusal)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .onAppear {
            guard model == nil, let started = store.makeDeployModel() else { return }
            model = started
            Task { await started.quote() }
        }
        .onDisappear { model?.close() }
    }

    private func form(_ model: DeployFlowModel, account: AccountRecord) -> some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
            SendReceipt(rows: [
                SendReceipt.Row(SendCopy.deployAccountRow, account.displayName),
                SendReceipt.Row(SendCopy.deployAddressRow, account.shortAddress, mono: true),
                SendReceipt.Row(SendCopy.deployNetworkRow, store.networkLabel)
            ])
            if let fee = model.fee {
                SendCostBox(cost: SendReviewCopy.Cost(
                    lines: [SendCopy.maximumFeePrefix + fee.display],
                    failure: nil,
                    shortfall: false
                )) {
                    // No retry: a quoted fee has nothing to retry.
                }
            }
            StatusLine(
                text: model.status,
                tone: model.stage == .failed || model.stage == .estimateFailed ? .danger : .muted
            )
            action(model)
        }
    }

    @ViewBuilder
    private func action(_ model: DeployFlowModel) -> some View {
        if model.stage == .alreadyDeployed {
            PillButton(SendCopy.alreadyDeployed, icon: .check) {
                // No action: the account is already deployed, so this is a disabled status button.
            }
            .disabled(true)
        } else {
            PillButton(
                SendCopy.deployButton,
                icon: .check,
                busy: model.stage == .estimating || model.stage == .submitting
            ) {
                Task { await model.deploy() }
            }
        }
    }

    /// `outcomeReceiptSection("deploy-success")`: "Deployment submitted" until the chain answers,
    /// then "Account deployed"; the transaction row; View in Activity tab and Back.
    private func receipt(_ model: DeployFlowModel) -> some View {
        let receipt = model.receipt
        return SendOutcomeLayout(
            icon: .check,
            tint: skin.positive,
            title: receipt.title,
            message: receipt.message,
            hash: model.hash,
            hashLabel: SendCopy.transactionLabel,
            explorerURL: model.explorerURL
        ) {
            PillButton(SendCopy.viewActivity, icon: .activity) { leave(to: .activity) }
            PillButton(SendCopy.back, kind: .secondary) { leave(to: .home) }
        }
    }

    /// Leaves the flow for a dock tab (the extension's Back goes Home), re-reading the account's
    /// deployment and balances on the way.
    private func leave(to tab: WalletStore.Tab) {
        Task {
            await store.refreshSendState()
            await store.refreshBalances()
        }
        store.tab = tab
        dismiss()
    }
}
