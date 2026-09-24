import BrambleCore
import SwiftUI

/// `deploy-account` from `flows.ts`: what will happen, the account receipt, the risk note, then
/// "Review deployment" → "Confirm deployment · <fee>" → "Deployment submitted".
struct DeployAccountView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var model: DeployFlowModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                FlowHeader(title: SendCopy.deployTitle, network: store.networkLabel) { dismiss() }
                if let model, let account = store.account {
                    if model.stage == .submitted {
                        submitted(model)
                    } else {
                        Eyebrow(text: SendCopy.whatWillHappen)
                        Text(SendCopy.deployOutcome).brambleText(BrambleTypeScale.body)
                        MenuGroup {
                            ReceiptRow(label: SendCopy.deployAccountRow, value: "Account \(account.index + 1)")
                            ReceiptRow(label: SendCopy.deployAddressRow, value: shortAddress(address: account.address), mono: true)
                            ReceiptRow(label: SendCopy.deployContractRow, value: SendCopy.deployContractValue)
                            ReceiptRow(label: SendCopy.deployNetworkRow, value: store.networkLabel)
                        }
                        Eyebrow(text: SendCopy.riskAndRecovery)
                        Text(SendCopy.deployRisk).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                        if let fee = model.fee {
                            Text(SendCopy.maximumFeePrefix + fee.display).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                        }
                        StatusLine(text: model.stage == .failed ? model.failureMessage : nil, tone: .danger)
                        action(model)
                    }
                }
            }
            .padding(.horizontal, BrambleSpace.lg)
        }
        .onAppear { if model == nil { model = store.makeDeployModel() } }
        .onDisappear { model?.close() }
    }

    @ViewBuilder private func action(_ model: DeployFlowModel) -> some View {
        switch model.stage {
        case .reviewed, .submitting:
            PillButton(SendCopy.confirmDeploymentPrefix + (model.fee?.display ?? ""), icon: .check, busy: model.stage == .submitting) {
                Task { await model.confirm() }
            }
        case .alreadyDeployed:
            PillButton(SendCopy.alreadyDeployed, icon: .check) {}.disabled(true)
        default:
            PillButton(SendCopy.reviewDeployment, icon: .check, busy: model.stage == .reviewing) {
                Task { await model.review() }
            }
        }
    }

    private func submitted(_ model: DeployFlowModel) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            Eyebrow(text: SendCopy.deploySuccessKicker)
            Text(SendCopy.deploySuccessTitle).brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
            Text(SendCopy.deploySuccessBody).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            if let hash = model.hash {
                Text(hash).brambleText(BrambleTypeScale.mono, mono: true).foregroundStyle(skin.muted).textSelection(.enabled)
            }
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
            PillButton(unfunded ? SendCopy.fundChip : SendCopy.deployChip, kind: .secondary, icon: .alert, action: unfunded ? receive : deploy)
                .accessibilityHint(unfunded ? SendCopy.fundChipTitle : SendCopy.deployChipTitle)
        }
    }
}

/// Locally recorded transactions, newest first, each linking to Starkscan when its hash is valid.
struct LocalActivityRows: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin

    var body: some View {
        if !store.activity.isEmpty {
            MenuGroup {
                ForEach(store.activity, id: \.hash) { record in
                    HStack(spacing: BrambleSpace.md) {
                        BrambleIcon(record.kind == .deploy ? .rocket : .send).foregroundStyle(skin.muted)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.summary).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                            Text(statusText(record.status)).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                        }
                        Spacer()
                        if let link = record.explorerUrl, let url = URL(string: link) {
                            Link(destination: url) { BrambleIcon(.externalLink).foregroundStyle(skin.muted) }
                                .accessibilityLabel("\(record.summary). \(SendCopy.explorerLinkLabel)")
                        }
                    }
                    .padding(.horizontal, BrambleSpace.lg)
                    .frame(minHeight: 56)
                }
            }
        }
    }

    /// The extension's status label (`transactionRow`), first letter raised for display.
    private func statusText(_ status: TxStatus) -> String {
        let label = switch status {
        case .pending: SendCopy.activityPending
        case .preconfirmed: SendCopy.activityPreconfirmed
        case .accepted: SendCopy.activityAccepted
        case .rejected: SendCopy.activityRejected
        case .reverted: SendCopy.activityReverted
        }
        return label.prefix(1).uppercased() + label.dropFirst()
    }
}
