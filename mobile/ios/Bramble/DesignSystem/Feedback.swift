import SwiftUI

// Feedback components from `styles-components.ts`: callouts, empty states, the panel error with its
// retry, pills and count badges, and the unknown-value placeholder. Every metric is read from the
// stylesheet (`BrambleMetrics`); nothing here carries a shadow, as in the extension.

/// `.callout`: a panel row with an accent-soft icon chip, a title and a caption.
struct Callout: View {
    enum Role { case note, status, alert }

    @Environment(\.skin) private var skin
    let icon: BrambleIconName
    let title: String
    var message: String?
    var role: Role = .note
    var action: (label: String, run: () -> Void)?

    var body: some View {
        let metrics = BrambleMetrics.Callout.self
        HStack(spacing: metrics.gap) {
            BrambleIcon(icon)
                .foregroundStyle(skin.accent)
                .frame(width: metrics.iconSize, height: metrics.iconSize)
                .background(
                    skin.accentSoft,
                    in: RoundedRectangle(cornerRadius: metrics.iconRadius, style: .continuous)
                )
            VStack(alignment: .leading, spacing: metrics.copyGap) {
                Text(title)
                    .brambleText(BrambleTypeScale.body.sized(metrics.titleSize), weight: BrambleWeight.bold)
                if let message {
                    Text(message)
                        .brambleText(BrambleTypeScale.caption.sized(metrics.bodySize))
                        .foregroundStyle(skin.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(role == .status ? .updatesFrequently : [])
            if let action {
                PillButton(action.label, kind: .ghost, small: true, action: action.run)
            }
        }
        .padding(metrics.padding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.radius, style: .continuous))
        .onAppear {
            if role == .alert {
                let announcement = [title, message].compactMap(\.self).joined(separator: ". ")
                AccessibilityNotification.Announcement(announcement).post()
            }
        }
    }
}

/// `.empty`: centred muted copy with no box and no icon — an empty list is an absence.
struct EmptyState: View {
    @Environment(\.skin) private var skin
    let message: String

    var body: some View {
        let metrics = BrambleMetrics.Empty.self
        Text(message)
            .brambleText(BrambleTypeStyle(size: metrics.fontSize, lineHeight: metrics.lineHeight))
            .foregroundStyle(skin.muted)
            .multilineTextAlignment(.center)
            .padding(metrics.padding)
            .frame(maxWidth: .infinity)
    }
}

/// `.panel-error`: the failure copy centred over a small ghost "Try again" with the refresh glyph.
/// `message` is display text only (callers pass `describe(error)`, which never echoes input).
struct ErrorPanel: View {
    let message: String
    var retryLabel = "Try again"
    /// What the retry does, for VoiceOver ("Retry loading balances").
    let retryHint: String
    var busy = false
    let retry: () -> Void

    var body: some View {
        VStack(spacing: BrambleMetrics.ErrorPanel.gap) {
            EmptyState(message: message)
            Button(action: retry) {
                HStack(spacing: BrambleMetrics.ErrorPanel.buttonGap) {
                    BusyRefreshIcon(spinning: busy)
                    Text(retryLabel)
                        .brambleText(
                            BrambleTypeScale.body.sized(BrambleMetrics.ButtonSmall.fontSize),
                            weight: BrambleMetrics.Button.weight,
                            tracking: BrambleMetrics.Button.tracking
                        )
                }
                .padding(BrambleMetrics.ButtonSmall.padding)
                .frame(minHeight: BrambleMetrics.ButtonSmall.height)
            }
            .buttonStyle(GhostSmallStyle())
            .disabled(busy)
            .accessibilityHint(retryHint)
        }
    }
}

private struct GhostSmallStyle: ButtonStyle {
    @Environment(\.skin) private var skin

    func makeBody(configuration: Configuration) -> some View {
        FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Capsule(), hit: nil)
            .makeBody(configuration: configuration)
            .foregroundStyle(skin.muted)
    }
}
