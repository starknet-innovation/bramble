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
            pageSize: 1
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
