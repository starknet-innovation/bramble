import BrambleCore
import SwiftUI
import UniformTypeIdentifiers

/// `.send-details`: the accounts receipt, the asset card, the amount with Half and Max, and
/// Review send.
struct SendDetailsView: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store
    @Bindable var model: SendFlowModel

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            Eyebrow(text: SendCopy.accountsHeading)
            MenuGroup {
                ReceiptRow(label: SendCopy.fromLabel, value: "Account \(model.account.index + 1)")
                ReceiptRow(label: SendCopy.toLabel, value: model.recipient.map { shortAddress(address: $0) } ?? "—", mono: true)
                ReceiptRow(label: SendCopy.networkLabel, value: store.networkLabel)
            }
            Eyebrow(text: SendCopy.assetLabel)
            Button { model.pickAsset() } label: {
                HStack(spacing: BrambleSpace.md) {
                    TokenMark(address: model.token.address, symbol: model.token.symbol)
                    Text(model.token.symbol).brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
                    Spacer()
                    BrambleIcon(.chevronRight).foregroundStyle(skin.muted)
                }
                .padding(BrambleSpace.md)
            }
            .buttonStyle(FillPressStyle(fill: skin.panel, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous)))
            .accessibilityLabel("\(SendCopy.assetLabel) \(model.token.symbol)")
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                TextField("", text: $model.amount, prompt: Text(SendCopy.amountPlaceholder).foregroundStyle(skin.muted))
                    .keyboardType(.decimalPad)
                    .brambleText(BrambleTypeScale.amount, weight: BrambleWeight.bold, tracking: BrambleTracking.amount)
                    .accessibilityLabel(SendCopy.amountLabel)
                    // Locales whose decimal pad types "," still enter the extension's "." grammar.
                    .onChange(of: model.amount) { _, text in
                        if text.contains(",") { model.amount = text.replacingOccurrences(of: ",", with: ".") }
                    }
                HStack {
                    Text(model.balanceLine).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    Spacer()
                    shortcut(SendCopy.half) { model.fill(half: true) }
                    shortcut(SendCopy.max) { model.fill(half: false) }
                }
                Text(SendCopy.estimatedValueUnavailable).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                StatusLine(text: model.amountError, tone: .danger)
            }
            .padding(BrambleSpace.md)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
            PillButton(model.stage == .reviewing ? SendCopy.preparing : SendCopy.reviewLabel, icon: .send, busy: model.stage == .reviewing) {
                Task { await model.reviewSend() }
            }
            .disabled(model.amount.isEmpty)
        }
    }

    private func shortcut(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.plain)
            .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
            .foregroundStyle(model.rawBalance == nil ? skin.muted : skin.accent)
            .padding(.horizontal, BrambleSpace.sm)
            .frame(minHeight: BrambleControl.hitSmall)
            .disabled(model.rawBalance == nil)
    }
}

/// One `label · value` line of a receipt.
struct ReceiptRow: View {
    @Environment(\.skin) private var skin
    let label: String
    let value: String
    var mono = false

    var body: some View {
        HStack {
            Text(label).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            Spacer()
            Text(value).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold, mono: mono).lineLimit(1)
        }
        .padding(.horizontal, BrambleSpace.lg)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

/// `#send-review-stage`: hero, recipient with copy, fee boundary, technical details, confirm.
struct SendReviewView: View {
    @Environment(\.skin) private var skin
    let model: SendFlowModel
    @State private var copied = false
    @State private var detailsOpen = false

    var body: some View {
        if let review = model.review {
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                HStack {
                    Text(SendCopy.reviewLabel).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
                    Spacer()
                    Button(SendCopy.edit) { model.edit() }
                        .buttonStyle(.plain).foregroundStyle(skin.accent)
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(review.amountDisplay) \(review.tokenSymbol)")
                        .brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                    Text(SendCopy.fiatUnavailable).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
                HStack {
                    Text(SendCopy.recipientRowLabel).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                    Spacer()
                    Text(review.recipientShort).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold, mono: true)
                    IconButton(icon: copied ? .check : .copy, label: SendCopy.copyRecipient, tint: skin.muted) {
                        // Local-only and expiring, as ReceiveView: no Universal Clipboard hand-off.
                        UIPasteboard.general.setItems([[UTType.plainText.identifier: review.recipient]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
                        copied = true
                    }
                }
                SendFeeSection(review: review) { Task { await model.retryFee() } }
                DisclosureGroup(isExpanded: $detailsOpen) {
                    VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                        Eyebrow(text: SendCopy.whatWillHappen)
                        Text(review.summary).brambleText(BrambleTypeScale.body)
                        Eyebrow(text: SendCopy.riskAndRecovery)
                        ForEach(flagMessages(review), id: \.self) { message in
                            Text(message).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                        }
                    }
                    .padding(.top, BrambleSpace.sm)
                } label: {
                    Text(SendCopy.technicalDetails).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                }
                .tint(skin.muted)
                StatusLine(text: model.reviewBlock, tone: .danger)
                Text(SendCopy.reviewNote).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                PillButton(SendCopy.confirmLabel, icon: .check) { Task { await model.confirm() } }
                    .disabled(!review.canConfirm)
            }
        }
    }

    private func flagMessages(_ review: TransferReview) -> [String] {
        var messages = review.flags.map { flag in
            flag == .selfTransfer ? SendCopy.selfTransfer : SendCopy.poisonedRecipient
        }
        if review.requiresDeployment { messages.append(SendCopy.deployNote) }
        return messages.isEmpty ? [SendCopy.noWarnings] : messages
    }
}

/// `reviewFeeSection`: the first matching case of the extension's four fee states.
struct SendFeeSection: View {
    @Environment(\.skin) private var skin
    let review: TransferReview
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            Eyebrow(text: SendCopy.maximumCost)
            if review.requiresDeployment, let fee = review.fee, let deployment = review.deploymentFee {
                line(SendCopy.transactionFeePrefix + fee.display)
                line(SendCopy.deploymentFeePrefix + deployment.display)
                shortfall
            } else if review.requiresDeployment {
                failed(SendCopy.feesFailed)
            } else if let fee = review.fee {
                line(SendCopy.feePrefix + fee.display)
                shortfall
            } else {
                failed(SendCopy.feeFailed)
            }
        }
        .padding(BrambleSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
    }

    private func line(_ text: String) -> some View {
        Text(text).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
    }

    @ViewBuilder private var shortfall: some View {
        if review.affordability == .insufficient {
            Text(SendCopy.shortfall).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.warning)
        }
    }

    private func failed(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Text(text).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.danger)
            PillButton(SendCopy.retryFee, kind: .secondary, action: retry)
        }
    }
}
