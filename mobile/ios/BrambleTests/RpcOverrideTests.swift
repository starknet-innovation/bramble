@testable import Bramble
import BrambleCore
import XCTest

/// The custom RPC endpoint (docs/PLAN.md P4 in wallet-core): every read takes its endpoints from
/// the wallet's `networks()`, the override first; the bundled list only while there is no
/// readable override; and every failure text is redacted, since an override may carry a key.
final class RpcOverrideTests: XCTestCase {
    private static let override = "https://rpc.example/v0_10/KEY"

    func testAnOverridesUrlIsTriedFirst() async throws {
        let core = try unlockedCore()
        XCTAssertEqual(try core.setRpcOverride(network: .sepolia, rpcUrl: "  \(Self.override) "), Self.override)
        let info = endpointNetwork(.sepolia, wallet: core)
        XCTAssertEqual(info.rpcUrls.first, Self.override)
        XCTAssertEqual(Array(info.rpcUrls.dropFirst()), try sepolia().rpcUrls, "the bundled ones stay as failover")

        let node = MockNode()
        node.callResult = ["0x5", "0x0"]
        _ = try await RpcClient(transport: node).balances(of: account1, on: info)
        XCTAssertEqual(node.posts.first?.url, URL(string: Self.override))
        XCTAssertEqual(Set(node.posts.map(\.url)), [URL(string: Self.override)], "a working override is enough")

        // Empty clears it; the defaults come back.
        XCTAssertNil(try core.setRpcOverride(network: .sepolia, rpcUrl: " "))
        XCTAssertEqual(endpointNetwork(.sepolia, wallet: core).rpcUrls, try sepolia().rpcUrls)
    }

    func testLockedOrNoWalletUsesTheBundledEndpoints() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fresh = try WalletCore(dataDir: dir.path, clock: DeviceClock())
        XCTAssertEqual(endpointNetwork(.sepolia, wallet: fresh).rpcUrls, try sepolia().rpcUrls)

        let core = try unlockedCore()
        _ = try core.setRpcOverride(network: .sepolia, rpcUrl: Self.override)
        core.lock()
        XCTAssertEqual(endpointNetwork(.sepolia, wallet: core).rpcUrls, try sepolia().rpcUrls)
    }

    func testTheCoresRefusalIsShown() throws {
        let core = try unlockedCore()
        XCTAssertThrowsError(try core.setRpcOverride(network: .mainnet, rpcUrl: "http://rpc.example")) { error in
            XCTAssertEqual(RpcEndpointDisclosure.refusal(error), "Mobile RPC endpoints must use https")
        }
        let credentialed = "https://user:secret@rpc.example"
        XCTAssertThrowsError(try core.setRpcOverride(network: .mainnet, rpcUrl: credentialed)) { error in
            XCTAssertEqual(RpcEndpointDisclosure.refusal(error), "Invalid RPC endpoint")
        }
        XCTAssertEqual(RpcEndpointDisclosure.refusal(CoreError.Storage(reason: "write")), "RPC endpoint update failed")
        XCTAssertNil(try core.rpcOverride(network: .mainnet), "a refusal changes nothing")
    }

    func testAnErrorTextNamingAnOverrideIsRedacted() {
        let text = describe(CoreError.InvalidInput(reason: "node at \(Self.override) refused"))
        XCTAssertFalse(text.contains("KEY"), text)
        XCTAssertFalse(text.contains("rpc.example"), text)
        XCTAssertEqual(redactEndpoints(text: "failed: \(Self.override)"), "failed: [endpoint]")
    }
}
