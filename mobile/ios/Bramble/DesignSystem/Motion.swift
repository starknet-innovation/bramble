import SwiftUI

// Motion and haptics. The extension's motion collapses to a cut under reduced motion; here travel,
// scale and spin go, and only opacity and colour fades over MOTION.press remain. Haptics are new
// on mobile (the extension has none) and only ever mirror something already visible.

enum BrambleMotionPolicy {
    /// The fade that replaces every travel, scale or spin when Reduce Motion is on.
    static let reducedFade = BrambleEase.out.animation(ms: BrambleMotion.pressMs)

    /// `animation`, or the fade under Reduce Motion, so call sites cannot forget the setting.
    static func animation(_ animation: Animation, reduceMotion: Bool) -> Animation {
        reduceMotion ? reducedFade : animation
    }

    /// A press scale, or none under Reduce Motion (the extension's `transform: none`).
    static func pressScale(_ scale: CGFloat, pressed: Bool, reduceMotion: Bool) -> CGFloat {
        pressed && !reduceMotion ? scale : 1
    }

    /// A step transition: direction-aware travel, or a plain fade under Reduce Motion.
    static func step(forward: Bool, reduceMotion: Bool) -> AnyTransition {
        reduceMotion
            ? .opacity
            : .asymmetric(
                insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity)
            )
    }
}

/// The haptic vocabulary (design-mobile.md 4.4). Each case maps to one system feedback.
enum BrambleHaptic {
    case press, success, error, selection, dismiss

    var feedback: SensoryFeedback {
        switch self {
        case .press: .impact(weight: .light)
        case .success: .success
        case .error: .error
        case .selection: .selection
        case .dismiss: .impact(flexibility: .soft)
        }
    }
}

extension View {
    /// Plays `haptic` whenever `trigger` changes (and `when` holds for the change).
    func brambleHaptic<T: Equatable>(_ haptic: BrambleHaptic, trigger: T, when: @escaping (T, T) -> Bool = { _, _ in true }) -> some View {
        sensoryFeedback(trigger: trigger) { old, new in when(old, new) ? haptic.feedback : nil }
    }
}
