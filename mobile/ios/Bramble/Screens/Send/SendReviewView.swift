import BrambleCore
import SwiftUI

/// `.send-context-receipt`: a panel of `label · value` rows split by full-width hairlines.
struct SendReceipt: View {
    @Environment(\.skin) private var skin
    let rows: [(label: String, value: String, mono: Bool)]

    var body: some View {
        let m = BrambleMetrics.Send.self
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(spacing: m.receiptGap) {
                    Text(row.label).brambleText(BrambleTypeScale.label.sized(m.receiptLabelSize)).foregroundStyle(skin.muted)
                    Spacer(minLength: 0)
                    Text(row.value)
                        .brambleText(row.mono ? BrambleTypeScale.mono.sized(m.receiptCodeSize) : BrambleTypeScale.body,
                                     weight: row.mono ? BrambleWeight.regular : BrambleWeight.semibold, mono: row.mono)
                        .foregroundStyle(row.mono ? skin.muted : skin.text)
                        .lineLimit(1)
                }
                .frame(minHeight: m.receiptRowHeight)
                .overlay(alignment: .top) {
                    if index > 0 { Rectangle().fill(skin.hairline).frame(height: 1).accessibilityHidden(true) }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(m.receiptPadding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: m.receiptRadius, style: .continuous))
    }
}

/// `.send-details`: the accounts receipt, the amount card (asset trigger, amount, balance with
/// Half and Max), and Review send.
struct SendDetailsView: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store
    @Bindable var model: SendFlowModel

    var body: some View {
        let m = BrambleMetrics.Send.self
        let invalid = model.amountError != nil
        VStack(alignment: .leading, spacing: m.formGap) {
            Eyebrow(text: SendCopy.accountsHeading)
            SendReceipt(rows: [
                (SendCopy.fromLabel, model.account.displayName, false),
                (SendCopy.toLabel, model.recipient.map { shortAddress($0) } ?? "—", true),
                (SendCopy.networkLabel, store.networkLabel, false),
            ])
            // `.send-amount-card`: the card is the amount field, so it is flat and an invalid
            // amount turns its fill and ink to the danger tones.
            VStack(alignment: .leading, spacing: m.amountCardGap) {
                tokenTrigger
                TextField("", text: $model.amount, prompt: Text(SendCopy.amountPlaceholder).foregroundStyle(skin.muted))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .brambleText(BrambleTypeScale.amount.sized(m.amountSize), weight: m.amountWeight, tracking: BrambleTracking.amount)
                    .monospacedDigit()
                    .foregroundStyle(invalid ? skin.danger : skin.text)
                    .frame(minHeight: m.amountHeight)
                    .accessibilityLabel(SendCopy.amountLabel)
                    // Locales whose decimal pad types "," still enter the extension's "." grammar.
                    .onChange(of: model.amount) { _, text in
                        if text.contains(",") { model.amount = text.replacingOccurrences(of: ",", with: ".") }
                    }
                HStack(spacing: m.metaGap) {
                    Text(model.balanceLine).brambleText(BrambleTypeScale.caption.sized(m.metaSize)).foregroundStyle(skin.muted)
                    Spacer(minLength: 0)
                    HStack(spacing: m.shortcutsGap) {
                        shortcut(SendCopy.half) { model.fill(half: true) }
                        shortcut(SendCopy.max) { model.fill(half: false) }
                    }
                }
                Text(SendCopy.estimatedValueUnavailable)
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(m.amountCardPadding)
            .background(invalid ? skin.dangerSoft : skin.panel, in: RoundedRectangle(cornerRadius: m.amountCardRadius, style: .continuous))
            StatusLine(text: model.amountError, tone: .danger)
            PillButton(model.stage == .reviewing ? SendCopy.preparing : SendCopy.reviewLabel, icon: .send, busy: model.stage == .reviewing) {
                Task { await model.reviewSend() }
            }
            .disabled(model.amount.isEmpty)
        }
    }

    /// `.send-token-trigger`: the chosen asset as an elevated pill that opens the asset stage.
    private var tokenTrigger: some View {
        let m = BrambleMetrics.Send.self
        return Button { model.pickAsset() } label: {
            HStack(spacing: BrambleSpace.sm) {
                TokenMark(address: model.token.address, symbol: model.token.symbol)
                    .scaleEffect(m.tokenTriggerGlyph / BrambleMetrics.TokenRow.markSize)
                    .frame(width: m.tokenTriggerGlyph, height: m.tokenTriggerGlyph)
                Text(model.token.symbol).brambleText(BrambleTypeScale.body, weight: BrambleMetrics.Button.weight)
                BrambleIcon(.chevronDown, size: BrambleSpace.lg).foregroundStyle(skin.muted)
            }
            .foregroundStyle(skin.text)
            .padding(m.tokenTriggerPadding)
            .frame(minHeight: m.tokenTriggerHeight)
        }
        .buttonStyle(FillPressStyle(fill: skin.elevated, pressed: skin.softPress, shape: Capsule(), hit: CGSize(width: BrambleHit.minimum, height: m.tokenTriggerHeight)))
        .accessibilityLabel("\(SendCopy.assetLabel) \(model.token.symbol)")
    }

    /// `.send-amount-shortcuts button`: a transparent small control, 44pt to the touch.
    private func shortcut(_ title: String, action: @escaping () -> Void) -> some View {
        let m = BrambleMetrics.Send.self
        return Button(action: action) {
            Text(title)
                .brambleText(BrambleTypeScale.caption.sized(m.metaSize), weight: BrambleWeight.semibold)
                .foregroundStyle(model.rawBalance == nil ? skin.muted : skin.text)
                .padding(m.shortcutPadding)
                .frame(minHeight: m.shortcutHeight)
        }
        .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Capsule(), hit: CGSize(width: BrambleHit.minimum, height: m.shortcutHeight)))
        .disabled(model.rawBalance == nil)
        .accessibilityLabel(title)
    }
}

/// `#send-review-stage`: the summary card (asset hero and recipient with copy), the fee boundary,
/// the technical-details disclosure, and Confirm.
struct SendReviewView: View {
    @Environment(\.skin) private var skin
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let model: SendFlowModel
    @State private var copied = false
    @State private var detailsOpen = false

    var body: some View {
        let m = BrambleMetrics.SendReview.self
        if let review = model.review {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
                // `.send-review-head`: the flow header already titles the stage "Review send".
                HStack(spacing: m.headGap) {
                    Spacer()
                    PillButton(SendCopy.edit, kind: .ghost, small: true) { model.edit() }
                }
                summary(review)
                SendFeeSection(review: review) { Task { await model.retryFee() } }
                disclosure(review)
                StatusLine(text: model.reviewBlock, tone: .danger)
                Text(SendCopy.reviewNote).brambleText(BrambleTypeScale.caption.sized(m.noteSize)).foregroundStyle(skin.muted)
                PillButton(SendCopy.confirmLabel, icon: .check) { Task { await model.confirm() } }
                    .disabled(!review.canConfirm)
            }
        }
    }

    /// `.send-review-summary`: token hero over the recipient fact.
    private func summary(_ review: TransferReview) -> some View {
        let m = BrambleMetrics.SendReview.self
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: m.heroGap) {
                TokenMark(address: model.token.address, symbol: review.tokenSymbol)
                    .frame(width: m.markSize, height: m.markSize)
                VStack(alignment: .leading, spacing: m.heroCopyGap) {
                    Text("\(review.amountDisplay) \(review.tokenSymbol)")
                        .brambleText(BrambleTypeScale.display.sized(m.heroSize), weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                        .monospacedDigit()
                    Text(SendCopy.fiatUnavailable).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
            }
            .padding(.bottom, m.heroBottom)
            HStack(spacing: BrambleMetrics.Send.receiptGap) {
                Text(SendCopy.recipientRowLabel).brambleText(BrambleTypeScale.label.sized(BrambleMetrics.Send.receiptLabelSize)).foregroundStyle(skin.muted)
                Spacer(minLength: 0)
                Text(review.recipientShort)
                    .brambleText(BrambleTypeScale.mono.sized(BrambleMetrics.Send.receiptCodeSize), mono: true)
                    .foregroundStyle(skin.muted)
                    .lineLimit(1)
                IconButton(icon: copied ? .check : .copy, label: SendCopy.copyRecipient, tint: skin.muted) {
                    Clipboard.copy(review.recipient)
                    copied = true
                }
                .brambleHaptic(.success, trigger: copied) { _, new in new }
            }
            .frame(minHeight: BrambleMetrics.Send.receiptRowHeight)
            .overlay(alignment: .top) { Rectangle().fill(skin.hairline).frame(height: 1).accessibilityHidden(true) }
        }
        .padding(m.summaryPadding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: m.summaryRadius, style: .continuous))
    }

    /// `.send-review-disclosure`: technical details behind a full-width summary row.
    private func disclosure(_ review: TransferReview) -> some View {
        let m = BrambleMetrics.SendReview.self
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(BrambleMotionPolicy.animation(BrambleEase.out.animation(ms: BrambleMotion.tabMs), reduceMotion: reduceMotion)) {
                    detailsOpen.toggle()
                }
            } label: {
                HStack {
                    Text(SendCopy.technicalDetails).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold).foregroundStyle(skin.text)
                    Spacer()
                    BrambleIcon(.chevronDown).foregroundStyle(skin.muted).rotationEffect(.degrees(detailsOpen ? 180 : 0))
                }
                .padding(m.disclosurePadding)
                .frame(minHeight: m.disclosureHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(detailsOpen ? "Expanded" : "Collapsed")
            if detailsOpen {
                VStack(alignment: .leading, spacing: m.disclosureBodyGap) {
                    Eyebrow(text: SendCopy.whatWillHappen)
                    Text(review.summary).brambleText(BrambleTypeScale.body)
                    Eyebrow(text: SendCopy.riskAndRecovery)
                    ForEach(flagMessages(review), id: \.self) { message in
                        Text(message).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(m.disclosureBodyPadding)
                .overlay(alignment: .top) { Rectangle().fill(skin.hairline).frame(height: 1).accessibilityHidden(true) }
            }
        }
        .background(skin.panel, in: RoundedRectangle(cornerRadius: m.disclosureRadius, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: m.disclosureRadius, style: .continuous))
    }

    private func flagMessages(_ review: TransferReview) -> [String] {
        var messages = review.flags.map { flag in
            flag == .selfTransfer ? SendCopy.selfTransfer : SendCopy.poisonedRecipient
        }
        if review.requiresDeployment { messages.append(SendCopy.deployNote) }
        return messages.isEmpty ? [SendCopy.noWarnings] : messages
    }
}

/// `.send-review-fee` with `reviewFeeSection`: the first matching case of the extension's four
/// fee states.
struct SendFeeSection: View {
    @Environment(\.skin) private var skin
    let review: TransferReview
    let retry: () -> Void

    var body: some View {
        let m = BrambleMetrics.SendReview.self
        VStack(alignment: .leading, spacing: m.feeGap) {
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
        .padding(m.feePadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: m.feeRadius, style: .continuous))
    }

    private func line(_ text: String) -> some View {
        Text(text).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold).monospacedDigit()
    }

    @ViewBuilder private var shortfall: some View {
        if review.affordability == .insufficient {
            Text(SendCopy.shortfall).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.warning)
        }
    }

    private func failed(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.SendReview.feeGap) {
            StatusLine(text: text, tone: .danger)
            PillButton(SendCopy.retryFee, kind: .secondary, icon: .refresh, small: true, action: retry)
        }
    }
}
