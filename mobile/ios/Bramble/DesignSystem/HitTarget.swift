import SwiftUI

/// Apple's minimum touch target (Human Interface Guidelines). A platform rule, not an extension
/// token: the extension's 40pt icon buttons and 34pt segments keep their visual size.
enum BrambleHit {
    static let minimum: CGFloat = 44

    /// How far one axis of a control of `side` points expands to reach the minimum, never more
    /// than half the gap to its neighbour, so neighbouring regions meet but never overlap.
    static func expansion(for side: CGFloat?, gap: CGFloat? = nil) -> CGFloat {
        guard let side else { return 0 }
        let needed = max(0, (minimum - side) / 2)
        return gap.map { min(needed, $0 / 2) } ?? needed
    }
}

extension View {
    /// Grows the hit region of a `width` × `height` control to 44pt without changing its layout:
    /// padding, a rectangular content shape, then the same padding removed. Apply inside a button
    /// label (or through `FillPressStyle(hit:)`) so the button owns the expanded region.
    func hitTarget(width: CGFloat? = nil, height: CGFloat? = nil, gap: CGFloat? = nil) -> some View {
        let dx = BrambleHit.expansion(for: width, gap: gap)
        let dy = BrambleHit.expansion(for: height)
        return padding(.horizontal, dx)
            .padding(.vertical, dy)
            .contentShape(Rectangle())
            .padding(.horizontal, -dx)
            .padding(.vertical, -dy)
    }
}
