import SwiftUI

// Buttons and fields from `styles-controls.ts`: pill CTAs (`button`, `.secondary`, `.danger`,
// `.ghost`, `.small`), circular icon buttons, and filled fields with a bottom edge. Metrics come
// from `BrambleMetrics` (read from the stylesheet), presses from `BramblePress`.

enum PillKind { case primary, secondary, danger, ghost }

/// `button` in the side panel: a full-radius pill at the control height (`button.small` when
/// `small`). Busy is the extension's `button[data-busy]`: disabled at 0.7 opacity, label kept.
struct PillButton: View {
    @Environment(\.skin) private var skin
    @Environment(\.isEnabled) private var enabled
    let title: String
    var kind: PillKind = .primary
    var icon: BrambleIconName?
    var busy = false
    var small = false
    let action: () -> Void
    @State private var presses = 0

    init(_ title: String, kind: PillKind = .primary, icon: BrambleIconName? = nil, busy: Bool = false, small: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.kind = kind
        self.icon = icon
        self.busy = busy
        self.small = small
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
        let type = small ? BrambleTypeScale.body.sized(BrambleMetrics.ButtonSmall.fontSize) : BrambleTypeScale.body
        Button {
            presses += 1
            action()
        } label: {
            HStack(spacing: BrambleMetrics.Button.gap) {
                if let icon { BrambleIcon(icon) }
                Text(title).brambleText(type, weight: BrambleMetrics.Button.weight, tracking: BrambleMetrics.Button.tracking)
            }
            .lineLimit(1)
            .foregroundStyle(ink)
            .padding(small ? BrambleMetrics.ButtonSmall.padding : BrambleMetrics.Button.padding)
            .frame(maxWidth: small ? nil : .infinity, minHeight: small ? BrambleMetrics.ButtonSmall.height : BrambleMetrics.Button.height)
            .contentShape(Capsule())
        }
        .buttonStyle(FillPressStyle(fill: fill, pressed: pressed, shape: Capsule()))
        .opacity(enabled ? (busy ? 0.7 : 1) : 0.5)
        .disabled(busy)
        .accessibilityValue(busy ? "Busy" : "")
        .brambleHaptic(kind == .primary ? .press : .selection, trigger: presses)
    }
}

/// Background shift plus the press scale every pressable control uses. The scale springs
/// (interruptible) and is dropped under Reduce Motion; `hit` grows the hit region of a small
/// control to 44pt without changing its layout.
struct FillPressStyle<S: Shape>: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let fill: Color
    let pressed: Color
    let shape: S
    var scale: CGFloat = BramblePress.control
    var hit: CGSize?

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? pressed : fill, in: shape)
            .modifier(HitRegion(shape: shape, visual: hit))
            .scaleEffect(BrambleMotionPolicy.pressScale(scale, pressed: configuration.isPressed, reduceMotion: reduceMotion))
            .animation(BrambleMotionPolicy.animation(BrambleSpring.default, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// The visual shape as the hit region, or the expanded 44pt rectangle for a small control.
private struct HitRegion<S: Shape>: ViewModifier {
    let shape: S
    let visual: CGSize?

    func body(content: Content) -> some View {
        if let visual {
            content.hitTarget(width: visual.width, height: visual.height)
        } else {
            content.contentShape(shape)
        }
    }
}

/// `button.icon-button`: a transparent 40pt circle around one icon, with a 44pt hit region.
struct IconButton: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName
    let label: String
    var hint: String?
    var tint: Color?
    let action: () -> Void

    var body: some View {
        let size = BrambleMetrics.IconButton.size
        Button(action: action) {
            BrambleIcon(icon)
                .foregroundStyle(tint ?? skin.text)
                .frame(width: size, height: size)
        }
        .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Circle(), scale: BramblePress.iconButton, hit: CGSize(width: size, height: size)))
        .accessibilityLabel(label)
        .accessibilityHint(hint ?? "")
    }
}

/// `input`: elevated fill and `md` radius, with no edge or shadow. An invalid value turns the fill and text to
/// the danger tones.
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
                Text(label)
                    .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                    .foregroundStyle(skin.muted)
                    .accessibilityHidden(true)
            }
            Group {
                if secure {
                    // No content type: secrets are never offered to AutoFill or a password manager.
                    SecureField("", text: $text, prompt: prompt).textContentType(nil)
                } else {
                    TextField("", text: $text, prompt: prompt)
                }
            }
            .accessibilityLabel(label ?? placeholder)
            .accessibilityHint(hint ?? "")
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.asciiCapable)
            .brambleText(mono ? BrambleTypeScale.mono : BrambleTypeScale.body, mono: mono)
            .foregroundStyle(invalid ? skin.danger : skin.text)
            .padding(BrambleMetrics.Field.padding)
            .frame(minHeight: BrambleMetrics.Field.height)
            .background(invalid ? skin.dangerSoft : skin.elevated, in: FieldShape())
            if let hint {
                Text(hint).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted).accessibilityHidden(true)
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
        RoundedRectangle(cornerRadius: BrambleMetrics.Field.radius, style: .continuous).path(in: rect)
    }
}

/// `.eyebrow`: uppercase caption in the muted ink, with the cascade's winning weight and tracking.
struct Eyebrow: View {
    @Environment(\.skin) private var skin
    let text: String

    var body: some View {
        Text(text.uppercased())
            .brambleText(BrambleTypeScale.caption.sized(BrambleMetrics.Eyebrow.fontSize), weight: BrambleMetrics.Eyebrow.weight, tracking: BrambleMetrics.Eyebrow.tracking)
            .foregroundStyle(skin.muted)
            .accessibilityLabel(text)
            .accessibilityAddTraits(.isHeader)
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
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

/// `.seg`: a sunken track whose pressed segment rises on the panel fill with the xs elevation.
/// Options keep their 34pt visual height; their hit region grows vertically to 44pt only, so
/// neighbouring options never overlap (design-mobile.md 4.3).
struct SegmentedControl<Value: Hashable>: View {
    @Environment(\.skin) private var skin
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let options: [(label: String, value: Value)]
    @Binding var selection: Value
    @Namespace private var chip

    var body: some View {
        let metrics = BrambleMetrics.Segmented.self
        HStack(spacing: metrics.gap) {
            ForEach(options, id: \.value) { option in
                let selected = option.value == selection
                Button { selection = option.value } label: {
                    Text(option.label)
                        .brambleText(BrambleTypeScale.label.sized(metrics.optionSize), weight: metrics.optionWeight)
                        .foregroundStyle(selected ? skin.text : skin.muted)
                        .padding(metrics.optionPadding)
                        .frame(maxWidth: .infinity, minHeight: metrics.optionHeight)
                        .background {
                            if selected {
                                Capsule().fill(skin.panel).elevation(BrambleElevation.segmentSelected)
                                    .matchedGeometryEffect(id: "chip", in: chip)
                            }
                        }
                        .hitTarget(height: metrics.optionHeight)
                }
                .buttonStyle(SegmentPressStyle())
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(metrics.padding)
        .background(skin.sunken, in: Capsule())
        .animation(BrambleMotionPolicy.animation(BrambleSpring.snappy, reduceMotion: reduceMotion), value: selection)
        .brambleHaptic(.selection, trigger: selection)
    }
}

private struct SegmentPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(BrambleMotionPolicy.pressScale(BramblePress.segment, pressed: configuration.isPressed, reduceMotion: reduceMotion))
            .animation(BrambleMotionPolicy.animation(BrambleSpring.default, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}
