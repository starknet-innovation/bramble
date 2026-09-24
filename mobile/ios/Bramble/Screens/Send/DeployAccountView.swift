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

    private func form(_ model: DeployFlowModel, account: AccountInfo) -> some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
            Eyebrow(text: SendCopy.whatWillHappen)
            Text(SendCopy.deployOutcome).brambleText(BrambleTypeScale.body)
            SendReceipt(rows: [
                (SendCopy.deployAccountRow, "Account \(account.index + 1)", false),
                (SendCopy.deployAddressRow, shortAddress(account.address), true),
                (SendCopy.deployContractRow, SendCopy.deployContractValue, false),
                (SendCopy.deployNetworkRow, store.networkLabel, false),
            ])
            Eyebrow(text: SendCopy.riskAndRecovery)
            Text(SendCopy.deployRisk).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            if let fee = model.fee {
                VStack(alignment: .leading, spacing: BrambleMetrics.SendReview.feeGap) {
                    Eyebrow(text: SendCopy.maximumCost)
                    Text(SendCopy.maximumFeePrefix + fee.display).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold).monospacedDigit()
                }
                .padding(BrambleMetrics.SendReview.feePadding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleMetrics.SendReview.feeRadius, style: .continuous))
            }
            StatusLine(text: model.stage == .failed ? model.failureMessage : nil, tone: .danger)
            action(model)
        }
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
        SendOutcomeLayout(icon: .check, tint: skin.positive, kicker: SendCopy.deploySuccessKicker, title: SendCopy.deploySuccessTitle,
                          message: SendCopy.deploySuccessBody, hash: model.hash) {
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
            PillButton(unfunded ? SendCopy.fundChip : SendCopy.deployChip, kind: .secondary, icon: unfunded ? .qrCode : .rocket, small: true,
                       action: unfunded ? receive : deploy)
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
                    let m = BrambleMetrics.MenuRow.self
                    HStack(spacing: m.gap) {
                        BrambleIcon(record.kind == .deploy ? .rocket : .send, size: m.glyph).foregroundStyle(skin.muted)
                        VStack(alignment: .leading, spacing: BrambleMetrics.TokenRow.copyGap) {
                            Text(record.summary).brambleText(BrambleTypeScale.body.sized(m.titleSize), weight: m.titleWeight)
                            Text(statusText(record.status)).brambleText(BrambleTypeScale.caption.sized(m.valueSize)).foregroundStyle(skin.muted)
                        }
                        Spacer(minLength: m.gap)
                        if let link = record.explorerUrl, let url = URL(string: link) {
                            Link(destination: url) {
                                BrambleIcon(.externalLink).foregroundStyle(skin.muted)
                                    .frame(width: BrambleMetrics.IconButton.size, height: BrambleMetrics.IconButton.size)
                                    .hitTarget(width: BrambleMetrics.IconButton.size, height: BrambleMetrics.IconButton.size)
                            }
                            .accessibilityLabel("\(record.summary). \(SendCopy.explorerLinkLabel)")
                        }
                    }
                    .padding(m.padding)
                    .frame(minHeight: m.height)
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
