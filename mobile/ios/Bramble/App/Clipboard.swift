import UIKit
import UniformTypeIdentifiers

/// The one way the app writes to the pasteboard (SCOPE.md, "Clipboard"): public identifiers only
/// (an address, a signer public key, a class hash), never the phrase or a key. Local-only, so it
/// never reaches Universal Clipboard, and expiring after two minutes.
enum Clipboard {
    /// How long a copied value stays on the pasteboard.
    static let lifetime: TimeInterval = 120

    /// Pasteboard options for every copy; exposed so a unit test can pin them.
    static func options(now: Date = Date()) -> [UIPasteboard.OptionsKey: Any] {
        [.localOnly: true, .expirationDate: now.addingTimeInterval(lifetime)]
    }

    /// Copies the full value (never a truncated rendering of it).
    static func copy(_ value: String, to pasteboard: UIPasteboard = .general) {
        pasteboard.setItems([[UTType.plainText.identifier: value]], options: options())
    }
}
