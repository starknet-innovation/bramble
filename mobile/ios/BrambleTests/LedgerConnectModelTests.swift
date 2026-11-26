@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// The Ledger connect-and-pick model over a fake scanner and a device replaying the Speculos
/// transcripts (`extension-ledger.jsonl`), through the real core reader and address placement.
/// Pages are one key, so the two recorded keys at each scheme make two pages.
@MainActor
final class LedgerConnectModelTests: XCTestCase {
    private let ledger = LedgerDevice(id: UUID(), name: "Nano X 1A2B")
    private static let bramble0 = "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"
    /// Hex digits in a fully padded felt.
    private static let feltDigits = 64
    private static let ready0 = "0x64f0159222d0f6468f10db7eb536888f90432122d34336120d04fad77424a86"

    func testBrambleKeysArePlacedAsBrambleAndArgentAccounts() async throws {
        let picked = try picker(.bramble)
        await picked.model.choose(ledger)
        let model = picked.model
        XCTAssertEqual(model.stage, .picking)
        XCTAssertEqual(model.rows.map(\.family), [.openZeppelin, .argent])
        XCTAssertTrue(model.rows.allSatisfy { $0.candidate.request.scheme == .bramble })
        XCTAssertTrue(model.rows.allSatisfy { $0.candidate.request.publicKeyX == Self.bramble0 })
        let placed = try Self.address(.bramble, Self.bramble0, .argent)
        XCTAssertEqual(model.rows.last?.id, placed)
        XCTAssertFalse(picked.device.closed)
        XCTAssertEqual(model.groups.map(\.title), ["Bramble accounts", "Argent accounts"])
    }

    func testTheOnChainCheckPreselectsActiveAccountsOnly() async throws {
        // The Bramble account is funded, the Argent one unused.
        let funded = try Self.address(.bramble, Self.bramble0, .openZeppelin)
        let picked = try picker(.bramble) { address in
            LedgerActivity(deployed: .absent, funded: address == funded ? .present : .absent)
        }
        let model = picked.model
        await model.choose(ledger)
        let bramble = try XCTUnwrap(model.rows.first)
        let argent = try XCTUnwrap(model.rows.last)
        XCTAssertEqual(bramble.status, "Funded and ready to deploy")
        XCTAssertTrue(bramble.selectable)
        XCTAssertFalse(argent.selectable, "an unused Argent account would be deployed new")
        XCTAssertEqual(argent.status, "No on-chain activity found — Bramble only imports existing Argent accounts")
        XCTAssertEqual(model.chosen, [bramble.candidate.request])
        model.toggle(argent)
        XCTAssertEqual(model.chosen, [bramble.candidate.request])
        model.toggle(bramble)
        XCTAssertTrue(model.chosen.isEmpty)
    }

    func testReadyReadsReadysSchemeAsArgentAccounts() async throws {
        let picked = try picker(.ready) { _ in LedgerActivity(deployed: .present, funded: .absent) }
        await picked.model.choose(ledger)
        let row = try XCTUnwrap(picked.model.rows.first)
        XCTAssertEqual(picked.model.rows.count, 1)
        XCTAssertEqual(row.candidate.request.scheme, .ready)
        XCTAssertEqual(row.family, .argent)
        XCTAssertEqual(row.candidate.request.publicKeyX, Self.ready0)
        XCTAssertEqual(row.status, "Deployed on Starknet")
        XCTAssertEqual(picked.model.chosen, [row.candidate.request])
        XCTAssertEqual(LedgerCopy.title(picked.model), "Select Ready accounts")
        XCTAssertEqual(picked.model.groups.map(\.title), ["Ready accounts"])
    }

    func testFirstRunReadsBothSchemes() async throws {
        let picked = try picker(.firstRun)
        await picked.model.choose(ledger)
        let rows = picked.model.rows
        XCTAssertEqual(rows.map(\.family), [.openZeppelin, .argent, .argent])
        XCTAssertEqual(rows.map(\.candidate.request.scheme), [.bramble, .bramble, .ready])
        // An unused Argent account at Bramble's path is left out beside Ready's.
        XCTAssertEqual(picked.model.groups.map(\.title), ["Bramble accounts", "Ready accounts"])
        XCTAssertEqual(picked.model.groups.last?.rows.map(\.candidate.request.scheme), [.ready])
    }

    func testShowMoreReadsTheNextPage() async throws {
        let picked = try picker(.bramble)
        await picked.model.choose(ledger)
        await picked.model.more()
        XCTAssertEqual(picked.model.stage, .picking)
        XCTAssertEqual(picked.model.rows.map(\.candidate.request.accountIndex), [0, 0, 1, 1])
        XCTAssertFalse(picked.model.loadingMore)
    }

    func testAnAppBelowTheMinimumIsRefusedWithItsMessage() async throws {
        let picked = try picker(.bramble)
        picked.device.version = try hexBytes("0203099000")
        await picked.model.choose(ledger)
        XCTAssertEqual(picked.model.stage, .failed(try Self.message("app-below-minimum")))
        XCTAssertTrue(picked.model.rows.isEmpty)
        XCTAssertTrue(picked.device.closed)
    }

    func testAWrongAppOrALockedDeviceIsRefused() async throws {
        for (status, code) in [("6d00", "no-app-open"), ("6e00", "no-app-open"), ("5515", "device-locked")] {
            let picked = try picker(.bramble)
            picked.device.version = try hexBytes(status)
            await picked.model.choose(ledger)
            XCTAssertEqual(picked.model.stage, .failed(try Self.message(code)), status)
        }
    }

    func testADisconnectMidReadFailsAndRetryListsLedgersAgain() async throws {
        // Lost at the version check it is a disconnect; lost at a key, the core reads it as the
        // Starknet library's swallowed failure, as the extension does.
        let picked = try picker(.bramble)
        picked.device.disconnectAfter = 0
        await picked.model.choose(ledger)
        XCTAssertEqual(picked.model.stage, .failed(try Self.message("disconnected-mid-sign")))
        XCTAssertTrue(picked.device.closed)
        let later = try picker(.bramble)
        later.device.disconnectAfter = 1
        await later.model.choose(ledger)
        XCTAssertEqual(later.model.stage, .failed(try Self.message("unexpected-device-error")))
        picked.model.retry()
        XCTAssertEqual(picked.model.stage, .scanning)
        XCTAssertEqual(picked.scanner.scans, 2)
    }

    func testAFailedConnectionAsksForAReconnect() async throws {
        let model = LedgerConnectModel(
            route: .bramble,
            scanner: FakeLedgerScanner(bluetooth: .ready, devices: [ledger]),
            connect: { _ in throw LedgerLinkError.disconnected },
            place: Self.place,
            describe: { _ in .unknown },
            existing: []
        )
        await model.choose(ledger)
        XCTAssertEqual(model.stage, .failed(try Self.message("replug")))
    }

    func testPermissionDeniedAndBluetoothOffNeverScan() throws {
        for state in [LedgerBluetooth.unauthorized, .off, .unsupported, .unknown] {
            let picked = try picker(.bramble, bluetooth: state)
            XCTAssertEqual(picked.model.stage, .bluetooth(state))
            XCTAssertEqual(picked.scanner.scans, 0)
            XCTAssertNotNil(LedgerCopy.bluetooth(state))
            picked.scanner.set(.ready)
            XCTAssertEqual(picked.model.stage, .scanning)
            XCTAssertEqual(picked.scanner.scans, 1)
            XCTAssertEqual(picked.model.devices, [ledger])
            picked.scanner.set(.off)
            XCTAssertEqual(picked.model.stage, .bluetooth(.off))
        }
    }

    func testAnAccountAlreadyInTheWalletCannotBePicked() async throws {
        let held = try Self.address(.bramble, Self.bramble0, .openZeppelin).uppercased()
        let picked = try picker(.bramble, existing: [held]) { _ in
            LedgerActivity(deployed: .present, funded: .present)
        }
        await picked.model.choose(ledger)
        let first = try XCTUnwrap(picked.model.rows.first)
        XCTAssertFalse(first.selectable)
        XCTAssertEqual(first.status, "Already in this wallet")
        picked.model.toggle(first)
        XCTAssertFalse(picked.model.chosen.contains(first.candidate.request))
    }

    func testAPaddedHeldAddressStillMatches() async throws {
        let address = try Self.address(.bramble, Self.bramble0, .openZeppelin)
        let digits = address.dropFirst(2)
        let padded = "0x" + String(repeating: "0", count: Self.feltDigits - digits.count) + digits
        XCTAssertNotEqual(padded, address, "the held spelling differs from the core's")
        let picked = try picker(.bramble, existing: [padded]) { _ in
            LedgerActivity(deployed: .present, funded: .present)
        }
        await picked.model.choose(ledger)
        XCTAssertEqual(picked.model.rows.first?.status, "Already in this wallet")
    }

    func testAFailedCheckIsNotCheckingForever() async throws {
        let picked = try picker(.bramble) { _ in .unknown }
        await picked.model.choose(ledger)
        XCTAssertEqual(picked.model.rows.first?.status, LedgerRow.unchecked)
        XCTAssertNotEqual(picked.model.rows.first?.status, "Checking…")
    }

    // MARK: Fixtures

    private struct Picker {
        let model: LedgerConnectModel
        let scanner: FakeLedgerScanner
        let device: ReplayLedgerDevice
    }

    private func picker(
        _ route: LedgerRoute,
        bluetooth: LedgerBluetooth = .ready,
        existing: Set<String> = [],
        describe: @escaping @Sendable (String) -> LedgerActivity = { _ in
            LedgerActivity(deployed: .absent, funded: .absent)
        }
    ) throws -> Picker {
        let scanner = FakeLedgerScanner(bluetooth: bluetooth, devices: [ledger])
        let device = ReplayLedgerDevice(script: try recordedLedgerExchanges(bundle: Bundle(for: Self.self)))
        let model = LedgerConnectModel(
            route: route,
            scanner: scanner,
            connect: { _ in device },
            place: Self.place,
            describe: { describe($0) },
            existing: existing,
            pageSize: 1,
            osGate: LedgerOsCheck.skipped
        )
        return Picker(model: model, scanner: scanner, device: device)
    }

    private static func place(_ keys: [LedgerKey], _ family: AccountFamily) throws -> [LedgerCandidate] {
        try ledgerAccountCandidates(network: .mainnet, family: family, keys: keys)
    }

    private static func address(_ scheme: LedgerScheme, _ key: String, _ family: AccountFamily) throws -> String {
        try XCTUnwrap(place([LedgerKey(scheme: scheme, accountIndex: 0, publicKeyX: key)], family).first?.address)
    }

    private static func message(_ code: String) throws -> String {
        try XCTUnwrap(FriendlyErrorRules.ledgerMessages[code])
    }
}

/// The device OS gate at the start of the connect flow (wallet-core #199), through the real core's
/// `LedgerOsGate` against a simulated Ledger: Starknet open, closed for the dashboard's OS read,
/// then reopened, each app change dropping the link.
@MainActor
extension LedgerConnectModelTests {
    private func gated(_ configure: (GatedLedger) -> Void = { _ in /* A supported Nano X. */ }) throws
        -> (LedgerConnectModel, GatedLedger) {
        let script = try recordedLedgerExchanges(bundle: Bundle(for: Self.self))
        let ledger = GatedLedger(replay: ReplayLedgerDevice(script: script))
        configure(ledger)
        let model = LedgerConnectModel(
            route: .bramble,
            scanner: FakeLedgerScanner(bluetooth: .ready, devices: [self.ledger]),
            connect: { _ in try ledger.connect() },
            place: { keys, family in try ledgerAccountCandidates(network: .mainnet, family: family, keys: keys) },
            describe: { _ in LedgerActivity(deployed: .absent, funded: .absent) },
            existing: [],
            pageSize: 1
        )
        return (model, ledger)
    }

    func testASupportedLedgerPassesTheGateAndIsRead() async throws {
        let (model, ledger) = try gated()
        var phases: [String] = []
        ledger.onSend = { _ in if case let .checking(phase) = model.stage { phases.append(phase) } }
        await model.choose(self.ledger)
        XCTAssertEqual(model.stage, .picking)
        XCTAssertEqual(ledger.connections, 3, "the first link, then after closing and after reopening Starknet")
        XCTAssertEqual(ledger.app, "Starknet")
        XCTAssertTrue(phases.contains(LedgerOsCheck.openingStarknet))
        XCTAssertEqual(
            LedgerCopy.checking(LedgerOsCheck.openingStarknet),
            "Approve opening Starknet on your Ledger. No transaction is signed."
        )
        XCTAssertFalse(model.rows.isEmpty)
    }

    func testAnOsBelowTheMinimumIsRefused() async throws {
        let (model, ledger) = try gated { $0.osVersion = "2.2.3" }
        await model.choose(self.ledger)
        XCTAssertEqual(model.stage, .failed(try XCTUnwrap(FriendlyErrorRules.ledgerMessages["firmware-below-minimum"])))
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertTrue(ledger.allClosed)
    }

    func testDecliningTheAppChangeIsRejectedOnDevice() async throws {
        let (model, ledger) = try gated { $0.declineOpen = true }
        await model.choose(self.ledger)
        XCTAssertEqual(model.stage, .failed(try XCTUnwrap(FriendlyErrorRules.ledgerMessages["rejected-on-device"])))
        XCTAssertTrue(ledger.allClosed)
    }

    func testADisconnectMidGateFailsAndReadsNothing() async throws {
        // The Ledger never comes back after Starknet closes.
        let (model, ledger) = try gated { $0.connectionsAllowed = 1 }
        await model.choose(self.ledger)
        guard case .failed = model.stage else {
            XCTFail("a lost Ledger ends the gate: \(model.stage)")
            return
        }
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertEqual(ledger.replay.requests, [], "no key is read before the gate passes")
    }
}

/// The signer runs the same gate once per Ledger per session, as the extension's sign session does
/// unless the live session was already verified.
@MainActor
extension LedgerConnectModelTests {
    private static let versionRequest = Data([0x5a, 0, 0, 0, 0])

    private func gatedSigner(_ configure: (GatedLedger) -> Void = { _ in /* Supported. */ }) throws
        -> (LedgerSigner, GatedLedger) {
        let script = try recordedLedgerExchanges(bundle: Bundle(for: Self.self))
        let gated = GatedLedger(replay: ReplayLedgerDevice(script: script))
        configure(gated)
        let signer = LedgerSigner(scanner: FakeLedgerScanner(bluetooth: .ready, devices: [ledger])) { _ in
            try gated.connect()
        }
        return (signer, gated)
    }

    func testTheSignerGatesALedgerOnceASession() async throws {
        let (signer, gated) = try gatedSigner()
        let first = Task { await signer.exchange(Self.versionRequest, for: nil) }
        try await until { signer.stage == .scanning }
        signer.choose(ledger)
        guard case .device = await first.value else {
            XCTFail("the gate passes, then the version is read")
            return
        }
        XCTAssertEqual(gated.connections, 3)
        signer.finish()
        let again = Task { await signer.exchange(Self.versionRequest, for: nil) }
        guard case .device = await again.value else {
            XCTFail("the same Ledger is not gated again")
            return
        }
        XCTAssertEqual(gated.connections, 4, "one plain reconnect, no app change")
        signer.finish()
    }

    func testTheSignerShowsTheGatesRefusal() async throws {
        let (signer, _) = try gatedSigner { $0.osVersion = "2.2.3" }
        let first = Task { await signer.exchange(Self.versionRequest, for: nil) }
        try await until { signer.stage == .scanning }
        signer.choose(ledger)
        guard case .deviceFailure = await first.value else {
            XCTFail("a refused gate connects nothing")
            return
        }
        let decision = Task { await signer.refused("disconnected-mid-sign", for: nil) }
        try await until { if case .refused = signer.stage { true } else { false } }
        let message = try XCTUnwrap(FriendlyErrorRules.ledgerMessages["firmware-below-minimum"])
        XCTAssertEqual(signer.stage, .refused(message: message))
        signer.cancel()
        let retried = await decision.value
        XCTAssertFalse(retried)
    }
}

/// A Ledger as the OS gate sees it: `app` open (Starknet first); closing or opening an app drops
/// the link; the dashboard reports `os` for a Nano X. Every other request is the recorded device's.
@MainActor
final class GatedLedger {
    let replay: ReplayLedgerDevice
    var app = "Starknet"
    var osVersion = "2.6.1"
    var declineOpen = false
    /// Links that may be opened; past it a connect fails, as a Ledger that never came back.
    var connectionsAllowed = Int.max
    var onSend: ((Data) -> Void)?
    private(set) var connections = 0
    private var links: [GatedLink] = []

    init(replay: ReplayLedgerDevice) {
        self.replay = replay
    }

    var allClosed: Bool { links.allSatisfy(\.closed) }

    func connect() throws -> any LedgerExchanging {
        guard connections < connectionsAllowed else { throw LedgerLinkError.disconnected }
        connections += 1
        let link = GatedLink(ledger: self)
        links.append(link)
        return link
    }

    /// `GetAppAndVersion`'s reply naming `name`, as wallet-core's gate tests build it.
    static func appReply(_ name: String) -> Data {
        bytes("01" + counted(name) + counted("2.4.3") + "009000")
    }

    /// `GetOsVersion`'s reply: a Nano X (`0x33000004`) on `version`.
    static func osReply(_ version: String) -> Data {
        bytes("33000004" + counted(version) + "04e6000000" + counted("2.30") + "9000")
    }

    static let appState = bytes("b001000000")
    static let quitApp = bytes("b0a7000000")
    static let osVersionRequest = bytes("e001000000")
    static let openStarknet = bytes("e0d8000008" + hex("Starknet"))
    static let declined = bytes("5501")

    private static func hex(_ text: String) -> String {
        text.utf8.map { String(format: "%02x", $0) }.joined()
    }

    /// `text`'s length byte, then its bytes.
    private static func counted(_ text: String) -> String {
        String(format: "%02x", text.utf8.count) + hex(text)
    }

    private static func bytes(_ digits: String) -> Data {
        (try? hexBytes(digits)) ?? Data()
    }
}

@MainActor
final class GatedLink: LedgerExchanging {
    private let ledger: GatedLedger
    private(set) var closed = false

    init(ledger: GatedLedger) {
        self.ledger = ledger
    }

    func send(_ apdu: Data) -> LedgerExchange {
        guard !closed else { return .failure(.disconnected) }
        ledger.onSend?(apdu)
        switch apdu {
        case GatedLedger.appState:
            return .reply(GatedLedger.appReply(ledger.app))

        case GatedLedger.quitApp:
            ledger.app = "BOLOS"
            closed = true
            return .failure(.disconnected)

        case GatedLedger.osVersionRequest:
            return .reply(GatedLedger.osReply(ledger.osVersion))

        case GatedLedger.openStarknet:
            if ledger.declineOpen { return .reply(GatedLedger.declined) }
            ledger.app = "Starknet"
            closed = true
            return .failure(.disconnected)

        default:
            return ledger.replay.send(apdu)
        }
    }

    func close() {
        closed = true
    }
}
