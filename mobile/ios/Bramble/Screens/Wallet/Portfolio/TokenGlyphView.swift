import BrambleCore
import SwiftUI

/// `tokenGlyph` from `token-row.ts`, resolved by the core (`token_glyph`): the bundled logo, or the
/// `.token-mark` letter badge. Tones 0–3 are `color-mix(in srgb, avatar-N 20%, sunken)` for the
/// ground and `color-mix(in srgb, avatar-N 80%, text)` for the letters, composed here as layered
/// opacities (sRGB compositing is exactly that mix); any other tone is the neutral badge.
struct TokenGlyphView: View {
    @Environment(\.skin) private var skin
    let glyph: TokenGlyph
    var size: CGFloat = 40

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
        (0...3).contains(Int(glyph.tone)) ? skin.avatars[Int(glyph.tone)] : nil
    }

    private var badge: some View {
        ZStack {
            skin.sunken
            if let tone { tone.opacity(0.2) }
            letters(skin.text)
            if let tone { letters(tone).opacity(0.8) }
        }
    }

    private func letters(_ color: Color) -> some View {
        Text(glyph.letters)
            .font(.system(size: BrambleTypeScale.micro.size * size / 40, weight: .heavy))
            .tracking(BrambleTypeScale.micro.size * 0.02)
            .foregroundStyle(tone == nil ? skin.muted : color)
            .lineLimit(1)
    }
}
