import BrambleCore
import SwiftUI

/// `.send-task-list`: the submission steps on a panel with the xs elevation, split by hairlines
/// inset past the state dot.
struct SendTaskList: View {
    @Environment(\.skin) private var skin
    let labels: [String]
    let active: Int

    var body: some View {
        let metrics = BrambleMetrics.SendWorking.self
        VStack(spacing: 0) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                HStack(spacing: metrics.taskGap) {
                    Circle()
                        .fill(index < active ? skin.positive : index == active ? skin.accent : skin.hairlineStrong)
                        .frame(width: metrics.taskDot, height: metrics.taskDot)
                        .accessibilityHidden(true)
                    Text(label)
                        .brambleText(
                            BrambleTypeScale.label.sized(metrics.taskSize),
                            weight: index == active ? BrambleWeight.semibold : BrambleWeight.regular
                        )
                        .foregroundStyle(index > active ? skin.muted : skin.text)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: metrics.taskHeight)
                .overlay(alignment: .top) {
                    if index > 0 {
                        Rectangle()
                            .fill(skin.hairline)
                            .frame(height: 1)
                            .padding(.leading, metrics.taskHairlineInset)
                            .accessibilityHidden(true)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(index < active ? "Done" : index == active ? "In progress" : "")
            }
        }
        .padding(metrics.taskListPadding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.taskListRadius, style: .continuous))
        .elevation(BrambleElevation.sendTaskList)
    }
}

/// `#send-working`: the authorizing, broadcasting and confirming screens with their task list.
struct SendWorkingView: View {
    @Environment(\.skin) private var skin
    let stage: SendFlowModel.Stage

    /// The stage's copy and its position in the task list.
    private struct Content {
        let title: String
        let copy: String
        let liveness: String
        let labels: [String]
        let active: Int
    }

    /// Index of the active row in the task list: sign, broadcast, then confirm.
    private enum ActiveTask {
        static let authorizing = 1
        static let broadcasting = 2
        static let confirming = 3
    }

    private var content: Content {
        switch stage {
        case .broadcasting:
            Content(
                title: SendCopy.workingBroadcastingTitle,
                copy: SendCopy.workingBroadcastingCopy,
                liveness: SendCopy.keepAppOpen,
                labels: [SendCopy.taskReviewLocked, SendCopy.taskSign, SendCopy.taskBroadcast, SendCopy.taskConfirm],
                active: ActiveTask.broadcasting
            )

        case .confirming:
            Content(
                title: SendCopy.workingConfirmingTitle,
                copy: SendCopy.workingConfirmingCopy,
                liveness: SendCopy.workingConfirmingLiveness,
                labels: [
                    SendCopy.taskReviewLocked,
                    SendCopy.taskAuthorized,
                    SendCopy.taskBroadcastComplete,
                    SendCopy.taskConfirm
                ],
                active: ActiveTask.confirming
            )

        default:
            Content(
                title: SendCopy.workingAuthorizingTitle,
                copy: SendCopy.workingAuthorizingCopy,
                liveness: SendCopy.keepAppOpen,
                labels: [SendCopy.taskReviewLocked, SendCopy.taskSign, SendCopy.taskBroadcast, SendCopy.taskConfirm],
                active: ActiveTask.authorizing
            )
        }
    }

    var body: some View {
        let stageContent = content
        let metrics = BrambleMetrics.SendWorking.self
        VStack(spacing: metrics.gap) {
            LiquidDots()
                .foregroundStyle(skin.accent)
                .frame(width: metrics.markSize, height: metrics.markSize)
            VStack(spacing: metrics.copyGap) {
                Text(stageContent.title)
                    .brambleText(
                        BrambleTypeScale.title.sized(metrics.titleSize),
                        weight: BrambleMetrics.H2.weight,
                        tracking: BrambleMetrics.H2.tracking
                    )
                    .accessibilityAddTraits(.isHeader)
                Text(stageContent.copy).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            }
            .multilineTextAlignment(.center)
            SendTaskList(labels: stageContent.labels, active: stageContent.active)
            Text(stageContent.liveness)
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: metrics.minHeight)
        .accessibilityElement(children: .contain)
    }
}

/// `.send-outcome`: a centred mark, kicker, title and copy, the hash, and the stage's actions.
/// Shared by the Send outcomes and the Deploy account receipt.
struct SendOutcomeLayout<Actions: View>: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName
    let tint: Color
    let kicker: String
    let title: String
    let message: String?
    let hash: String?
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
                Text(kicker)
                    .brambleText(BrambleTypeScale.caption.sized(metrics.kickerSize), weight: metrics.kickerWeight)
                    .foregroundStyle(skin.muted)
                Text(title)
                    .brambleText(
                        BrambleTypeScale.headline.sized(metrics.titleSize),
                        weight: BrambleWeight.bold,
                        tracking: BrambleTracking.display
                    )
                    .accessibilityAddTraits(.isHeader)
                if let message {
                    Text(message).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                }
                if let hash {
                    Text(hash)
                        .brambleText(BrambleTypeScale.mono.sized(metrics.hashSize), mono: true)
                        .foregroundStyle(skin.muted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .accessibilityLabel("Transaction hash \(hash)")
                }
                explorerLink
            }
            .multilineTextAlignment(.center)
            VStack(spacing: BrambleMetrics.Send.actionsGap) { actions() }
        }
        .frame(maxWidth: .infinity, minHeight: metrics.minHeight)
    }

    /// Deliberate deviation (transactions.md §2.6): the extension links only from Activity.
    @ViewBuilder private var explorerLink: some View {
        if let explorerURL {
            Link(destination: explorerURL) {
                HStack(spacing: BrambleSpace.xs) {
                    BrambleIcon(.externalLink, size: BrambleSpace.lg)
                    Text(SendCopy.explorerLinkLabel)
                        .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
                }
                .foregroundStyle(skin.accent)
                .frame(minHeight: BrambleHit.minimum)
            }
            .accessibilityLabel(SendCopy.explorerLinkLabel)
        }
    }
}

private enum OutcomeLayout {
    /// The outcome glyph is drawn at half the mark's size.
    static let glyphDivisor: CGFloat = 2
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
                review.amountDisplay + " " + review.tokenSymbol + SendCopy.sentTo + review.recipientShort
            }
            SendOutcomeLayout(
                icon: .check,
                tint: skin.positive,
                kicker: SendCopy.successKicker,
                title: SendCopy.successTitle,
                message: sent,
                hash: model.hash,
                explorerURL: model.explorerURL
            ) {
                PillButton(SendCopy.viewActivity, icon: .activity, action: viewActivity)
                PillButton(SendCopy.backToHome, kind: .secondary, action: done)
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
                kicker: SendCopy.failureKicker,
                title: SendCopy.failureTitle,
                message: model.failureMessage ?? SendCopy.failureDefault,
                hash: model.hash,
                explorerURL: model.explorerURL
            ) {
                PillButton(SendCopy.tryAgain) { Task { await model.reviewSend() } }
                PillButton(SendCopy.editTransaction, kind: .secondary) { model.edit() }
            }
        }
    }
}
