import SwiftUI

/// The leading-edge back swipe for stacks that do not get the system one: onboarding's own step
/// stack, and wallet flows whose navigation bar is hidden (UIKit disables the interactive pop
/// then). The action runs once, on release; nothing changes while the finger moves.
enum EdgeSwipe {
    /// A drag must start this close to the leading edge of the screen.
    static let edge: CGFloat = 24
    /// …and travel this far, or be flicked so its predicted end travels `flick`.
    static let travel: CGFloat = 80
    static let flick: CGFloat = 160

    /// Whether a finished drag is a back swipe. Vertical drags (scrolling) never are.
    static func isBack(start: CGPoint, translation: CGSize, predicted: CGSize) -> Bool {
        start.x <= edge
            && abs(translation.width) > abs(translation.height)
            && (translation.width > travel || predicted.width > flick)
    }
}

extension View {
    /// Adds the back swipe when `enabled`. Simultaneous, so taps and scrolling are untouched.
    func edgeSwipeBack(enabled: Bool = true, action: @escaping () -> Void) -> some View {
        simultaneousGesture(
            DragGesture(minimumDistance: 12, coordinateSpace: .global).onEnded { value in
                if enabled, EdgeSwipe.isBack(start: value.startLocation, translation: value.translation, predicted: value.predictedEndTranslation) {
                    action()
                }
            },
            including: enabled ? .all : .subviews
        )
    }
}
