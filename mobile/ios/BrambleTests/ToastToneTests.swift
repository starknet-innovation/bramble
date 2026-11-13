@testable import Bramble
import BrambleCore
import XCTest

/// The toast's tones: the extension has only error and success, so the screenshot warning takes
/// its untoned `.toast` (neutral), and an error assigned over any other toast is always an error.
final class ToastToneTests: XCTestCase {
    @MainActor
    func testTheScreenshotWarningIsNeutralAndErrorsStayErrors() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        let store = WalletStore(core: try WalletCore(dataDir: directory, clock: DeviceClock()))
        store.warn(BrambleCopy.screenshotWarning)
        XCTAssertEqual(store.toastTone, .neutral)
        store.notify(BrambleCopy.clipboardCleared)
        XCTAssertEqual(store.toastTone, .success)
        store.toast = "Incorrect passphrase"
        XCTAssertEqual(store.toastTone, .error)
        store.toast = BrambleCopy.screenshotWarning
        XCTAssertEqual(store.toastTone, .neutral, "the same caution text keeps its tone")
        store.toast = nil
        XCTAssertEqual(store.toastTone, .error)
    }
}
