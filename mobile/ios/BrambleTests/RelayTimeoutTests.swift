@testable import Bramble
import XCTest

/// `withTimeout` closes the socket (`onTimeout`) only when the timer wins.
final class RelayTimeoutTests: XCTestCase {
    private final class Flag: @unchecked Sendable {
        private let lock = NSLock()
        private var raised = false

        var value: Bool { lock.withLock { raised } }

        func raise() { lock.withLock { raised = true } }
    }

    func testABodyInTimeKeepsItsSocket() async throws {
        let closed = Flag()
        let value = try await withTimeout(1_000, onTimeout: closed.raise) { 7 }
        XCTAssertEqual(value, 7)
        try await Task.sleep(for: .milliseconds(1_100))
        XCTAssertFalse(closed.value)
    }

    func testAHungBodyHasItsSocketClosed() async throws {
        let closed = Flag()
        do {
            _ = try await withTimeout(50, onTimeout: closed.raise) {
                // Stands in for a socket call that ignores cancellation until the socket closes.
                while !closed.value { try? await Task.sleep(for: .milliseconds(5)) }
                return 0
            }
            XCTFail("expected RelayTimeout")
        } catch is RelayTimeout {
            // The timer won.
        }
        XCTAssertTrue(closed.value)
    }
}
