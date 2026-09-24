import BrambleCore
import SwiftUI

// Structural components from `styles-base.ts`: grouped menu lists with inset hairlines, the flow
// header with its network pill, and the onboarding badge, option card, and detail row.

/// `.menu-list`: one panel per group, rows split by hairlines inset from the leading edge. Flat:
/// the extension gives grouped lists no shadow.
struct MenuGroup<Content: View>: View {
    @Environment(\.skin) private var skin
    @ViewBuilder let content: () -> Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: BrambleMetrics.MenuList.radius, style: .continuous)
        VStack(spacing: 0) {
            _VariadicView.Tree(DividedRows(hairline: skin.hairline)) { content() }
        }
        .background(skin.panel, in: shape)
        .clipShape(shape)
    }
}

private struct DividedRows: _VariadicView_MultiViewRoot {
    let hairline: Color

    func body(children: _VariadicView.Children) -> some View {
        ForEach(Array(children.enumerated()), id: \.element.id) { index, child in
            child.overlay(alignment: .top) {
                if index > 0 {
                    Rectangle().fill(hairline).frame(height: 1).padding(.leading, BrambleMetrics.MenuList.hairlineInset)
                        .accessibilityHidden(true)
                }
            }
        }
    }
}

/// `button.menu-row` / `button.option-row`: icon, label, optional trailing value, chevron or check.
struct MenuRow: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName?
    let title: String
    var value: String?
    var tone: Color?
    var selected = false
    var chevron = true
    var hint: String?
    let action: () -> Void

    var body: some View {
        let metrics = BrambleMetrics.MenuRow.self
        Button(action: action) {
            HStack(spacing: metrics.gap) {
                if let icon {
                    BrambleIcon(icon, size: metrics.glyph).foregroundStyle(tone ?? skin.muted)
                }
                Text(title)
                    .brambleText(BrambleTypeScale.body.sized(metrics.titleSize), weight: metrics.titleWeight)
                    .foregroundStyle(tone ?? skin.text)
                Spacer(minLength: metrics.gap)
                if let value {
                    Text(value).brambleText(BrambleTypeScale.caption.sized(metrics.valueSize)).foregroundStyle(skin.muted).lineLimit(1)
                }
                if selected {
                    BrambleIcon(.check).foregroundStyle(skin.accent)
                } else if chevron {
                    BrambleIcon(.chevronRight).foregroundStyle(skin.muted)
                }
            }
            .padding(metrics.padding)
            .frame(minHeight: metrics.height)
        }
        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: metrics.radius, style: .continuous), scale: 1))
        .accessibilityLabel(title)
        .accessibilityValue(value ?? "")
        .accessibilityHint(hint ?? "")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// `.dot`: the network status dot, positive when the network answered, warning while degraded.
/// The degraded dot pulses (`network-status-pulse`), except under Reduce Motion.
struct StatusDot: View {
    @Environment(\.skin) private var skin
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var healthy = true
    var size: CGFloat = BrambleMetrics.Dot.size
    @State private var dim = false

    var body: some View {
        Circle()
            .fill(healthy ? skin.positive : skin.warning)
            .frame(width: size, height: size)
            .opacity(!healthy && dim && !reduceMotion ? BrambleMetrics.Dot.degradedPulseOpacity : 1)
            .onAppear { dim = true }
            .animation(healthy || reduceMotion ? nil : BrambleEase.inOut.animation(ms: BrambleMetrics.Dot.degradedPulseMs / 2).repeatForever(), value: dim)
            .accessibilityHidden(true)
    }
}

/// `.pill` with the network dot.
struct NetworkPill: View {
    @Environment(\.skin) private var skin
    let label: String
    var healthy = true

    var body: some View {
        let metrics = BrambleMetrics.Pill.self
        HStack(spacing: metrics.gap) {
            StatusDot(healthy: healthy)
            Text(label).brambleText(BrambleTypeScale.caption.sized(metrics.fontSize), weight: metrics.weight).lineLimit(1)
        }
        .padding(metrics.padding)
        .frame(minHeight: metrics.height)
        .background(skin.elevated, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Network: \(label)")
    }
}

/// `.flow-header`: back control, title (`h1`) and subtitle, network pill.
struct FlowHeader: View {
    @Environment(\.skin) private var skin
    let title: String
    var subtitle: String?
    var network: String?
    let back: () -> Void

    var body: some View {
        let metrics = BrambleMetrics.FlowHeader.self
        HStack(alignment: .center, spacing: metrics.gap) {
            IconButton(icon: .chevronLeft, label: "Back", tint: skin.text, action: back)
            VStack(alignment: .leading, spacing: metrics.titleGap) {
                Text(title)
                    .brambleText(BrambleTypeScale.display.sized(metrics.titleSize), weight: BrambleMetrics.H1.weight, tracking: BrambleMetrics.H1.tracking)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle).brambleText(BrambleTypeScale.caption.sized(metrics.subtitleSize)).foregroundStyle(skin.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let network { NetworkPill(label: network) }
        }
        .padding(metrics.padding)
    }
}

/// `.onboarding-step-icon`: an elevated disc around the step's icon.
struct Medallion: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName

    var body: some View {
        BrambleIcon(icon, size: BrambleMetrics.Onboarding.iconGlyph)
            .foregroundStyle(skin.text)
            .frame(width: BrambleMetrics.Onboarding.iconSize, height: BrambleMetrics.Onboarding.iconSize)
            .background(skin.elevated, in: Circle())
            .accessibilityHidden(true)
    }
}

/// `.onboarding-option`: elevated card with an icon disc, copy, and chevron.
struct OptionCard: View {
    @Environment(\.skin) private var skin
    @Environment(\.isEnabled) private var enabled
    let icon: BrambleIconName
    let title: String
    let detail: String
    let action: () -> Void

    var body: some View {
        let metrics = BrambleMetrics.OnboardingOption.self
        Button(action: action) {
            HStack(spacing: metrics.gap) {
                BrambleIcon(icon, size: metrics.iconGlyph).foregroundStyle(skin.text)
                    .frame(width: metrics.iconSize, height: metrics.iconSize)
                    .background(skin.panel, in: Circle())
                VStack(alignment: .leading, spacing: metrics.copyGap) {
                    Text(title).brambleText(BrambleTypeScale.body.sized(metrics.titleSize), weight: metrics.titleWeight).foregroundStyle(skin.text)
                    // The copy sits inside a `button`, so it inherits the button's weight.
                    Text(detail)
                        .brambleText(BrambleTypeStyle(size: metrics.detailSize, lineHeight: metrics.detailLineHeight), weight: BrambleMetrics.Button.weight)
                        .foregroundStyle(skin.muted).multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                BrambleIcon(.chevronRight, size: metrics.chevron).foregroundStyle(skin.muted)
            }
            .padding(metrics.padding)
            .frame(minHeight: metrics.height)
        }
        .buttonStyle(FillPressStyle(fill: skin.elevated, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)))
        .opacity(enabled ? 1 : 0.5)
        .accessibilityLabel(title)
        .accessibilityHint(detail)
    }
}

/// `.onboarding-complete-detail`: an elevated row with an icon and a caption.
struct DetailRow: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName
    let text: String

    var body: some View {
        let metrics = BrambleMetrics.Complete.self
        HStack(spacing: metrics.detailGap) {
            BrambleIcon(icon, size: metrics.detailGlyph).foregroundStyle(skin.text)
            Text(text).brambleText(BrambleTypeScale.caption.sized(metrics.detailSize)).foregroundStyle(skin.muted).multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(metrics.detailPadding)
        .frame(minHeight: metrics.detailHeight)
        .background(skin.elevated, in: RoundedRectangle(cornerRadius: metrics.detailRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

extension BrambleSkin {
    var tokenMarkFills: [Color] { [tokenMark0Fill, tokenMark1Fill, tokenMark2Fill, tokenMark3Fill] }
    var tokenMarkInks: [Color] { [tokenMark0Ink, tokenMark1Ink, tokenMark2Ink, tokenMark3Ink] }
}

/// Token mark: the bundled logo, or the tinted letter badge the extension falls back to.
struct TokenMark: View {
    @Environment(\.skin) private var skin
    let address: String
    let symbol: String

    var body: some View {
        let metrics = BrambleMetrics.TokenRow.self
        Group {
            if let asset = BrambleTokenLogo.assets[address.lowercased()] {
                Image(asset).resizable().scaledToFill()
            } else {
                let tone = Self.tone(of: address)
                Text(symbol.prefix(3))
                    .brambleText(BrambleTypeScale.micro.sized(metrics.markTextSize), weight: metrics.markWeight, tracking: metrics.markTracking)
                    .foregroundStyle(skin.tokenMarkInks[tone])
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(skin.tokenMarkFills[tone])
            }
        }
        .frame(width: metrics.markSize, height: metrics.markSize)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    /// `BigInt(address) % 4n` (`tokenGlyph`): 16 is a multiple of 4, so the last hex digit
    /// decides; anything that is not hex takes tone 0, as the extension's catch does.
    static func tone(of address: String) -> Int {
        guard address.hasPrefix("0x"), address.count > 2, let digit = address.last?.hexDigitValue,
              address.dropFirst(2).allSatisfy(\.isHexDigit) else { return 0 }
        return digit % 4
    }
}

/// `0x1234…abcd`, the extension's `accountLabel`, computed by the core so both wallets truncate
/// identically (no length guard, UTF-16 slicing).
func shortAddress(_ address: String) -> String {
    accountLabel(address: address)
}
