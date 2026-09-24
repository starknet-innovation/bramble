import SwiftUI

// Structural components from `styles-base.ts`: grouped menu lists with inset hairlines, the flow
// header with its network pill, and the onboarding badge, option card, and detail row.

/// `.menu-list`: one panel per group, rows split by hairlines inset from the leading edge.
struct MenuGroup<Content: View>: View {
    @Environment(\.skin) private var skin
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            _VariadicView.Tree(DividedRows(hairline: skin.hairline)) { content() }
        }
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
    }
}

private struct DividedRows: _VariadicView_MultiViewRoot {
    let hairline: Color

    func body(children: _VariadicView.Children) -> some View {
        ForEach(Array(children.enumerated()), id: \.element.id) { index, child in
            child.overlay(alignment: .top) {
                if index > 0 {
                    Rectangle().fill(hairline).frame(height: 1).padding(.leading, BrambleSpace.lg)
                }
            }
        }
    }
}

/// `button.menu-row`: icon, label, optional trailing value, chevron; 52pt tall.
struct MenuRow: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName?
    let title: String
    var value: String?
    var tone: Color?
    var selected = false
    var chevron = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: BrambleSpace.sm) {
                if let icon {
                    BrambleIcon(icon, size: 20).foregroundStyle(tone ?? skin.muted).frame(width: 28, alignment: .leading)
                }
                Text(title).brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium).foregroundStyle(tone ?? skin.text)
                Spacer(minLength: BrambleSpace.sm)
                if let value {
                    Text(value).brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium).foregroundStyle(skin.muted).lineLimit(1)
                }
                if selected {
                    BrambleIcon(.check).foregroundStyle(skin.accent)
                } else if chevron {
                    BrambleIcon(.chevronRight).foregroundStyle(skin.muted)
                }
            }
            .padding(.horizontal, BrambleSpace.lg)
            .frame(minHeight: 52)
        }
        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous), scale: 1))
        .accessibilityLabel(title)
        .accessibilityValue(value ?? "")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// `.pill` with the network dot: positive when the network answered, warning while unknown.
struct NetworkPill: View {
    @Environment(\.skin) private var skin
    let label: String
    var healthy = true

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(healthy ? skin.positive : skin.warning).frame(width: 6, height: 6)
            Text(label).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
        }
        .padding(.horizontal, BrambleSpace.md)
        .frame(height: BrambleSize.pill + 8)
        .background(skin.elevated, in: Capsule())
    }
}

/// `.flow-header`: back control, title and subtitle, network pill.
struct FlowHeader: View {
    @Environment(\.skin) private var skin
    let title: String
    var subtitle: String?
    var network: String?
    let back: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: BrambleSpace.sm) {
            IconButton(icon: .chevronLeft, label: "Back", tint: skin.muted, action: back)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).brambleText(BrambleTypeScale.headline, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                if let subtitle {
                    Text(subtitle).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let network { NetworkPill(label: network) }
        }
        .padding(.top, 2)
        .padding(.bottom, BrambleSpace.xs)
    }
}

/// `.onboarding-step-icon`: a 54pt elevated disc around a 24pt icon.
struct Medallion: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName

    var body: some View {
        BrambleIcon(icon, size: 24)
            .foregroundStyle(skin.text)
            .frame(width: 54, height: 54)
            .background(skin.elevated, in: Circle())
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
        Button(action: action) {
            HStack(spacing: BrambleSpace.md) {
                BrambleIcon(icon).foregroundStyle(skin.text).frame(width: 40, height: 40).background(skin.panel, in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold).foregroundStyle(skin.text)
                    Text(detail).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted).multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                BrambleIcon(.chevronRight).foregroundStyle(skin.muted)
            }
            .padding(BrambleSpace.md)
            .frame(minHeight: 82)
        }
        .buttonStyle(FillPressStyle(fill: skin.elevated, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous)))
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
        HStack(spacing: BrambleSpace.sm) {
            BrambleIcon(icon, size: 16).foregroundStyle(skin.text)
            Text(text).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted).multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, BrambleSpace.md)
        .frame(minHeight: 44)
        .background(skin.elevated, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
    }
}

/// `.toast`: a raised panel with a tinted icon tile, pinned above the primary action.
struct Toast: View {
    @Environment(\.skin) private var skin
    let message: String

    var body: some View {
        HStack(spacing: BrambleSpace.md) {
            BrambleIcon(.alert).foregroundStyle(skin.danger)
                .frame(width: 30, height: 30)
                .background(skin.dangerSoft, in: RoundedRectangle(cornerRadius: BrambleRadius.sm, style: .continuous))
            Text(message).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
            Spacer(minLength: 0)
        }
        .padding(BrambleSpace.sm + 2)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
        .brambleShadow(BrambleShadow.lg)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Token mark: the bundled logo, or the neutral letter badge the extension falls back to.
struct TokenMark: View {
    @Environment(\.skin) private var skin
    let address: String
    let symbol: String

    var body: some View {
        Group {
            if let asset = BrambleTokenLogo.assets[address.lowercased()] {
                Image(asset).resizable().scaledToFit()
            } else {
                Text(symbol.prefix(1))
                    .brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold)
                    .foregroundStyle(skin.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(skin.sunken)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(Circle())
    }
}

/// `0x1234…abcd`, the extension's shortened address.
func shortAddress(_ address: String) -> String {
    guard address.count > 14 else { return address }
    return "\(address.prefix(6))…\(address.suffix(4))"
}
