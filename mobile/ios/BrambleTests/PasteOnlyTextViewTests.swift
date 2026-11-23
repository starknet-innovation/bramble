@testable import Bramble
import UIKit
import XCTest

/// The private-key field's edit menu (`PasteOnlyTextView`): nothing in it can move the text out.
/// A plain `UITextView` in the same state is the control, so the refusals are the subclass's and
/// not a view that offers nothing at all.
@MainActor
final class PasteOnlyTextViewTests: XCTestCase {
    private let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 480))

    /// `view` editing, in a window, with all of its text selected.
    private func selecting<View: UITextView>(_ view: View) -> View {
        window.makeKeyAndVisible()
        window.addSubview(view)
        view.frame = window.bounds
        view.text = "not a key"
        _ = view.becomeFirstResponder()
        view.selectedRange = NSRange(location: 0, length: view.text.count)
        return view
    }

    func testOffersNoWayToCopyTheTextOut() {
        let copy = #selector(UIResponderStandardEditActions.copy(_:))
        let cut = #selector(UIResponderStandardEditActions.cut(_:))
        let plain = selecting(UITextView())
        XCTAssertTrue(plain.canPerformAction(copy, withSender: nil), "control: a plain text view copies")
        plain.removeFromSuperview()

        let view = selecting(PasteOnlyTextView())
        for action in [copy, cut, NSSelectorFromString("_share:"), NSSelectorFromString("_translate:")] {
            XCTAssertFalse(view.canPerformAction(action, withSender: nil), "\(action) is offered")
        }
    }
}
