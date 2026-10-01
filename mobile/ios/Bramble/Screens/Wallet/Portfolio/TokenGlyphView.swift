import BrambleCore
import SwiftUI

/// `tokenGlyph` from `token-row.ts`, resolved by the core (`token_glyph`): the bundled logo, or the
/// `.token-mark` letter badge. Tones 0–3 are `color-mix(in srgb, avatar-N 20%, sunken)` for the
/// ground and `color-mix(in srgb, avatar-N 80%, text)` for the letters, composed here as layered
/// opacities (sRGB compositing is exactly that mix); any other tone is the neutral badge.
struct TokenGlyphView: View {
    @Environment(\.skin) private var skin
    let glyph: TokenGlyph
    var size: CGFloat = Layout.referenceSize

    private enum Layout {
        /// The glyph size the letter badge's type is specified at; other sizes scale from it.
        static let referenceSize: CGFloat = 40
        /// Highest avatar tone index (tones 0–3); any other tone is the neutral badge.
        static let maxTone = 3
        /// `avatar-N 20%` in the badge ground mix.
        static let groundToneOpacity: Double = 0.2
        /// `avatar-N 80%` in the letters mix.
        static let letterToneOpacity: Double = 0.8
        /// Letter-spacing of the badge letters, in em.
        static let letterTracking: CGFloat = 0.02
    }

    var body: some View {
        Group {
            if let key = glyph.logoAddress, let asset = BrambleTokenLogo.assets[key] {
                Image(asset).resizable().scaledToFit()
            } else {
                badge
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var tone: Color? {
        (0...Layout.maxTone).contains(Int(glyph.tone)) ? skin.avatars[Int(glyph.tone)] : nil
    }

    private var badge: some View {
        ZStack {
            skin.sunken
            if let tone { tone.opacity(Layout.groundToneOpacity) }
            letters(skin.text)
            if let tone { letters(tone).opacity(Layout.letterToneOpacity) }
        }
    }

    private func letters(_ color: Color) -> some View {
        Text(glyph.letters)
            .font(.system(size: BrambleTypeScale.micro.size * size / Layout.referenceSize, weight: .heavy))
            .tracking(BrambleTypeScale.micro.size * Layout.letterTracking)
            .foregroundStyle(tone == nil ? skin.muted : color)
            .lineLimit(1)
    }
}
