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
                .background(skin.accentSoft, in: RoundedRectangle(cornerRadius: metrics.iconRadius, style: .continuous))
            VStack(alignment: .leading, spacing: metrics.copyGap) {
                Text(title).brambleText(BrambleTypeScale.body.sized(metrics.titleSize), weight: BrambleWeight.bold)
                if let message {
                    Text(message).brambleText(BrambleTypeScale.caption.sized(metrics.bodySize)).foregroundStyle(skin.muted)
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
            if role == .alert { AccessibilityNotification.Announcement([title, message].compactMap { $0 }.joined(separator: ". ")).post() }
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
                    Text(retryLabel).brambleText(BrambleTypeScale.body.sized(BrambleMetrics.ButtonSmall.fontSize), weight: BrambleMetrics.Button.weight, tracking: BrambleMetrics.Button.tracking)
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

/// `.pill`: a compact elevated capsule with an optional status dot or icon.
struct Pill: View {
    enum Tone { case neutral, accent }

    @Environment(\.skin) private var skin
    let label: String
    var dot: Bool? = nil
    var icon: BrambleIconName?
    var tone: Tone = .neutral

    var body: some View {
        let metrics = BrambleMetrics.Pill.self
        HStack(spacing: metrics.gap) {
            if let dot { StatusDot(healthy: dot) }
            if let icon { BrambleIcon(icon, size: BrambleMetrics.HardwarePill.glyph) }
            Text(label).brambleText(BrambleTypeScale.caption.sized(metrics.fontSize), weight: metrics.weight).lineLimit(1)
        }
        .foregroundStyle(tone == .accent ? skin.accent : skin.text)
        .padding(metrics.padding)
        .frame(minHeight: metrics.height)
        .background(tone == .accent ? skin.accentSoft : skin.elevated, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// `.pill-hardware`: the accent-tinted Ledger marker beside an account name.
struct HardwarePill: View {
    @Environment(\.skin) private var skin
    var label = "Ledger"

    var body: some View {
        let metrics = BrambleMetrics.HardwarePill.self
        HStack(spacing: BrambleMetrics.Pill.gap) {
            BrambleIcon(.shield, size: metrics.glyph)
            Text(label).brambleText(BrambleTypeScale.caption.sized(BrambleMetrics.Pill.fontSize), weight: BrambleMetrics.Pill.weight)
        }
        .foregroundStyle(skin.accent)
        .padding(metrics.padding)
        .frame(minHeight: metrics.height)
        .background(skin.accentSoft, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// `.badge`: a danger count. The extension throws on a negative count; here that is a
/// programming error in Debug and a hidden badge in Release.
struct CountBadge: View {
    @Environment(\.skin) private var skin
    let count: Int

    var body: some View {
        let metrics = BrambleMetrics.Badge.self
        let _ = assert(count >= 0, "CountBadge count must not be negative")
        if count > 0 {
            Text("\(count)")
                .brambleText(BrambleTypeStyle(size: metrics.fontSize, lineHeight: 1), weight: metrics.weight)
                .monospacedDigit()
                .foregroundStyle(skin.bg)
                .padding(metrics.padding)
                .frame(minWidth: metrics.minWidth)
                .background(skin.danger, in: Capsule())
                .accessibilityLabel("\(count) pending")
        }
    }
}

/// The extension's placeholder for a value it does not know yet ("—").
struct Placeholder: View {
    var style = BrambleTypeScale.body
    var weight = BrambleWeight.regular
    /// What is unknown, for VoiceOver ("Portfolio total unavailable").
    let accessibilityText: String

    var body: some View {
        Text("—").brambleText(style, weight: weight).accessibilityLabel(accessibilityText)
    }
}
