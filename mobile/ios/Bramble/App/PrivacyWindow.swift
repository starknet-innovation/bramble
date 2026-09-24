import SwiftUI
import UIKit

/// The app-switcher cover in a window of its own above everything, including sheets (which the
/// root view's overlay cannot reach). Shown whenever the scene leaves `.active`, removed on return.
@MainActor
final class PrivacyWindow {
    static let shared = PrivacyWindow()
    private var window: UIWindow?

    func update(covered: Bool) {
        if !covered {
            window?.isHidden = true
            window = nil
            return
        }
        guard window == nil,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let cover = UIWindow(windowScene: scene)
        cover.windowLevel = .alert + 1
        cover.rootViewController = UIHostingController(rootView: SkinProvider { PrivacyCover() })
        cover.accessibilityIdentifier = "privacy-cover"
        cover.isHidden = false
        window = cover
    }
}
