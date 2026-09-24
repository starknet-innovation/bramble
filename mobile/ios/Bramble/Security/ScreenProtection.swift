import SwiftUI
import UIKit

// Protections for screens that show a recovery phrase (vault-security.md §5.2–5.3). iOS has no
// public API that blocks screenshots, so the layers are: mask while the screen is recorded or
// mirrored, host the words in the secure-entry layer screenshots leave out (failing closed when
// that layer cannot be found), and warn after a screenshot. This is the one audited file that
// relies on the undocumented secure layer.

/// Whether any of the app's scenes is being recorded, mirrored or AirPlayed right now.
@MainActor
func isScreenCaptured() -> Bool {
    UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .contains { $0.traitCollection.sceneCaptureState == .active }
}

/// Tracks capture state for a secret screen.
private struct CaptureTracking: ViewModifier {
    @Binding var captured: Bool

    func body(content: Content) -> some View {
        content
            .onAppear { captured = isScreenCaptured() }
            .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in
                captured = isScreenCaptured()
            }
            .onReceive(NotificationCenter.default.publisher(for: UIScene.didActivateNotification)) { _ in
                captured = isScreenCaptured()
            }
    }
}

/// Raises the screenshot warning toast while a secret screen is visible.
private struct ScreenshotWarning: ViewModifier {
    @Environment(WalletStore.self) private var store

    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
            store.toast = BrambleCopy.screenshotWarning
        }
    }
}

extension View {
    /// Keeps `captured` equal to the scene capture state.
    func trackingScreenCapture(_ captured: Binding<Bool>) -> some View {
        modifier(CaptureTracking(captured: captured))
    }

    /// Shows the screenshot warning when the user takes one on this screen.
    func warnsOnScreenshot() -> some View {
        modifier(ScreenshotWarning())
    }
}

/// Hosts SwiftUI content inside the layer of a secure `UITextField`, which the system leaves out
/// of screenshots and recordings. When the layer is not found (a future iOS changes it) the
/// content is never shown: `ScreenshotShield.isAvailable` is false and callers keep words masked.
struct ScreenshotShield<Content: View>: UIViewRepresentable {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    @MainActor static var isAvailable: Bool { ShieldProbe.available }

    func makeUIView(context: Context) -> ShieldView<Content> {
        ShieldView(content: content)
    }

    func updateUIView(_ view: ShieldView<Content>, context: Context) {
        view.host.rootView = content
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ShieldView<Content>, context: Context) -> CGSize? {
        let width = proposal.width ?? UIView.layoutFittingExpandedSize.width
        let size = uiView.host.sizeThatFits(in: CGSize(width: width, height: UIView.layoutFittingExpandedSize.height))
        return CGSize(width: width, height: size.height)
    }
}

@MainActor
private enum ShieldProbe {
    static let available: Bool = secureCanvas(in: UITextField.secured()) != nil
}

/// The secure text field's canvas subview, found by class name. Undocumented; checked at runtime.
@MainActor
private func secureCanvas(in field: UITextField) -> UIView? {
    field.layoutIfNeeded()
    return field.subviews.first { NSStringFromClass(type(of: $0)).contains("CanvasView") }
}

private extension UITextField {
    static func secured() -> UITextField {
        let field = UITextField()
        field.isSecureTextEntry = true
        field.isUserInteractionEnabled = false
        return field
    }
}

final class ShieldView<Content: View>: UIView {
    let host: UIHostingController<Content>
    private let field = UITextField.secured()

    init(content: Content) {
        host = UIHostingController(rootView: content)
        super.init(frame: .zero)
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        field.translatesAutoresizingMaskIntoConstraints = false
        addSubview(field)
        NSLayoutConstraint.activate([
            field.topAnchor.constraint(equalTo: topAnchor), field.bottomAnchor.constraint(equalTo: bottomAnchor),
            field.leadingAnchor.constraint(equalTo: leadingAnchor), field.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
        // Fail closed: without the secure canvas nothing is attached, so nothing is drawn.
        guard let canvas = secureCanvas(in: field) else { return }
        canvas.isUserInteractionEnabled = true
        canvas.addSubview(host.view)
        // The secure field hides its subtree from accessibility; expose the words to VoiceOver.
        field.isAccessibilityElement = false
        accessibilityElements = [host.view as Any]
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: topAnchor), host.view.bottomAnchor.constraint(equalTo: bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: leadingAnchor), host.view.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }
}

/// A recovery-word grid shielded from screenshots, masked when the shield is unavailable or the
/// screen is being captured.
struct ProtectedWordGrid: View {
    @Environment(\.skin) private var skin
    let words: [String]
    let masked: Bool

    var body: some View {
        if masked || !ScreenshotShield<EmptyView>.isAvailable {
            RecoveryWordGrid(words: words, masked: true)
        } else {
            ScreenshotShield { RecoveryWordGrid(words: words, masked: false).environment(\.skin, skin) }
        }
    }
}
