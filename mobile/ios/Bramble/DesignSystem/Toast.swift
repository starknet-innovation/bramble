import SwiftUI
import UIKit
import UniformTypeIdentifiers

// `.toast` from `styles-components.ts` with the behaviour of `showToast` in `shared/dom.ts`: a
// leading tone chip, the message, and on errors a copy control for the full details. It springs
// in with the momentum spring, can be swiped away, and stays for the tone's lifetime.

enum ToastTone: Equatable { case success, error }

/// The clipboard every copy action uses: this device only (no Universal Clipboard hand-off) and
/// expiring after two minutes (SCOPE.md, "Clipboard").
enum SecurePasteboard {
    static let lifetime: TimeInterval = 120

    static func copy(_ text: String) {
        UIPasteboard.general.setItems(
            [[UTType.plainText.identifier: text]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(lifetime)]
        )
    }
}

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
                .background(tone == .error ? skin.dangerSoft : skin.positiveSoft, in: RoundedRectangle(cornerRadius: metrics.iconRadius, style: .continuous))
            Text(message)
                .brambleText(BrambleTypeScale.label.sized(metrics.fontSize), weight: metrics.weight)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(tone == .error ? "Error: \(message)" : message)
            if tone == .error {
                Button {
                    SecurePasteboard.copy(details ?? message)
                    copied = true
                } label: {
                    BrambleIcon(copied ? .check : .copy)
                        .foregroundStyle(skin.text)
                        .frame(width: metrics.copySize, height: metrics.copySize)
                }
                .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Circle(), scale: BramblePress.iconButton, hit: CGSize(width: metrics.copySize, height: metrics.copySize)))
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
    @State private var dx: CGFloat = 0
    @State private var swiped = 0

    var body: some View {
        let metrics = BrambleMetrics.Toast.self
        VStack {
            Spacer()
            if let message {
                ToastView(message: message, tone: tone)
                    .offset(x: dx)
                    .opacity(Double(max(0, 1 - abs(dx) / BrambleToast.swipeFade)))
                    .gesture(swipe)
                    .transition(entry)
                    .task(id: message) {
                        dx = 0
                        try? await Task.sleep(for: .milliseconds(tone == .error ? BrambleToast.errorMs : BrambleToast.successMs))
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
        reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.95)).combined(with: .offset(y: 18))
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { dx = $0.translation.width }
            .onEnded { value in
                // SwiftUI reports pt/s; the extension's threshold is px/ms.
                let velocity = abs(value.velocity.width) / 1000
                if velocity > BrambleToast.swipeVelocity || abs(value.translation.width) > BrambleToast.swipeDistance {
                    swiped += 1
                    dismiss()
                } else {
                    withAnimation(BrambleMotionPolicy.animation(BrambleSpring.default, reduceMotion: reduceMotion)) { dx = 0 }
                }
            }
    }
}
