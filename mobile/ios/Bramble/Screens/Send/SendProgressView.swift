import BrambleCore
import SwiftUI

/// `#send-working`: the one working screen, from authorizing to confirming, with a single title
/// and no body, task list or liveness line. The flow header names the stage ("Sending").
struct SendWorkingView: View {
    @Environment(\.skin) private var skin

    var body: some View {
        let metrics = BrambleMetrics.SendWorking.self
        VStack(spacing: metrics.gap) {
            LiquidDots()
                .foregroundStyle(skin.accent)
                .frame(width: metrics.markSize, height: metrics.markSize)
            Text(SendCopy.workingTitle)
                .brambleText(
                    BrambleTypeScale.title.sized(metrics.titleSize),
                    weight: BrambleMetrics.H2.weight,
                    tracking: BrambleMetrics.H2.tracking
                )
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, minHeight: metrics.minHeight)
        .accessibilityElement(children: .contain)
    }
}

/// `.send-outcome`: a centred mark, an optional kicker, the title and copy (with a control that
/// copies the copy when it is an error), the transaction hash row, and the stage's actions.
/// Shared by the Send outcomes and the Deploy account receipt (`outcome-receipt.ts`).
struct SendOutcomeLayout<Actions: View>: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName
    let tint: Color
    var kicker: String?
    let title: String
    var message: String?
    /// The accessible name of the control that copies `message` (the failure's "Copy the error").
    var copyMessageLabel: String?
    var hash: String?
    /// "Transaction" over the hash on a receipt; nil puts the hash row directly under the copy.
    var hashLabel: String?
    var explorerURL: URL?
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        let metrics = BrambleMetrics.SendOutcome.self
        VStack(spacing: metrics.gap) {
            BrambleIcon(icon, size: metrics.markSize / OutcomeLayout.glyphDivisor)
                .foregroundStyle(tint)
                .frame(width: metrics.markSize, height: metrics.markSize)
                .accessibilityHidden(true)
            VStack(spacing: metrics.copyGap) {
                if let kicker {
                    Text(kicker)
                        .brambleText(BrambleTypeScale.caption.sized(metrics.kickerSize), weight: metrics.kickerWeight)
                        .foregroundStyle(skin.muted)
                }
                Text(title)
                    .brambleText(
                        BrambleTypeScale.headline.sized(metrics.titleSize),
                        weight: BrambleWeight.bold,
                        tracking: BrambleTracking.display
                    )
                    .accessibilityAddTraits(.isHeader)
                if let message {
                    HStack(spacing: BrambleSpace.xs) {
                        Text(message).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                        if let copyMessageLabel { CopyButton(value: message, label: copyMessageLabel) }
                    }
                }
            }
            .multilineTextAlignment(.center)
            if let hash {
                OutcomeHashRow(hash: hash, label: hashLabel, explorerURL: explorerURL)
            }
            VStack(spacing: BrambleMetrics.Send.actionsGap) { actions() }
        }
        .frame(maxWidth: .infinity, minHeight: metrics.minHeight)
    }
}

private enum OutcomeLayout {
    /// The outcome glyph is drawn at half the mark's size.
    static let glyphDivisor: CGFloat = 2
}

/// `outcomeHashRow`: the hash truncated (`accountLabel`), linked to the explorer when the network
/// has one (opened in the system browser), and a control that copies it in full. On a receipt it
/// sits under the "Transaction" label.
struct OutcomeHashRow: View {
    @Environment(\.skin) private var skin
    let hash: String
    var label: String?
    var explorerURL: URL?

    var body: some View {
        let metrics = BrambleMetrics.SendOutcome.self
        VStack(spacing: BrambleSpace.xs) {
            if let label {
                Text(label)
                    .brambleText(BrambleTypeScale.label.sized(BrambleMetrics.Send.receiptLabelSize))
                    .foregroundStyle(skin.muted)
            }
            HStack(spacing: BrambleSpace.xs) {
                if let explorerURL {
                    Link(destination: explorerURL) { hashText(metrics).foregroundStyle(skin.accent) }
                        .accessibilityLabel(SendCopy.explorerLinkLabel)
                        .accessibilityValue(hash)
                } else {
                    hashText(metrics).foregroundStyle(skin.muted).accessibilityValue(hash)
                }
                CopyButton(value: hash, label: SendCopy.copyTransactionHash)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func hashText(_ metrics: BrambleMetrics.SendOutcome.Type) -> some View {
        Text(shortAddress(hash))
            .brambleText(BrambleTypeScale.mono.sized(metrics.hashSize), mono: true)
            .lineLimit(1)
    }
}

/// `#send-success`, `#send-pending` and `#send-failure`.
struct SendOutcomeView: View {
    @Environment(\.skin) private var skin
    let model: SendFlowModel
    let done: () -> Void
    let viewActivity: () -> Void

    var body: some View {
        switch model.stage {
        case .submitted:
            let sent = model.review.map { review in
                review.amountDisplay + " " + review.tokenSymbol + SendCopy.sentTo
                    + (model.recipientLabel ?? review.recipientShort)
            }
            SendOutcomeLayout(
                icon: .check,
                tint: skin.positive,
                title: SendCopy.successTitle,
                message: sent,
                hash: model.hash,
                hashLabel: SendCopy.transactionLabel,
                explorerURL: model.explorerURL
            ) {
                PillButton(SendCopy.viewActivity, icon: .activity, action: viewActivity)
                PillButton(SendCopy.back, kind: .secondary, action: done)
            }

        case .pending:
            SendOutcomeLayout(
                icon: .refresh,
                tint: skin.accent,
                kicker: SendCopy.pendingKicker,
                title: SendCopy.pendingTitle,
                message: SendCopy.pendingBody,
                hash: model.hash,
                explorerURL: model.explorerURL
            ) {
                PillButton(SendCopy.checkConfirmation) { Task { await model.checkAgain() } }
                PillButton(SendCopy.viewActivity, kind: .secondary, icon: .activity, action: viewActivity)
            }

        default:
            SendOutcomeLayout(
                icon: .x,
                tint: skin.danger,
                title: SendCopy.failureTitle,
                message: model.failureMessage ?? SendCopy.failureDefault,
                copyMessageLabel: SendCopy.copyError,
                hash: model.hash,
                explorerURL: model.explorerURL
            ) {
                PillButton(SendCopy.tryAgain) { Task { await model.reviewSend() } }
                PillButton(SendCopy.editTransaction, kind: .secondary) { model.edit() }
            }
        }
    }
}
