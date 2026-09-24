import BrambleCore
import SwiftUI

/// `.send-task-list`: the submission steps on a panel with the xs elevation, split by hairlines
/// inset past the state dot.
struct SendTaskList: View {
    @Environment(\.skin) private var skin
    let labels: [String]
    let active: Int

    var body: some View {
        let m = BrambleMetrics.SendWorking.self
        VStack(spacing: 0) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                HStack(spacing: m.taskGap) {
                    Circle()
                        .fill(index < active ? skin.positive : index == active ? skin.accent : skin.hairlineStrong)
                        .frame(width: m.taskDot, height: m.taskDot)
                        .accessibilityHidden(true)
                    Text(label)
                        .brambleText(BrambleTypeScale.label.sized(m.taskSize), weight: index == active ? BrambleWeight.semibold : BrambleWeight.regular)
                        .foregroundStyle(index > active ? skin.muted : skin.text)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: m.taskHeight)
                .overlay(alignment: .top) {
                    if index > 0 {
                        Rectangle().fill(skin.hairline).frame(height: 1).padding(.leading, m.taskHairlineInset).accessibilityHidden(true)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(index < active ? "Done" : index == active ? "In progress" : "")
            }
        }
        .padding(m.taskListPadding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: m.taskListRadius, style: .continuous))
        .elevation(BrambleElevation.sendTaskList)
    }
}

/// `#send-working`: the authorizing, broadcasting and confirming screens with their task list.
struct SendWorkingView: View {
    @Environment(\.skin) private var skin
    let stage: SendFlowModel.Stage

    private var content: (title: String, copy: String, liveness: String, labels: [String], active: Int) {
        switch stage {
        case .broadcasting:
            (SendCopy.workingBroadcastingTitle, SendCopy.workingBroadcastingCopy, SendCopy.keepAppOpen,
             [SendCopy.taskReviewLocked, SendCopy.taskSign, SendCopy.taskBroadcast, SendCopy.taskConfirm], 2)
        case .confirming:
            (SendCopy.workingConfirmingTitle, SendCopy.workingConfirmingCopy, SendCopy.workingConfirmingLiveness,
             [SendCopy.taskReviewLocked, SendCopy.taskAuthorized, SendCopy.taskBroadcastComplete, SendCopy.taskConfirm], 3)
        default:
            (SendCopy.workingAuthorizingTitle, SendCopy.workingAuthorizingCopy, SendCopy.keepAppOpen,
             [SendCopy.taskReviewLocked, SendCopy.taskSign, SendCopy.taskBroadcast, SendCopy.taskConfirm], 1)
        }
    }

    var body: some View {
        let content = content
        let m = BrambleMetrics.SendWorking.self
        VStack(spacing: m.gap) {
            LiquidDots()
                .foregroundStyle(skin.accent)
                .frame(width: m.markSize, height: m.markSize)
            VStack(spacing: m.copyGap) {
                Text(content.title)
                    .brambleText(BrambleTypeScale.title.sized(m.titleSize), weight: BrambleMetrics.H2.weight, tracking: BrambleMetrics.H2.tracking)
                    .accessibilityAddTraits(.isHeader)
                Text(content.copy).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            }
            .multilineTextAlignment(.center)
            SendTaskList(labels: content.labels, active: content.active)
            Text(content.liveness).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: m.minHeight)
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
        let m = BrambleMetrics.SendOutcome.self
        VStack(spacing: m.gap) {
            BrambleIcon(icon, size: m.markSize / 2)
                .foregroundStyle(tint)
                .frame(width: m.markSize, height: m.markSize)
                .accessibilityHidden(true)
            VStack(spacing: m.copyGap) {
                Text(kicker)
                    .brambleText(BrambleTypeScale.caption.sized(m.kickerSize), weight: m.kickerWeight)
                    .foregroundStyle(skin.muted)
                Text(title)
                    .brambleText(BrambleTypeScale.headline.sized(m.titleSize), weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                    .accessibilityAddTraits(.isHeader)
                if let message {
                    Text(message).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                }
                if let hash {
                    Text(hash)
                        .brambleText(BrambleTypeScale.mono.sized(m.hashSize), mono: true)
                        .foregroundStyle(skin.muted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .accessibilityLabel("Transaction hash \(hash)")
                }
                // Deliberate deviation (transactions.md §2.6): the extension links only from Activity.
                if let explorerURL {
                    Link(destination: explorerURL) {
                        HStack(spacing: BrambleSpace.xs) {
                            BrambleIcon(.externalLink, size: BrambleSpace.lg)
                            Text(SendCopy.explorerLinkLabel).brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
                        }
                        .foregroundStyle(skin.accent)
                        .frame(minHeight: BrambleHit.minimum)
                    }
                    .accessibilityLabel(SendCopy.explorerLinkLabel)
                }
            }
            .multilineTextAlignment(.center)
            VStack(spacing: BrambleMetrics.Send.actionsGap) { actions() }
        }
        .frame(maxWidth: .infinity, minHeight: m.minHeight)
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
            let sent = model.review.map { $0.amountDisplay + " " + $0.tokenSymbol + SendCopy.sentTo + $0.recipientShort }
            SendOutcomeLayout(icon: .check, tint: skin.positive, kicker: SendCopy.successKicker, title: SendCopy.successTitle,
                              message: sent, hash: model.hash, explorerURL: model.explorerURL) {
                PillButton(SendCopy.viewActivity, icon: .activity, action: viewActivity)
                PillButton(SendCopy.backToHome, kind: .secondary, action: done)
            }
        case .pending:
            SendOutcomeLayout(icon: .refresh, tint: skin.accent, kicker: SendCopy.pendingKicker, title: SendCopy.pendingTitle,
                              message: SendCopy.pendingBody, hash: model.hash, explorerURL: model.explorerURL) {
                PillButton(SendCopy.checkConfirmation) { Task { await model.checkAgain() } }
                PillButton(SendCopy.viewActivity, kind: .secondary, icon: .activity, action: viewActivity)
            }
        default:
            SendOutcomeLayout(icon: .x, tint: skin.danger, kicker: SendCopy.failureKicker, title: SendCopy.failureTitle,
                              message: model.failureMessage ?? SendCopy.failureDefault, hash: model.hash, explorerURL: model.explorerURL) {
                PillButton(SendCopy.tryAgain) { Task { await model.reviewSend() } }
                PillButton(SendCopy.editTransaction, kind: .secondary) { model.edit() }
            }
        }
    }
}
