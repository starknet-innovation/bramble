@testable import Bramble
import BrambleCore
import XCTest

/// The relay loop's answer to each core step (`WebSocketRelayTransport.follow`): a next page closes
/// the full subscription and opens the older one on the same socket, in that order, and keeps reading.
final class RelayStepTests: XCTestCase {
    private actor Sent {
        var frames: [String] = []

        func append(_ frame: String) { frames.append(frame) }
    }

    private func follow(_ step: RelayStep) async throws -> (WebSocketRelayTransport.RelayRead, [String]) {
        let sent = Sent()
        let read = try await WebSocketRelayTransport.follow(step) { await sent.append($0) }
        return (read, await sent.frames)
    }

    func testNextPageClosesThenRequestsAndKeepsReading() async throws {
        let close = #"["CLOSE","mcw-1"]"#
        let request = #"["REQ","mcw-2",{"until":1750000000}]"#
        let (read, frames) = try await follow(.nextPage(closeFrame: close, request: request))
        XCTAssertEqual(read, .pageRequested)
        XCTAssertEqual(frames, [close, request])
    }

    func testFinishSendsItsCloseFrameIfAny() async throws {
        let close = #"["CLOSE","mcw-1"]"#
        let (read, frames) = try await follow(.finish(closeFrame: close))
        XCTAssertEqual(read, .finished)
        XCTAssertEqual(frames, [close])
        let (bare, none) = try await follow(.finish(closeFrame: nil))
        XCTAssertEqual(bare, .finished)
        XCTAssertEqual(none, [])
    }

    func testContinueSendsNothing() async throws {
        let (read, frames) = try await follow(.continue)
        XCTAssertEqual(read, .keepReading)
        XCTAssertEqual(frames, [])
    }
}
