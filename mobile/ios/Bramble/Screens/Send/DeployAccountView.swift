import BrambleCore
import SwiftUI

/// `deploy-account` from `flows.ts`: what will happen, the account receipt, the risk note, then
/// "Review deployment" → "Confirm deployment · <fee>" → "Deployment submitted". Built from the
/// Send screens' receipt, fee panel and outcome, so both flows share one layout.
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
                    if model.stage == .submitted {
                        submitted(model)
                    } else {
                        form(model, account: account)
                    }
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .onAppear { if model == nil { model = store.makeDeployModel() } }
        .onDisappear { model?.close() }
    }

    private func form(_ model: DeployFlowModel, account: AccountRecord) -> some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
            Eyebrow(text: SendCopy.whatWillHappen)
            Text(SendCopy.deployOutcome).brambleText(BrambleTypeScale.body)
            SendReceipt(rows: [
                SendReceipt.Row(SendCopy.deployAccountRow, account.displayName),
                SendReceipt.Row(SendCopy.deployAddressRow, account.shortAddress, mono: true),
                SendReceipt.Row(SendCopy.deployContractRow, SendCopy.deployContractValue),
                SendReceipt.Row(SendCopy.deployNetworkRow, store.networkLabel)
            ])
            Eyebrow(text: SendCopy.riskAndRecovery)
            Text(SendCopy.deployRisk).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            if let fee = model.fee {
                VStack(alignment: .leading, spacing: BrambleMetrics.SendReview.feeGap) {
                    Eyebrow(text: SendCopy.maximumCost)
                    Text(SendCopy.maximumFeePrefix + fee.display)
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                        .monospacedDigit()
                }
                .padding(BrambleMetrics.SendReview.feePadding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    skin.panel,
                    in: RoundedRectangle(cornerRadius: BrambleMetrics.SendReview.feeRadius, style: .continuous)
                )
            }
            StatusLine(text: model.stage == .failed ? model.failureMessage : nil, tone: .danger)
            action(model)
        }
    }

    @ViewBuilder
    private func action(_ model: DeployFlowModel) -> some View {
        switch model.stage {
        case .reviewed, .submitting:
            PillButton(
                SendCopy.confirmDeploymentPrefix + (model.fee?.display ?? ""),
                icon: .check,
                busy: model.stage == .submitting
            ) {
                Task { await model.confirm() }
            }

        case .alreadyDeployed:
            PillButton(SendCopy.alreadyDeployed, icon: .check) {
                // No action: the account is already deployed, so this is a disabled status button.
            }
            .disabled(true)

        default:
            PillButton(SendCopy.reviewDeployment, icon: .check, busy: model.stage == .reviewing) {
                Task { await model.review() }
            }
        }
    }

    private func submitted(_ model: DeployFlowModel) -> some View {
        SendOutcomeLayout(
            icon: .check,
            tint: skin.positive,
            kicker: SendCopy.deploySuccessKicker,
            title: SendCopy.deploySuccessTitle,
            message: SendCopy.deploySuccessBody,
            hash: model.hash
        ) {
            PillButton(SendCopy.backToHome, icon: .home) {
                Task { await store.refreshBalances() }
                dismiss()
            }
        }
    }
}

/// `deployNotice`: shown only when the core judged the account `Undeployed`. With a STRK balance
/// read as zero it asks for funding and opens Receive; otherwise it opens Deploy account.
struct DeployNoticeView: View {
    @Environment(WalletStore.self) private var store
    let receive: () -> Void
    let deploy: () -> Void

    var body: some View {
        if store.deployment == .undeployed {
            let unfunded = store.balances["STRK"].map { $0 == "0" } ?? false
            // The extension's notice is a chip whose explanation is its title (tooltip); here the
            // explanation is the accessibility hint.
            PillButton(
                unfunded ? SendCopy.fundChip : SendCopy.deployChip,
                kind: .secondary,
                icon: unfunded ? .qrCode : .rocket,
                small: true,
                action: unfunded ? receive : deploy
            )
            .accessibilityHint(unfunded ? SendCopy.fundChipTitle : SendCopy.deployChipTitle)
        }
    }
}
