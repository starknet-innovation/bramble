import SwiftUI

// Loading feedback from `styles-progress.ts` and `styles-home.ts`. The extension has no skeleton
// or shimmer, so neither does the phone: unknown values show a Placeholder, indeterminate waits
// show Liquid Dots, and a busy refresh spins its glyph. All of it holds still under Reduce Motion.

/// `.liquid-dots`: two dots swapping sides over `MOTION.waitLoopMs` on the in-out curve. The
/// extension's SVG goo filter has no SwiftUI equivalent, so the dots stay separate (recorded as an
/// intentional difference in design-mobile.md).
struct LiquidDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var compact = false
    @State private var swapped = false

    var body: some View {
        let dot = compact ? BrambleSpace.sm : BrambleSpace.xl
        let travel = compact ? BrambleSpace.sm : BrambleSpace.lg
        ZStack {
            Circle().frame(width: dot, height: dot).offset(x: swapped ? travel : -travel)
            Circle().frame(width: dot, height: dot).offset(x: swapped ? -travel : travel)
        }
        .frame(width: compact ? BrambleSpace.xl : BrambleSize.brand, height: compact ? BrambleSpace.lg : BrambleControl.hitSmall)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(BrambleEase.inOut.animation(ms: BrambleMotion.waitLoopMs / 2).repeatForever(autoreverses: true)) {
                swapped = true
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Loading")
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// The refresh glyph, spinning once per `busySpinMs` while `spinning` (`@keyframes spin`).
struct BusyRefreshIcon: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let spinning: Bool
    @State private var angle: Double = 0

    var body: some View {
        BrambleIcon(.refresh)
            .rotationEffect(.degrees(angle))
            .onChange(of: spinning, initial: true) { _, busy in
                if busy && !reduceMotion {
                    withAnimation(.linear(duration: BrambleMetrics.IconButton.busySpinMs / 1000).repeatForever(autoreverses: false)) { angle = 360 }
                } else {
                    withAnimation(nil) { angle = 0 }
                }
            }
    }
}
