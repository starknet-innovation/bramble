import SwiftUI

// `.toast` from `styles-components.ts` with the behaviour of `showToast` in `shared/dom.ts`: a
// leading tone chip, the message, and on errors a copy control for the full details. It springs
// in with the momentum spring, can be swiped away, and stays for the tone's lifetime.

enum ToastTone: Equatable { case success, error }

struct ToastView: View {
    @Environment(\.skin) private var skin
    let message: String
    var tone: ToastTone = .error
    /// The complete diagnostic behind the copy control; defaults to the message.
    var details: String?
    @State private var copied = false

    var body: some View {
        let metrics = BrambleMetrics.Toast.self
        HStack(spacing: metrics.gap) {
            BrambleIcon(tone == .error ? .alert : .check, size: metrics.glyph)
                .foregroundStyle(tone == .error ? skin.danger : skin.positive)
                .frame(width: metrics.iconSize, height: metrics.iconSize)
                .background(
                    tone == .error ? skin.dangerSoft : skin.positiveSoft,
                    in: RoundedRectangle(cornerRadius: metrics.iconRadius, style: .continuous)
                )
            Text(message)
                .brambleText(BrambleTypeScale.label.sized(metrics.fontSize), weight: metrics.weight)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(tone == .error ? "Error: \(message)" : message)
            if tone == .error {
                Button {
                    Clipboard.copy(details ?? message)
                    copied = true
                } label: {
                    BrambleIcon(copied ? .check : .copy)
                        .foregroundStyle(skin.text)
                        .frame(width: metrics.copySize, height: metrics.copySize)
                }
                .buttonStyle(
                    FillPressStyle(
                        fill: .clear,
                        pressed: skin.softPress,
                        shape: Circle(),
                        scale: BramblePress.iconButton,
                        hit: CGSize(width: metrics.copySize, height: metrics.copySize)
                    )
                )
                .accessibilityLabel(copied ? BrambleToast.copiedLabel : BrambleToast.copyLabel)
                .task(id: copied) {
                    guard copied else { return }
                    try? await Task.sleep(for: .milliseconds(BrambleToast.copyConfirmMs))
                    copied = false
                }
                .brambleHaptic(.success, trigger: copied) { _, new in new }
            }
        }
        .padding(metrics.padding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.radius, style: .continuous))
        .elevation(BrambleElevation.toast)
        .accessibilityElement(children: .contain)
    }
}

/// Pins one toast above the dock (`.toast-stack`), springs it in, dismisses it after its tone's
/// lifetime or on a swipe past the extension's distance/velocity thresholds.
struct ToastHost: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let message: String?
    var tone: ToastTone = .error
    let dismiss: () -> Void
    @State private var dragOffsetX: CGFloat = 0
    @State private var swiped = 0

    /// `translateY(18px) scale(0.95)`: where the toast springs in from.
    private static let entryScale: CGFloat = 0.95
    private static let entryOffsetY: CGFloat = 18
    /// Horizontal travel before the drag is treated as a swipe.
    private static let swipeMinimumDistance: CGFloat = 8
    /// Converts SwiftUI's pt/s drag velocity to the extension's px/ms.
    private static let millisecondsPerSecond: CGFloat = 1_000

    var body: some View {
        let metrics = BrambleMetrics.Toast.self
        VStack {
            Spacer()
            if let message {
                ToastView(message: message, tone: tone)
                    .offset(x: dragOffsetX)
                    .opacity(Double(max(0, 1 - abs(dragOffsetX) / BrambleToast.swipeFade)))
                    .gesture(swipe)
                    .transition(entry)
                    .task(id: message) {
                        dragOffsetX = 0
                        let lifetime = tone == .error ? BrambleToast.errorMs : BrambleToast.successMs
                        try? await Task.sleep(for: .milliseconds(lifetime))
                        dismiss()
                    }
                    .onAppear { AccessibilityNotification.Announcement(message).post() }
            }
        }
        .padding(.horizontal, metrics.stackInset)
        .padding(.bottom, metrics.stackBottom)
        .animation(BrambleMotionPolicy.animation(BrambleSpring.momentum, reduceMotion: reduceMotion), value: message)
        .brambleHaptic(.error, trigger: message) { _, new in new != nil && tone == .error }
        .brambleHaptic(.dismiss, trigger: swiped)
    }

    /// `translateY(18px) scale(0.95)` and transparent, springing to rest; a fade under Reduce Motion.
    private var entry: AnyTransition {
        reduceMotion
            ? .opacity
            : .opacity
                .combined(with: .scale(scale: Self.entryScale))
                .combined(with: .offset(y: Self.entryOffsetY))
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: Self.swipeMinimumDistance)
            .onChanged { dragOffsetX = $0.translation.width }
            .onEnded { value in
                // SwiftUI reports pt/s; the extension's threshold is px/ms.
                let velocity = abs(value.velocity.width) / Self.millisecondsPerSecond
                if velocity > BrambleToast.swipeVelocity || abs(value.translation.width) > BrambleToast.swipeDistance {
                    swiped += 1
                    dismiss()
                } else {
                    let settle = BrambleMotionPolicy.animation(BrambleSpring.default, reduceMotion: reduceMotion)
                    withAnimation(settle) { dragOffsetX = 0 }
                }
            }
    }
}
