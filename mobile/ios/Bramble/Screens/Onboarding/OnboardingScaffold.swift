import SwiftUI

// The onboarding surface from `styles-onboarding.ts`: the brand landscape behind a solid panel
// card (`.onboarding-wizard`), each step laid out as back control, badge, heading, fields, and a
// CTA pinned to the foot (`.onboarding-step`). At phone width (every iPhone) the extension's
// `max-width: 520px` rules make the card full-bleed: no radius, no shadow, 16pt side padding.

/// `body.onboarding-surface`: the landscape the extension ships (`apps/extension/public/brand`,
/// bundled by reference in project.yml), multiplied down in the midnight skin. Hidden behind the
/// full-bleed card on a phone; kept for wider scenes.
struct OnboardingBackdrop: View {
    @Environment(\.skin) private var skin
    @Environment(\.colorScheme) private var scheme

    private static let image: UIImage? = Bundle.main
        .url(forResource: "onboarding-landscape", withExtension: "webp")
        .flatMap { UIImage(contentsOfFile: $0.path) }

    var body: some View {
        // The image fills whatever space the layout offers but never proposes a size of its own,
        // so a wide painting cannot widen the card laid over it.
        Color.clear.overlay {
            skin.panel
            if let image = Self.image {
                Image(uiImage: image).resizable().scaledToFill()
            }
            if scheme == .dark {
                // `color-mix(in srgb, var(--bramble-bg) 55%, var(--bramble-text))`, multiplied.
                // Text at 45% over opaque bg is exactly that mix; it is composited, then multiplied.
                ZStack { skin.bg; skin.text.opacity(0.45) }.compositingGroup().blendMode(.multiply)
            }
        }
        .clipped()
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// `.onboarding-wizard`: the solid card the steps live in; full-bleed at phone width.
struct OnboardingCard<Content: View>: View {
    @Environment(\.skin) private var skin
    @Environment(\.deviceClass) private var device
    @ViewBuilder let content: () -> Content

    var body: some View {
        let radius = device.phone ? 0 : BrambleRadius.xl
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content()
            .frame(maxWidth: device.phone ? .infinity : 520, maxHeight: .infinity)
            .background { shape.fill(skin.panel).ignoresSafeArea(edges: device.phone ? .all : []) }
            .elevation(device.phone ? BrambleElevation.onboardingWizardPhone : BrambleElevation.onboardingWizard)
            .padding(device.phone ? EdgeInsets() : EdgeInsets(top: BrambleSpace.lg, leading: BrambleSpace.xl, bottom: BrambleSpace.lg, trailing: BrambleSpace.xl))
    }
}

/// The step paddings for the current scene: base, `max-width: 520px`, `max-height: 760px`.
struct OnboardingInsets {
    let top: CGFloat
    let bottom: CGFloat
    let inline: CGFloat
    let headTop: CGFloat
    let headBottom: CGFloat

    init(_ device: DeviceClass) {
        let m = BrambleMetrics.Onboarding.self
        top = device.short ? m.paddingTopShort : m.paddingTop
        bottom = device.short ? m.paddingBottomShort : m.paddingBottom
        // The base inline padding is `clamp(24px, 7vw, 42px)`; every phone takes the 16pt rule.
        inline = device.phone ? m.paddingInlinePhone : BrambleSpace.xl
        headTop = device.short ? m.headTopShort : m.headTop
        headBottom = device.short ? m.headBottomShort : m.headBottom
    }
}

/// `.onboarding-step`: back control, `.onboarding-step-head`, body, and `.onboarding-step-cta`.
/// The head and body scroll; the CTA stays at the foot (`margin-top: auto`) and rides above the
/// keyboard.
struct OnboardingStep<Body: View, CTA: View>: View {
    @Environment(\.skin) private var skin
    @Environment(\.deviceClass) private var device
    var back: (() -> Void)?
    let icon: BrambleIconName
    let title: String
    let lede: String
    @ViewBuilder let content: () -> Body
    @ViewBuilder let cta: () -> CTA

    var body: some View {
        let m = BrambleMetrics.Onboarding.self
        let insets = OnboardingInsets(device)
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: m.gap) {
                    head(insets)
                    content()
                }
                .padding(.horizontal, insets.inline)
                .padding(.top, insets.top)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
            // `.onboarding-step-cta` (`margin-top: auto`): pinned to the foot of the step, and so
            // above the keyboard while it is up.
            VStack(spacing: m.ctaGap) { cta() }
                .padding(.horizontal, insets.inline)
                .padding(.top, m.ctaTop)
                .padding(.bottom, insets.bottom)
        }
        .overlay(alignment: .topLeading) {
            if let back {
                IconButton(icon: .chevronLeft, label: "Back", tint: skin.muted, action: back)
                    .padding(.leading, m.backInset)
                    .padding(.top, m.backInset)
            }
        }
    }

    private func head(_ insets: OnboardingInsets) -> some View {
        let m = BrambleMetrics.Onboarding.self
        return VStack(spacing: m.headGap) {
            Medallion(icon: icon).padding(.bottom, m.iconGap)
            Text(title)
                .brambleText(BrambleTypeStyle(size: m.titleSize, lineHeight: m.titleLineHeight), weight: m.titleWeight, tracking: m.titleTracking)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(lede)
                .brambleText(BrambleTypeStyle(size: BrambleTypeScale.body.size, lineHeight: m.ledeLineHeight))
                .foregroundStyle(skin.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: m.headMaxWidth)
        .frame(maxWidth: .infinity)
        .padding(.top, insets.headTop)
        .padding(.bottom, insets.headBottom)
    }
}

/// `label:has(> input[type=checkbox])`: a native-feeling checkbox row in the accent colour.
struct CheckRow: View {
    @Environment(\.skin) private var skin
    let text: String
    @Binding var isOn: Bool

    var body: some View {
        Button { isOn.toggle() } label: {
            HStack(alignment: .top, spacing: BrambleSpace.sm) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(isOn ? skin.accent : Color.clear)
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(isOn ? skin.accent : skin.border, lineWidth: 1.5))
                    .overlay { if isOn { BrambleIcon(.check, size: 13).foregroundStyle(skin.accentText) } }
                    .frame(width: BrambleMetrics.Checkbox.size, height: BrambleMetrics.Checkbox.size)
                    .padding(.top, 1)
                Text(text).brambleText(BrambleTypeScale.body).foregroundStyle(skin.text).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .hitTarget(height: BrambleTypeScale.body.size * BrambleTypeScale.body.lineHeight)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text)
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
        .accessibilityValue(isOn ? "Checked" : "Unchecked")
    }
}
