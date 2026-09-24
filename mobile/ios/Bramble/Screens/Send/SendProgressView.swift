import BrambleCore
import SwiftUI

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
        VStack(alignment: .leading, spacing: BrambleSpace.lg) {
            ProgressView().tint(skin.accent).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: BrambleSpace.xs) {
                Text(content.title).brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                Text(content.copy).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            }
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                ForEach(Array(content.labels.enumerated()), id: \.offset) { index, label in
                    HStack(spacing: BrambleSpace.sm) {
                        Circle()
                            .fill(index < content.active ? skin.positive : index == content.active ? skin.accent : skin.hairlineStrong)
                            .frame(width: 8, height: 8)
                        Text(label).brambleText(BrambleTypeScale.body, weight: index == content.active ? BrambleWeight.semibold : BrambleWeight.regular)
                            .foregroundStyle(index > content.active ? skin.muted : skin.text)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            Text(content.liveness).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
        }
        .accessibilityElement(children: .contain)
    }
}

/// `#send-success`, `#send-pending` and `#send-failure`.
struct SendOutcomeView: View {
    @Environment(\.skin) private var skin
    let model: SendFlowModel
    let done: () -> Void
    let viewActivity: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            switch model.stage {
            case .submitted:
                heading(icon: .check, tint: skin.positive, kicker: SendCopy.successKicker, title: SendCopy.successTitle)
                if let review = model.review {
                    Text(review.amountDisplay + " " + review.tokenSymbol + SendCopy.sentTo + review.recipientShort)
                        .brambleText(BrambleTypeScale.body)
                }
                hashBlock
                PillButton(SendCopy.viewActivity, icon: .activity, action: viewActivity)
                PillButton(SendCopy.backToHome, kind: .secondary, action: done)
            case .pending:
                heading(icon: .refresh, tint: skin.accent, kicker: SendCopy.pendingKicker, title: SendCopy.pendingTitle)
                Text(SendCopy.pendingBody).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                hashBlock
                PillButton(SendCopy.checkConfirmation) { Task { await model.checkAgain() } }
                PillButton(SendCopy.viewActivity, kind: .secondary, icon: .activity, action: viewActivity)
            default:
                heading(icon: .x, tint: skin.danger, kicker: SendCopy.failureKicker, title: SendCopy.failureTitle)
                Text(model.failureMessage ?? SendCopy.failureDefault).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                hashBlock
                PillButton(SendCopy.tryAgain) { Task { await model.reviewSend() } }
                PillButton(SendCopy.editTransaction, kind: .secondary) { model.edit() }
            }
        }
    }

    private func heading(icon: BrambleIconName, tint: Color, kicker: String, title: String) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            BrambleIcon(icon, size: 28).foregroundStyle(tint)
                .frame(width: 56, height: 56)
                .background(tint.opacity(0.14), in: Circle())
            Eyebrow(text: kicker)
            Text(title).brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
        }
    }

    @ViewBuilder private var hashBlock: some View {
        if let hash = model.hash {
            Text(hash).brambleText(BrambleTypeScale.mono, mono: true).foregroundStyle(skin.muted).textSelection(.enabled)
            // Deliberate deviation (transactions.md §2.6): the extension links only from Activity.
            if let url = model.explorerURL {
                Link(destination: url) {
                    HStack(spacing: BrambleSpace.xs) {
                        BrambleIcon(.externalLink, size: 14)
                        Text(SendCopy.explorerLinkLabel).brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
                    }
                    .foregroundStyle(skin.accent)
                }
                .accessibilityLabel(SendCopy.explorerLinkLabel)
            }
        }
    }
}
