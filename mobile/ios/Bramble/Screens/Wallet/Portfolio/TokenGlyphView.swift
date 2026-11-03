import BrambleCore
import SwiftUI

/// `tokenGlyph` from `token-row.ts`, resolved by the core (`token_glyph`): the bundled logo, or the
/// `.token-mark` letter badge. Tones 0–3 take the generated `tokenMarkNFill` / `tokenMarkNInk`, the
/// stylesheet's own mixes of its neutral greys (`--bramble-avatar-N`), so an unverified token never
/// takes on an identity colour; any other tone is the plain badge.
struct TokenGlyphView: View {
    @Environment(\.skin) private var skin
    let glyph: TokenGlyph
    var size: CGFloat = Layout.referenceSize

    private enum Layout {
        /// The glyph size the letter badge's type is specified at; other sizes scale from it.
        static let referenceSize: CGFloat = 40
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

    /// The badge's ground and letter colours for tones 0–3; nil for the plain badge.
    private var tone: (fill: Color, ink: Color)? {
        let marks = [
            (skin.tokenMark0Fill, skin.tokenMark0Ink),
            (skin.tokenMark1Fill, skin.tokenMark1Ink),
            (skin.tokenMark2Fill, skin.tokenMark2Ink),
            (skin.tokenMark3Fill, skin.tokenMark3Ink)
        ]
        let index = Int(glyph.tone)
        return marks.indices.contains(index) ? marks[index] : nil
    }

    private var badge: some View {
        ZStack {
            tone?.fill ?? skin.sunken
            letters(tone?.ink ?? skin.muted)
        }
    }

    private func letters(_ color: Color) -> some View {
        Text(glyph.letters)
            .font(.system(size: BrambleTypeScale.micro.size * size / Layout.referenceSize, weight: .heavy))
            .tracking(BrambleTypeScale.micro.size * Layout.letterTracking)
            .foregroundStyle(color)
            .lineLimit(1)
    }
}
