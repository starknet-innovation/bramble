import BrambleCore
import SwiftUI

/// `.send-context-receipt`: a panel of `label · value` rows split by full-width hairlines.
struct SendReceipt: View {
    @Environment(\.skin) private var skin
    let rows: [Row]

    /// One `label · value` row; `mono` sets the value in the code face.
    struct Row {
        let label: String
        let value: String
        let mono: Bool

        init(_ label: String, _ value: String, mono: Bool = false) {
            self.label = label
            self.value = value
            self.mono = mono
        }
    }

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(spacing: metrics.receiptGap) {
                    Text(row.label)
                        .brambleText(BrambleTypeScale.label.sized(metrics.receiptLabelSize))
                        .foregroundStyle(skin.muted)
                    Spacer(minLength: 0)
                    Text(row.value)
                        .brambleText(
                            row.mono ? BrambleTypeScale.mono.sized(metrics.receiptCodeSize) : BrambleTypeScale.body,
                            weight: row.mono ? BrambleWeight.regular : BrambleWeight.semibold,
                            mono: row.mono
                        )
                        .foregroundStyle(row.mono ? skin.muted : skin.text)
                        .lineLimit(1)
                }
                .frame(minHeight: metrics.receiptRowHeight)
                .overlay(alignment: .top) {
                    if index > 0 { Rectangle().fill(skin.hairline).frame(height: 1).accessibilityHidden(true) }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(metrics.receiptPadding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.receiptRadius, style: .continuous))
    }
}

/// `.send-details`: the accounts receipt, the amount card (asset trigger, amount, balance with
/// Half and Max), and Review send.
struct SendDetailsView: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store
    @Bindable var model: SendFlowModel

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        let invalid = model.amountError != nil
        VStack(alignment: .leading, spacing: metrics.formGap) {
            Eyebrow(text: SendCopy.accountsHeading)
            SendReceipt(rows: [
                SendReceipt.Row(SendCopy.fromLabel, model.account.displayName),
                SendReceipt.Row(SendCopy.toLabel, model.recipient.map { shortAddress($0) } ?? "—", mono: true),
                SendReceipt.Row(SendCopy.networkLabel, store.networkLabel)
            ])
            amountCard(invalid: invalid)
            StatusLine(text: model.amountError, tone: .danger)
            PillButton(
                model.stage == .reviewing ? SendCopy.preparing : SendCopy.reviewLabel,
                icon: .send,
                busy: model.stage == .reviewing
            ) {
                Task { await model.reviewSend() }
            }
            .disabled(model.amount.isEmpty)
        }
    }

    /// `.send-amount-card`: the card is the amount field, so it is flat and an invalid
    /// amount turns its fill and ink to the danger tones.
    private func amountCard(invalid: Bool) -> some View {
        let metrics = BrambleMetrics.Send.self
        return VStack(alignment: .leading, spacing: metrics.amountCardGap) {
            tokenTrigger
            TextField(
                "",
                text: $model.amount,
                prompt: Text(SendCopy.amountPlaceholder).foregroundStyle(skin.muted)
            )
            .keyboardType(.decimalPad)
            .multilineTextAlignment(.trailing)
            .brambleText(
                BrambleTypeScale.amount.sized(metrics.amountSize),
                weight: metrics.amountWeight,
                tracking: BrambleTracking.amount
            )
            .monospacedDigit()
            .foregroundStyle(invalid ? skin.danger : skin.text)
            .frame(minHeight: metrics.amountHeight)
            .accessibilityLabel(SendCopy.amountLabel)
            // Locales whose decimal pad types "," still enter the extension's "." grammar.
            .onChange(of: model.amount) { _, text in
                if text.contains(",") {
                    model.amount = text.replacingOccurrences(of: ",", with: ".")
                }
            }
            HStack(spacing: metrics.metaGap) {
                Text(model.balanceLine)
                    .brambleText(BrambleTypeScale.caption.sized(metrics.metaSize))
                    .foregroundStyle(skin.muted)
                Spacer(minLength: 0)
                HStack(spacing: metrics.shortcutsGap) {
                    shortcut(SendCopy.half) { model.fill(half: true) }
                    shortcut(SendCopy.max) { model.fill(half: false) }
                }
            }
            Text(SendCopy.estimatedValueUnavailable)
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.muted)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(metrics.amountCardPadding)
        .background(
            invalid ? skin.dangerSoft : skin.panel,
            in: RoundedRectangle(cornerRadius: metrics.amountCardRadius, style: .continuous)
        )
    }

    /// `.send-token-trigger`: the chosen asset as an elevated pill that opens the asset stage.
    private var tokenTrigger: some View {
        let metrics = BrambleMetrics.Send.self
        return Button { model.pickAsset() } label: {
            HStack(spacing: BrambleSpace.sm) {
                TokenMark(address: model.token.address, symbol: model.token.symbol)
                    .scaleEffect(metrics.tokenTriggerGlyph / BrambleMetrics.TokenRow.markSize)
                    .frame(width: metrics.tokenTriggerGlyph, height: metrics.tokenTriggerGlyph)
                Text(model.token.symbol).brambleText(BrambleTypeScale.body, weight: BrambleMetrics.Button.weight)
                BrambleIcon(.chevronDown, size: BrambleSpace.lg).foregroundStyle(skin.muted)
            }
            .foregroundStyle(skin.text)
            .padding(metrics.tokenTriggerPadding)
            .frame(minHeight: metrics.tokenTriggerHeight)
        }
        .buttonStyle(
            FillPressStyle(
                fill: skin.elevated,
                pressed: skin.softPress,
                shape: Capsule(),
                hit: CGSize(width: BrambleHit.minimum, height: metrics.tokenTriggerHeight)
            )
        )
        .accessibilityLabel("\(SendCopy.assetLabel) \(model.token.symbol)")
    }

    /// `.send-amount-shortcuts button`: a transparent small control, 44pt to the touch.
    private func shortcut(_ title: String, action: @escaping () -> Void) -> some View {
        let metrics = BrambleMetrics.Send.self
        return Button(action: action) {
            Text(title)
                .brambleText(BrambleTypeScale.caption.sized(metrics.metaSize), weight: BrambleWeight.semibold)
                .foregroundStyle(model.rawBalance == nil ? skin.muted : skin.text)
                .padding(metrics.shortcutPadding)
                .frame(minHeight: metrics.shortcutHeight)
        }
        .buttonStyle(
            FillPressStyle(
                fill: .clear,
                pressed: skin.softPress,
                shape: Capsule(),
                hit: CGSize(width: BrambleHit.minimum, height: metrics.shortcutHeight)
            )
        )
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

    /// The disclosure chevron turns to point up while the details are open.
    private static let openChevronDegrees: Double = 180

    var body: some View {
        let metrics = BrambleMetrics.SendReview.self
        if let review = model.review {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
                // `.send-review-head`: the flow header already titles the stage "Review send".
                HStack(spacing: metrics.headGap) {
                    Spacer()
                    PillButton(SendCopy.edit, kind: .ghost, small: true) { model.edit() }
                }
                summary(review)
                SendFeeSection(review: review) { Task { await model.retryFee() } }
                disclosure(review)
                StatusLine(text: model.reviewBlock, tone: .danger)
                Text(SendCopy.reviewNote)
                    .brambleText(BrambleTypeScale.caption.sized(metrics.noteSize))
                    .foregroundStyle(skin.muted)
                PillButton(SendCopy.confirmLabel, icon: .check) { Task { await model.confirm() } }
                    .disabled(!review.canConfirm)
            }
        }
    }

    /// `.send-review-summary`: token hero over the recipient fact.
    private func summary(_ review: TransferReview) -> some View {
        let metrics = BrambleMetrics.SendReview.self
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: metrics.heroGap) {
                TokenMark(address: model.token.address, symbol: review.tokenSymbol)
                    .frame(width: metrics.markSize, height: metrics.markSize)
                VStack(alignment: .leading, spacing: metrics.heroCopyGap) {
                    Text("\(review.amountDisplay) \(review.tokenSymbol)")
                        .brambleText(
                            BrambleTypeScale.display.sized(metrics.heroSize),
                            weight: BrambleWeight.bold,
                            tracking: BrambleTracking.display
                        )
                        .monospacedDigit()
                    Text(SendCopy.fiatUnavailable).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
            }
            .padding(.bottom, metrics.heroBottom)
            HStack(spacing: BrambleMetrics.Send.receiptGap) {
                Text(SendCopy.recipientRowLabel)
                    .brambleText(BrambleTypeScale.label.sized(BrambleMetrics.Send.receiptLabelSize))
                    .foregroundStyle(skin.muted)
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
        .padding(metrics.summaryPadding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.summaryRadius, style: .continuous))
    }

    /// `.send-review-disclosure`: technical details behind a full-width summary row.
    private func disclosure(_ review: TransferReview) -> some View {
        let metrics = BrambleMetrics.SendReview.self
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                let motion = BrambleMotionPolicy.animation(
                    BrambleEase.out.animation(ms: BrambleMotion.tabMs),
                    reduceMotion: reduceMotion
                )
                withAnimation(motion) {
                    detailsOpen.toggle()
                }
            } label: {
                HStack {
                    Text(SendCopy.technicalDetails)
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                        .foregroundStyle(skin.text)
                    Spacer()
                    BrambleIcon(.chevronDown)
                        .foregroundStyle(skin.muted)
                        .rotationEffect(.degrees(detailsOpen ? Self.openChevronDegrees : 0))
                }
                .padding(metrics.disclosurePadding)
                .frame(minHeight: metrics.disclosureHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(detailsOpen ? "Expanded" : "Collapsed")
            if detailsOpen {
                VStack(alignment: .leading, spacing: metrics.disclosureBodyGap) {
                    Eyebrow(text: SendCopy.whatWillHappen)
                    Text(review.summary).brambleText(BrambleTypeScale.body)
                    Eyebrow(text: SendCopy.riskAndRecovery)
                    ForEach(flagMessages(review), id: \.self) { message in
                        Text(message).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(metrics.disclosureBodyPadding)
                .overlay(alignment: .top) { Rectangle().fill(skin.hairline).frame(height: 1).accessibilityHidden(true) }
            }
        }
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.disclosureRadius, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: metrics.disclosureRadius, style: .continuous))
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
        let metrics = BrambleMetrics.SendReview.self
        VStack(alignment: .leading, spacing: metrics.feeGap) {
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
        .padding(metrics.feePadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.feeRadius, style: .continuous))
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
