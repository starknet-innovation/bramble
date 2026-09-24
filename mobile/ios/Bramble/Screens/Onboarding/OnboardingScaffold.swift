import SwiftUI

// The onboarding surface from `styles-onboarding.ts`: the brand landscape behind a solid panel
// card (`.onboarding-wizard`), each step laid out as back control, badge, heading, fields, and a
// CTA pinned to the foot (`.onboarding-step`).

/// `body.onboarding-surface`: the landscape the extension ships (`apps/extension/public/brand`,
/// bundled by reference in project.yml), multiplied down in the midnight skin.
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
    }
}

/// `.onboarding-wizard`: the solid card the steps live in.
struct OnboardingCard<Content: View>: View {
    @Environment(\.skin) private var skin
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .frame(maxWidth: 520, maxHeight: .infinity)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.xl, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: BrambleRadius.xl, style: .continuous))
            .brambleShadow(BrambleShadow.md)
            .padding(.horizontal, BrambleSpace.md)
            .padding(.vertical, BrambleSpace.sm)
    }
}

/// `.onboarding-step`: back control, `.onboarding-step-head`, body, and `.onboarding-step-cta`.
struct OnboardingStep<Body: View, CTA: View>: View {
    @Environment(\.skin) private var skin
    var back: (() -> Void)?
    let icon: BrambleIconName
    let title: String
    let lede: String
    @ViewBuilder let content: () -> Body
    @ViewBuilder let cta: () -> CTA

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: BrambleSpace.lg) {
                    VStack(spacing: BrambleSpace.sm) {
                        Medallion(icon: icon).padding(.bottom, BrambleSpace.sm)
                        Text(title)
                            .brambleText(BrambleTypeScale.headline, weight: BrambleWeight.heavy, tracking: -0.035)
                            .multilineTextAlignment(.center)
                        Text(lede)
                            .brambleText(BrambleTypeScale.body)
                            .lineSpacing(BrambleTypeScale.body.size * 0.1)
                            .foregroundStyle(skin.muted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, back == nil ? BrambleSpace.lg : 46)
                    .padding(.bottom, BrambleSpace.md)
                    content()
                }
                .padding(.horizontal, 28)
                .padding(.top, 38)
            }
            .scrollDismissesKeyboard(.interactively)
            VStack(spacing: BrambleSpace.sm) { cta() }
                .padding(.horizontal, 28)
                .padding(.top, BrambleSpace.lg)
                .padding(.bottom, 30)
        }
        .overlay(alignment: .topLeading) {
            if let back {
                IconButton(icon: .chevronLeft, label: "Back", tint: skin.muted, action: back)
                    .padding(.leading, 16)
                    .padding(.top, 16)
            }
        }
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
                    .frame(width: 18, height: 18)
                    .padding(.top, 1)
                Text(text).brambleText(BrambleTypeScale.body).foregroundStyle(skin.text).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
