@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// Signing on a Ledger through the real core: a Ledger-only wallet holding LedgerW account 0 on
/// Sepolia, a plan driven by `SendDriver` over the canned node, and a device replaying the
/// Speculos transcripts (`extension-ledger.jsonl`, the "plan transfer" and "plan deployment"
/// blocks) behind `LedgerSigner` and a fake scanner.
@MainActor
final class LedgerSigningTests: XCTestCase {
    private static let key0 = "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"
    private static let key1 = "0x33c4127080fab3f30bcac5837c9c352da3a9d74e79a57b779a379719d655dee"
    private static let transferHash = "0x51899a4f58db1d9dd67bd2887ce37adfcbdd41c1163b49c345143e20184cdcd"
    private static let deploymentHash = "0xf5ffa90a24c4c3494252f955b8d34ded83d06ce84e42ff6bb37c2454409223"
    /// The Starknet app's refusal of a sign (rejected, or Blind signing off).
    private static let refusedWord = Data([0x69, 0x85])
    private let ledger = LedgerDevice(id: UUID(), name: "Nano X 1A2B")

    func testAnApprovedTransferIsSignedOnTheDeviceAndBroadcast() async throws {
        let rig = try await rig()
        let signing = rig.confirm()
        try await rig.pick(ledger)
        try await until { if case .confirming = rig.signer.stage { true } else { false } }
        XCTAssertEqual(rig.signer.stage, .confirming(hash: Self.padded(Self.transferHash)))
        XCTAssertEqual(rig.signer.account, rig.record, "the signer is the plan's account, not the active one")
        let line = LedgerSignCopy.signer(try XCTUnwrap(rig.signer.account))
        XCTAssertEqual(line, "Signing with \(rig.record.shortAddress) · Account 0")
        XCTAssertNil(LedgerSignCopy.connectNote(rig.signer.stage))
        let step = try await signing.value
        XCTAssertEqual(step, .broadcast(hash: Self.transferHash))
        XCTAssertEqual(rig.node.posts.filter(\.write).map(\.method), ["starknet_addInvokeTransaction"])
        XCTAssertEqual(rig.signer.stage, .idle, "the sheet closes once the plan leaves the device")
        XCTAssertTrue(try XCTUnwrap(rig.devices.made.last).closed, "the link closes when the send ends")
    }

    func testTheConnectStageSaysTheTransactionIsPausedAndNamesTheSigner() async throws {
        let rig = try await rig()
        let signing = rig.confirm()
        try await until { rig.signer.stage == .scanning }
        XCTAssertEqual(LedgerSignCopy.connectNote(rig.signer.stage), "The transaction is safely paused.")
        XCTAssertEqual(rig.signer.account?.address, rig.record.address)
        rig.signer.cancel()
        XCTAssertNil(rig.signer.account, "the sheet forgets the signer when it closes")
        _ = try await signing.value
    }

    func testAnApprovedDeploymentIsSignedOnTheDevice() async throws {
        let rig = try await rig(deploy: true)
        let signing = rig.confirm()
        try await rig.pick(ledger)
        let step = try await signing.value
        XCTAssertEqual(step, .broadcast(hash: Self.deploymentHash))
        XCTAssertEqual(rig.node.posts.filter(\.write).map(\.method), ["starknet_addDeployAccountTransaction"])
    }

    func testARefusalParksTheSendAndTryAgainSignsTheSameTransaction() async throws {
        let rig = try await rig { device in
            device.answerOnce[try Self.signRequest(Self.transferHash)] = Self.refusedWord
        }
        let signing = rig.confirm()
        try await rig.pick(ledger)
        try await until { if case .refused = rig.signer.stage { true } else { false } }
        XCTAssertEqual(rig.signer.stage, .refused(message: try Self.message("rejected-or-blind-signing-off")))
        XCTAssertTrue(rig.node.posts.allSatisfy { !$0.write }, "nothing is written while parked")
        rig.signer.retry()
        let step = try await signing.value
        XCTAssertEqual(step, .broadcast(hash: Self.transferHash))
        XCTAssertEqual(rig.devices.made.count, 1, "the connected Ledger is used again")
    }

    func testAnotherLedgerIsRefusedBeforeThePersonIsAsked() async throws {
        // The account holds account 1's key; the device holds account 0's at the path.
        let rig = try await rig(key: Self.key1)
        let signing = rig.confirm()
        try await rig.pick(ledger)
        try await until { if case .refused = rig.signer.stage { true } else { false } }
        XCTAssertEqual(rig.signer.stage, .refused(message: try Self.message("wrong-device")))
        let device = try XCTUnwrap(rig.devices.made.first)
        XCTAssertFalse(device.requests.contains { LedgerSigner.shownHash($0) != nil }, "no hash was sent to sign")
        XCTAssertTrue(device.closed, "another Ledger is needed")
        rig.signer.cancel()
        let step = try await signing.value
        XCTAssertEqual(step, .failed(failure: SendFailure(code: .signingFailed, hash: nil)))
    }

    func testALockedLedgerAsksToUnlockIt() async throws {
        let rig = try await rig { device in device.version = Data([0x55, 0x15]) }
        let signing = rig.confirm()
        try await rig.pick(ledger)
        try await until { if case .refused = rig.signer.stage { true } else { false } }
        XCTAssertEqual(rig.signer.stage, .refused(message: try Self.message("device-locked")))
        rig.signer.cancel()
        _ = try await signing.value
    }

    func testTheWalletLockingMidSignEndsThePlanUnsigned() async throws {
        var core: WalletCore?
        let rig = try await rig { device in
            device.onSend = { apdu in if LedgerSigner.shownHash(apdu) != nil { core?.lock() } }
        }
        core = rig.core
        let signing = rig.confirm()
        try await rig.pick(ledger)
        let step = try await signing.value
        XCTAssertEqual(step, .failed(failure: SendFailure(code: .locked, hash: nil)))
        XCTAssertTrue(rig.node.posts.allSatisfy { !$0.write })
    }

    func testADisconnectMidSignIsShownAndCancelClosesThePlan() async throws {
        let rig = try await rig { device in device.disconnectAfter = 3 }
        let signing = rig.confirm()
        try await rig.pick(ledger)
        try await until { if case .refused = rig.signer.stage { true } else { false } }
        guard case let .refused(message) = rig.signer.stage else {
            XCTFail("not refused")
            return
        }
        XCTAssertTrue(FriendlyErrorRules.ledgerMessages.values.contains(message), message)
        rig.signer.cancel()
        let step = try await signing.value
        XCTAssertEqual(step, .failed(failure: SendFailure(code: .signingFailed, hash: nil)))
        XCTAssertEqual(rig.signer.stage, .idle)
        XCTAssertThrowsError(try rig.driverPlan.advance(reply: .retryDevice), "the plan is closed")
    }

    func testCancelWhileTheDeviceAsksEndsTheLinkAndThePlan() async throws {
        let rig = try await rig(hold: true)
        let signing = rig.confirm()
        try await rig.pick(ledger)
        try await until { if case .confirming = rig.signer.stage { true } else { false } }
        rig.signer.cancel()
        let step = try await signing.value
        XCTAssertEqual(step, .failed(failure: SendFailure(code: .signingFailed, hash: nil)))
        XCTAssertTrue(try XCTUnwrap(rig.devices.made.first).closed)
        XCTAssertTrue(rig.node.posts.allSatisfy { !$0.write })
    }

    func testCancelDuringTheReconnectEndsWithoutListingLedgers() async throws {
        let scanner = FakeLedgerScanner(bluetooth: .ready, devices: [ledger])
        let script = try recordedLedgerExchanges(bundle: Bundle(for: Self.self))
        var connects = 0
        var release: CheckedContinuation<Void, Never>?
        let signer = LedgerSigner(scanner: scanner, osGate: LedgerOsCheck.skipped) { _ in
            connects += 1
            // The second connect (the session's Ledger again) waits until the test lets it fail.
            if connects > 1 {
                await withCheckedContinuation { release = $0 }
                throw LedgerLinkError.failed
            }
            return ReplayLedgerDevice(script: script)
        }
        let version = Data([0x5a, 0, 0, 0, 0])
        let first = Task { await signer.exchange(version, for: nil) }
        try await until { signer.stage == .scanning }
        signer.choose(ledger)
        _ = await first.value
        signer.finish()
        let second = Task { await signer.exchange(version, for: nil) }
        try await until { signer.stage == .connecting(ledger) }
        signer.cancel()
        release?.resume()
        let answer = await second.value
        XCTAssertNil(answer, "a cancel is not a failed reconnect")
        XCTAssertEqual(signer.stage, .idle, "the sheet stays closed")
        XCTAssertEqual(scanner.scans, 1, "no second list of Ledgers")
    }

    func testOnlyTheSignHashApduShowsAHash() throws {
        XCTAssertNil(LedgerSigner.shownHash(Data([0x5a, 0, 0, 0, 0])))
        XCTAssertEqual(LedgerSigner.shownHash(try Self.signRequest(Self.transferHash)), Self.padded(Self.transferHash))
        XCTAssertEqual(
            LedgerSignCopy.grouped("0x" + String(repeating: "ab", count: 32)),
            "0x " + Array(repeating: "abab", count: 16).joined(separator: " ")
        )
    }

    // MARK: Fixtures

    /// The connections the signer made; `hold` keeps the sign-hash request unanswered until the
    /// link closes, as a device waiting on the person.
    private final class Connections {
        var made: [ReplayLedgerDevice] = []
        var hold = false
    }

    private struct Rig {
        let core: WalletCore
        let record: AccountRecord
        let signer: LedgerSigner
        let devices: Connections
        let node: MockNode
        let driver: SendDriver
        let driverPlan: TransferPlan

        func confirm() -> Task<SendStep, Error> {
            Task { try await driver.run(from: .confirm) }
        }

        @MainActor
        func pick(_ ledger: LedgerDevice) async throws {
            try await until { signer.stage == .scanning }
            signer.choose(ledger)
        }
    }

    private func rig(
        key: String = key0,
        deploy: Bool = false,
        hold: Bool = false,
        configure: @escaping (ReplayLedgerDevice) throws -> Void = { _ in /* The recorded device. */ }
    ) async throws -> Rig {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let core = try WalletCore(dataDir: dir.path, clock: DeviceClock())
        let candidate = try XCTUnwrap(ledgerAccountCandidates(
            network: .sepolia,
            family: .openZeppelin,
            keys: [LedgerKey(scheme: .bramble, accountIndex: 0, publicKeyX: key)]
        ).first)
        let record = try core.createLedgerWallet(password: testPassword, request: candidate.request)
        if key == Self.key0 {
            // A second Ledger account, made active: the plan below is for one that is not.
            let other = try XCTUnwrap(ledgerAccountCandidates(
                network: .sepolia,
                family: .openZeppelin,
                keys: [LedgerKey(scheme: .bramble, accountIndex: 1, publicKeyX: Self.key1)]
            ).first)
            _ = try core.addLedgerAccount(request: other.request)
            XCTAssertNotEqual(try core.activeAccount()?.id, record.id)
        }
        let node = MockNode()
        node.deployed = !deploy
        node.deployEstimate = [
            "l1_data_gas_consumed": "0x1e0", "l1_data_gas_price": "0x5a0", "l1_gas_consumed": "0x0",
            "l1_gas_price": "0x2d5c6b1e1ef", "l2_gas_consumed": "0xf4240", "l2_gas_price": "0xb2d05e00",
            "overall_fee": "0xabc", "unit": "FRI"
        ]
        node.pendingHash = { (try? core.activity(accountId: record.id))?.first?.hash }
        let network = try sepolia()
        let plan = deploy
            ? try core.prepareDeployment(accountId: record.id)
            : try core.prepareTransfer(request: TransferRequest(
                network: .sepolia,
                accountId: record.id,
                tokenAddress: try XCTUnwrap(network.tokens.first { $0.symbol == "STRK" }).address,
                recipient: account1,
                amount: "1.5",
                feeBalance: nil
            ))
        let script = try recordedLedgerExchanges(bundle: Bundle(for: Self.self))
        let devices = Connections()
        devices.hold = hold
        let scanner = FakeLedgerScanner(bluetooth: .ready, devices: [ledger])
        let signer = LedgerSigner(scanner: scanner, osGate: LedgerOsCheck.skipped) { _ in
            let device = ReplayLedgerDevice(script: script)
            try configure(device)
            devices.made.append(device)
            return devices.hold ? HeldLedgerDevice(device) : device
        }
        let driver = SendDriver(plan: plan, network: network, transport: node, account: record, signer: signer)
        let reviewed = try await driver.run(from: .start)
        XCTAssertEqual(reviewed, .review)
        return Rig(
            core: core, record: record, signer: signer, devices: devices, node: node, driver: driver, driverPlan: plan
        )
    }

    private static func signRequest(_ hash: String) throws -> Data {
        try hexBytes("5a02010020" + padded(hash).dropFirst(2))
    }

    private static func padded(_ hash: String) -> String {
        let digits = hash.dropFirst(2)
        return "0x" + String(repeating: "0", count: 64 - digits.count) + digits
    }

    private static func message(_ code: String) throws -> String {
        try XCTUnwrap(FriendlyErrorRules.ledgerMessages[code])
    }
}

/// Waits, a turn at a time, for `condition`; fails after a few seconds.
@MainActor
func until(_ condition: () -> Bool, turns: Int = 5_000) async throws {
    for _ in 0 ..< turns {
        if condition() { return }
        try await Task.sleep(for: .milliseconds(1))
    }
    XCTFail("condition never held")
}

/// A device waiting on the person: the sign-hash request is never answered until the link closes.
@MainActor
final class HeldLedgerDevice: LedgerExchanging {
    let replay: ReplayLedgerDevice
    private var waiting: CheckedContinuation<Void, Never>?

    init(_ replay: ReplayLedgerDevice) {
        self.replay = replay
    }

    func send(_ apdu: Data) async -> LedgerExchange {
        guard LedgerSigner.shownHash(apdu) != nil else { return replay.send(apdu) }
        await withCheckedContinuation { waiting = $0 }
        return .failure(.disconnected)
    }

    func close() {
        replay.close()
        waiting?.resume()
        waiting = nil
    }
}
