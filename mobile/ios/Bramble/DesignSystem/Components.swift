import SwiftUI

// Native counterparts of the ui-kit components the extension renders (`ui-kit/src/components`).

/// Filled accent button: the one primary action on a screen.
struct PrimaryButton: View {
    @Environment(\.skin) private var skin
    @Environment(\.isEnabled) private var enabled
    let title: String
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(skin.accentText) }
            }
            .brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
            .frame(maxWidth: .infinity, minHeight: BrambleSize.control)
            .foregroundStyle(skin.accentText)
            .background(skin.accent, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(PressStyle())
        .disabled(busy)
    }
}

/// Outlined secondary button.
struct SecondaryButton: View {
    @Environment(\.skin) private var skin
    let title: String
    var role: ButtonRole?
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            Text(title)
                .brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
                .frame(maxWidth: .infinity, minHeight: BrambleSize.control)
                .foregroundStyle(role == .destructive ? skin.danger : skin.text)
                .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous).stroke(skin.hairline))
        }
        .buttonStyle(PressStyle())
    }
}

/// The 0.96–1.0 press feedback the token file prescribes, on the `snappy` spring.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(BrambleSpring.snappy, value: configuration.isPressed)
    }
}

/// Home action tile (`.action-tile`): accent-soft ground, icon over label.
struct ActionTile: View {
    @Environment(\.skin) private var skin
    @Environment(\.isEnabled) private var enabled
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: BrambleSpace.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: BrambleControl.majorIcon, weight: .medium))
                Text(title).brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
            }
            .foregroundStyle(skin.accent)
            .frame(maxWidth: .infinity, minHeight: BrambleSize.actionTile)
            .background(skin.accentSoft, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(PressStyle())
    }
}

/// Raised panel card with a hairline edge and the `xs` shadow.
struct Card<Content: View>: View {
    @Environment(\.skin) private var skin
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) { content() }
            .padding(BrambleSpace.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous).stroke(skin.hairline))
            .brambleShadow(BrambleShadow.xs)
    }
}

/// Labelled text input with the field edge (`--bramble-border`) the skin reserves for inputs.
struct BrambleField: View {
    @Environment(\.skin) private var skin
    let label: String
    @Binding var text: String
    var secure = false

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            Text(label).brambleText(BrambleTypeScale.label, weight: BrambleWeight.medium).foregroundStyle(skin.muted)
            Group {
                if secure {
                    SecureField("", text: $text).textContentType(.password)
                } else {
                    TextField("", text: $text)
                }
            }
            .accessibilityLabel(label)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .brambleText(BrambleTypeScale.row)
            .foregroundStyle(skin.text)
            .padding(.horizontal, BrambleSpace.md)
            .frame(minHeight: BrambleSize.control)
            .background(skin.sunken, in: RoundedRectangle(cornerRadius: BrambleRadius.sm, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BrambleRadius.sm, style: .continuous).stroke(skin.border))
        }
    }
}

/// Screen scaffold: title block over scrollable content, in the extension's rhythm.
struct Screen<Content: View>: View {
    @Environment(\.skin) private var skin
    let title: String
    var subtitle: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleSpace.xl) {
                VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                    Text(title)
                        .brambleText(BrambleTypeScale.headline, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                        .foregroundStyle(skin.text)
                    if let subtitle {
                        Text(subtitle).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                    }
                }
                content()
            }
            .padding(BrambleSpace.lg)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(skin.bg.ignoresSafeArea())
    }
}

/// Inline error callout.
struct ErrorText: View {
    @Environment(\.skin) private var skin
    let message: String?

    var body: some View {
        if let message {
            Label(message, systemImage: "exclamationmark.circle")
                .brambleText(BrambleTypeScale.label)
                .foregroundStyle(skin.danger)
        }
    }
}

/// Deterministic account avatar from the four skin avatar tones.
struct AccountAvatar: View {
    @Environment(\.skin) private var skin
    let index: UInt32

    var body: some View {
        Circle()
            .fill(skin.avatars[Int(index) % skin.avatars.count])
            .overlay(Text("\(index + 1)").brambleText(BrambleTypeScale.label, weight: BrambleWeight.bold).foregroundStyle(skin.accountAvatarPaper))
            .frame(width: BrambleSize.avatar, height: BrambleSize.avatar)
    }
}

/// `0x1234…abcd`, the shortened address form the extension shows.
func shortAddress(_ address: String) -> String {
    guard address.count > 14 else { return address }
    return "\(address.prefix(6))…\(address.suffix(4))"
}
