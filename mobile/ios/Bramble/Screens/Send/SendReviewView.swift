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

/// `#send-review-stage`, the confirm face (`SendReviewCopy`): the From / To / Amount facts, the
/// Cost box, the risks panel only when there is something to warn about, then Confirm. There is
/// no hero, Edit button or technical disclosure: Back returns to the details, and the reviewed
/// plan is dropped by any edit there.
struct SendReviewView: View {
    let model: SendFlowModel

    var body: some View {
        if let review = model.review {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.formGap) {
                VStack(alignment: .leading, spacing: BrambleMetrics.SendReview.stackGap) {
                    SendReviewFacts(
                        facts: SendReviewCopy.facts(
                            sender: (model.account.displayName, model.account.address),
                            recipient: (model.recipientLabel, review.recipient),
                            amount: review.amountDisplay,
                            symbol: review.tokenSymbol
                        ),
                        token: model.token
                    )
                    SendCostBox(cost: SendReviewCopy.cost(review)) { Task { await model.retryFee() } }
                    SendRisksPanel(messages: SendReviewCopy.risks(review))
                }
                StatusLine(text: model.reviewBlock, tone: .danger)
                PillButton(SendCopy.confirmLabel, icon: .check) { Task { await model.confirm() } }
                    .disabled(!review.canConfirm)
            }
        }
    }
}

/// `.send-review-summary` over `.send-review-facts`: one row per fact, split by hairlines, the
/// label on the left and the value (strong) over its detail line on the right.
struct SendReviewFacts: View {
    @Environment(\.skin) private var skin
    let facts: [SendReviewCopy.Fact]
    let token: TokenInfo

    var body: some View {
        let metrics = BrambleMetrics.SendReview.self
        VStack(spacing: 0) {
            ForEach(Array(facts.enumerated()), id: \.offset) { index, fact in
                HStack(spacing: metrics.factGap) {
                    Text(fact.label)
                        .brambleText(BrambleTypeScale.label.sized(metrics.factLabelSize))
                        .foregroundStyle(skin.muted)
                    Spacer(minLength: 0)
                    value(fact)
                }
                .frame(minHeight: metrics.factHeight)
                .overlay(alignment: .top) {
                    if index > 0 { Rectangle().fill(skin.hairline).frame(height: 1).accessibilityHidden(true) }
                }
                .accessibilityElement(children: .contain)
            }
        }
        .padding(metrics.summaryPadding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.summaryRadius, style: .continuous))
    }

    private func value(_ fact: SendReviewCopy.Fact) -> some View {
        let metrics = BrambleMetrics.SendReview.self
        return VStack(alignment: .trailing, spacing: BrambleMetrics.Send.rowCopyGap) {
            HStack(spacing: metrics.amountGap) {
                if fact.kind == .amount {
                    TokenMark(address: token.address, symbol: token.symbol)
                        .scaleEffect(metrics.amountGlyph / BrambleMetrics.TokenRow.markSize)
                        .frame(width: metrics.amountGlyph, height: metrics.amountGlyph)
                }
                Text(fact.value)
                    .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            HStack(spacing: BrambleMetrics.Send.rowCopyGap) {
                // The amount's line is prose (the fiat estimate); the others are addresses.
                let code = fact.kind != .amount
                Text(fact.detail)
                    .brambleText(
                        code ? BrambleTypeScale.mono.sized(metrics.factCodeSize) : BrambleTypeScale.caption,
                        mono: code
                    )
                    .foregroundStyle(skin.muted)
                    .lineLimit(1)
                if let copy = fact.copy {
                    CopyButton(value: copy, label: SendCopy.copyRecipient)
                }
            }
            if let reveal = fact.reveal {
                AddressReveal(reveal: reveal)
            }
        }
    }
}

/// `details.address-reveal`: a native disclosure that shows the full address in place, selectable,
/// so the reviewer can check every character without leaving the review.
private struct AddressReveal: View {
    @Environment(\.skin) private var skin
    let reveal: SendReviewCopy.Reveal

    var body: some View {
        DisclosureGroup {
            Text(reveal.address)
                .brambleText(BrambleTypeScale.mono.sized(BrambleMetrics.SendReview.factCodeSize), mono: true)
                .foregroundStyle(skin.text)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        } label: {
            Text(reveal.label)
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.muted)
        }
        .tint(skin.muted)
    }
}

/// `.send-review-fee > .decision-layer`: the Cost box. Known fees read the total first and the
/// deployment's share quieter under it; a failed estimate reads its alert with Retry.
struct SendCostBox: View {
    @Environment(\.skin) private var skin
    let cost: SendReviewCopy.Cost
    let retry: () -> Void

    var body: some View {
        let metrics = BrambleMetrics.SendReview.self
        VStack(alignment: .leading, spacing: metrics.feeGap) {
            Eyebrow(text: SendCopy.cost)
            ForEach(Array(cost.lines.enumerated()), id: \.offset) { index, line in
                if index == 0 {
                    Text(line).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold).monospacedDigit()
                } else {
                    Text(line).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted).monospacedDigit()
                }
            }
            if let failure = cost.failure {
                StatusLine(text: failure, tone: .danger)
                PillButton(SendCopy.retryFee, kind: .secondary, icon: .refresh, small: true, action: retry)
            }
            if cost.shortfall {
                Text(SendCopy.shortfall).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.warning)
            }
        }
        .padding(metrics.feeLayerPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.feeLayerRadius, style: .continuous))
    }
}

/// `reviewPanel`: "Risk and recovery" and one alert line per warning. Renders nothing when there
/// is nothing to warn about, so the confirm face stays quiet unless something needs saying.
struct SendRisksPanel: View {
    @Environment(\.skin) private var skin
    let messages: [String]

    var body: some View {
        if !messages.isEmpty {
            let metrics = BrambleMetrics.SendReview.self
            VStack(alignment: .leading, spacing: metrics.feeGap) {
                Eyebrow(text: SendCopy.riskAndRecovery)
                ForEach(messages, id: \.self) { message in
                    HStack(alignment: .firstTextBaseline, spacing: BrambleSpace.sm) {
                        BrambleIcon(.alert, size: BrambleControl.icon).accessibilityHidden(true)
                        Text(message).brambleText(BrambleTypeScale.caption)
                    }
                    .foregroundStyle(skin.danger)
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(metrics.feeLayerPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.feeLayerRadius, style: .continuous))
        }
    }
}
