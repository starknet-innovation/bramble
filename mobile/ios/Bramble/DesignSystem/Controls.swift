import SwiftUI

// Buttons and fields from `styles-controls.ts`: pill CTAs (`button`, `.secondary`, `.danger`,
// `.ghost`), circular icon buttons, and filled fields with a bottom edge.

enum PillKind { case primary, secondary, danger, ghost }

/// `button` in the side panel: a full-radius pill at the control height.
struct PillButton: View {
    @Environment(\.skin) private var skin
    @Environment(\.isEnabled) private var enabled
    let title: String
    var kind: PillKind = .primary
    var icon: BrambleIconName?
    var busy = false
    let action: () -> Void

    init(_ title: String, kind: PillKind = .primary, icon: BrambleIconName? = nil, busy: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.kind = kind
        self.icon = icon
        self.busy = busy
        self.action = action
    }

    private var fill: Color {
        switch kind {
        case .primary: skin.accent
        case .secondary, .danger: skin.elevated
        case .ghost: .clear
        }
    }

    private var ink: Color {
        switch kind {
        case .primary: skin.accentText
        case .secondary: skin.text
        case .danger: skin.danger
        case .ghost: skin.muted
        }
    }

    private var pressed: Color {
        switch kind {
        case .primary: skin.accentPress
        case .danger: skin.dangerSoft
        case .secondary, .ghost: skin.softPress
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: BrambleSpace.sm) {
                if let icon { BrambleIcon(icon) }
                Text(title).brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium, tracking: BrambleTracking.label)
            }
            .opacity(busy ? 0 : 1)
            .overlay { if busy { ProgressView().tint(ink) } }
            .foregroundStyle(ink)
            .padding(.horizontal, BrambleSpace.lg)
            .frame(maxWidth: .infinity, minHeight: BrambleSize.control)
        }
        .buttonStyle(FillPressStyle(fill: fill, pressed: pressed, shape: Capsule()))
        .opacity(enabled ? (busy ? 0.7 : 1) : 0.5)
        .disabled(busy)
    }
}

/// Background shift plus the 0.98 press scale every pressable control uses.
struct FillPressStyle<S: Shape>: ButtonStyle {
    let fill: Color
    let pressed: Color
    let shape: S
    var scale: CGFloat = 0.98

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? pressed : fill, in: shape)
            .contentShape(shape)
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(BrambleEase.out.animation(ms: BrambleMotion.pressMs), value: configuration.isPressed)
    }
}

/// `button.icon-button`: a transparent 40pt circle around one icon.
struct IconButton: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName
    let label: String
    var tint: Color?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            BrambleIcon(icon)
                .foregroundStyle(tint ?? skin.text)
                .frame(width: BrambleControl.hit, height: BrambleControl.hit)
        }
        .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Circle(), scale: 0.96))
        .accessibilityLabel(label)
    }
}

/// `input`: elevated fill, `md` radius, a 1pt bottom edge in the field-edge token.
struct BrambleField: View {
    @Environment(\.skin) private var skin
    var label: String?
    let placeholder: String
    @Binding var text: String
    var secure = false
    var mono = false
    var invalid = false
    var hint: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label {
                Text(label).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
            }
            Group {
                if secure {
                    SecureField("", text: $text, prompt: prompt).textContentType(.password)
                } else {
                    TextField("", text: $text, prompt: prompt)
                }
            }
            .accessibilityLabel(label ?? placeholder)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.asciiCapable)
            .brambleText(mono ? BrambleTypeScale.mono : BrambleTypeScale.row, mono: mono)
            .foregroundStyle(skin.text)
            .padding(.horizontal, BrambleSpace.md)
            .frame(minHeight: BrambleSize.control)
            .background(skin.elevated, in: FieldShape())
            .overlay(alignment: .bottom) { FieldEdge(color: invalid ? skin.danger : skin.border) }
            if let hint {
                Text(hint).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
        }
    }

    private var prompt: Text {
        Text(placeholder).foregroundStyle(skin.muted)
    }
}

/// The filled-field silhouette.
struct FieldShape: Shape {
    func path(in rect: CGRect) -> Path {
        RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous).path(in: rect)
    }
}

/// The bottom stroke that identifies a filled field (`border-bottom: 1px`), following its radius.
struct FieldEdge: View {
    let color: Color

    var body: some View {
        FieldShape()
            .stroke(color, lineWidth: 1)
            .mask(alignment: .bottom) { Rectangle().frame(height: BrambleRadius.md) }
    }
}

/// `.eyebrow`: uppercase caption in the muted ink.
struct Eyebrow: View {
    @Environment(\.skin) private var skin
    let text: String

    var body: some View {
        Text(text.uppercased())
            .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold, tracking: BrambleTracking.eyebrow)
            .foregroundStyle(skin.muted)
    }
}

/// `[role=status]` / `.hint` line: caption in muted, danger when it reports an error.
struct StatusLine: View {
    @Environment(\.skin) private var skin
    let text: String?
    var tone: Tone = .muted

    enum Tone { case muted, danger, positive }

    var body: some View {
        if let text {
            Text(text)
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(tone == .danger ? skin.danger : tone == .positive ? skin.positive : skin.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// `segmentedControl`: a sunken track whose pressed segment rises on the panel fill.
struct SegmentedControl<Value: Hashable>: View {
    @Environment(\.skin) private var skin
    let options: [(label: String, value: Value)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                let selected = option.value == selection
                Button { selection = option.value } label: {
                    Text(option.label)
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                        .foregroundStyle(selected ? skin.text : skin.muted)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background {
                            if selected {
                                Capsule().fill(skin.panel).brambleShadow(BrambleShadow.xs)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(4)
        .background(skin.sunken, in: Capsule())
        .animation(BrambleEase.inOut.animation(ms: BrambleMotion.tabMs), value: selection)
    }
}
