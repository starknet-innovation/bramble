import BrambleCore
import Foundation
import Observation

/// What a plan driver needs from the device a Ledger account signs on. `LedgerSigner` is the
/// Bluetooth one; tests swap in their own.
@MainActor
protocol DeviceSigning: AnyObject, Sendable {
    /// The plan's reply to `apdu` (`StepReply.device` or `.deviceFailure`), connecting first when
    /// no device is connected; nil once the person cancelled. `account` is the record the plan was
    /// built for, shown as the signer; nil shows none.
    func exchange(_ apdu: Data, for account: AccountRecord?) async -> StepReply?
    /// Shows the core's refusal code and waits: true when the person tries again, false when they
    /// cancel.
    func refused(_ reason: String, for account: AccountRecord?) async -> Bool
    /// The plan left the device: close the link and the sheet.
    func finish()
}

/// Signing on a Ledger for every plan that reaches `SendStep.Device` (send, deploy, revoke,
/// staking, swap, a multisig execution) and for a gasless relay signature: the one "Confirm on
/// your Ledger" sheet. It connects to a Ledger (the one picked earlier this session first, else
/// the one the person picks from the list), relays each APDU unread and hands the answer back.
///
/// Trust boundary: the core checks the app version, the key at the account's path
/// (`wrong-device`, before the person confirms) and the signature against the account's key
/// before anything is written; nothing here judges a device byte. The hash shown is read from the
/// sign APDU the core built, so it is exactly what the device is asked to show.
///
/// Failure: a transport failure goes to the core as is and closes the link, so the next attempt
/// connects again. Cancel, `finish` and `close` (the wallet locked) end the link and any wait.
@MainActor
@Observable
final class LedgerSigner: DeviceSigning {
    enum Stage: Equatable {
        case idle
        case bluetooth(LedgerBluetooth)
        case scanning
        case connecting(LedgerDevice)
        /// The device OS gate at `phase`, once per Ledger per session: Starknet closes and reopens.
        case deviceCheck(phase: String)
        /// The core is checking the app and the key, before the person is asked.
        case checking
        /// The device shows `hash` (the sign APDU's) and waits for the person.
        case confirming(hash: String)
        /// The device refused; `message` is the core code's Bluetooth wording.
        case refused(message: String)
    }

    /// The core's code for a Ledger that does not hold the account's key.
    static let wrongDevice = "wrong-device"

    /// The app's one signer, over CoreBluetooth.
    static let shared = LedgerSigner(scanner: LedgerBleScanner()) { id in
        let link = LedgerBleLink()
        try await link.connect(id)
        return LedgerBleDriver(link: link)
    }

    private(set) var stage = Stage.idle
    private(set) var devices: [LedgerDevice] = []
    /// The account the plan was built for, given by the code that built it; nil shows no signer.
    private(set) var account: AccountRecord?
    /// The sheet is up while a plan waits on the device.
    var active: Bool { stage != .idle }

    private let scanner: any LedgerScanning
    private let connector: (UUID) async throws -> any LedgerExchanging
    private let osGate: LedgerOsCheck.Run
    private var device: (any LedgerExchanging)?
    /// The Ledger that passed the OS gate this session, as the extension's `readiness: verified`;
    /// forgotten at lock.
    private var verified: UUID?
    /// The gate's refusal code, shown in place of the plan's own when the connection it ended fails.
    private var gateRefusal: String?
    /// The Ledger connected earlier in this session, tried first; forgotten at lock.
    private var known: LedgerDevice?
    private var picking: CheckedContinuation<LedgerDevice?, Never>?
    private var deciding: CheckedContinuation<Bool, Never>?
    private var cancelled = false

    init(
        scanner: any LedgerScanning,
        osGate: @escaping LedgerOsCheck.Run = LedgerOsCheck.run,
        connect: @escaping (UUID) async throws -> any LedgerExchanging
    ) {
        self.scanner = scanner
        self.osGate = osGate
        connector = connect
    }

    func exchange(_ apdu: Data, for account: AccountRecord?) async -> StepReply? {
        if stage == .idle { cancelled = false }
        self.account = account
        guard !cancelled else { return nil }
        if device == nil {
            device = await connect()
            guard !cancelled else { return nil }
        }
        guard let device else { return .deviceFailure(failure: .disconnected) }
        stage = Self.shownHash(apdu).map { .confirming(hash: $0) } ?? .checking
        let outcome = await device.send(apdu)
        guard !cancelled else { return nil }
        switch outcome {
        case let .reply(reply):
            return .device(reply: reply)

        case let .failure(failure):
            // The driver closed its link: the next attempt connects again.
            self.device?.close()
            self.device = nil
            return .deviceFailure(failure: failure)
        }
    }

    func refused(_ reason: String, for account: AccountRecord?) async -> Bool {
        guard !cancelled else { return false }
        self.account = account
        if reason == Self.wrongDevice {
            // Another Ledger is needed: the next attempt lists them again.
            device?.close()
            device = nil
            known = nil
        }
        stage = .refused(message: FriendlyError.message(gateRefusal ?? reason))
        gateRefusal = nil
        return await withCheckedContinuation { deciding = $0 }
    }

    /// Try again after a refusal.
    func retry() {
        guard case .refused = stage else { return }
        stage = .checking
        decide(true)
    }

    /// Connects to `device`, picked from the list.
    func choose(_ device: LedgerDevice) {
        guard stage == .scanning else { return }
        picking?.resume(returning: device)
        picking = nil
    }

    /// "Cancel transaction": ends the link and every wait; the driver closes the plan.
    func cancel() {
        guard active else { return }
        cancelled = true
        end()
    }

    func finish() { end() }

    /// The wallet locked: end everything and forget the session's Ledger.
    func close() {
        cancelled = active || cancelled
        known = nil
        verified = nil
        end()
    }

    private func end() {
        scanner.stopScan()
        scanner.changed = nil
        device?.close()
        device = nil
        picking?.resume(returning: nil)
        picking = nil
        decide(false)
        stage = .idle
        account = nil
    }

    private func decide(_ again: Bool) {
        deciding?.resume(returning: again)
        deciding = nil
    }

    /// The session's Ledger first; else the list until the person picks one or cancels.
    private func connect() async -> (any LedgerExchanging)? {
        if let known, let connected = await open(known) { return connected }
        // Cancelled (or locked) during that reconnect: stop; only a failed reconnect lists Ledgers.
        guard !cancelled else { return nil }
        scanner.changed = { [weak self] in self?.bluetoothChanged() }
        stage = .bluetooth(.unknown)
        bluetoothChanged()
        guard let picked = await withCheckedContinuation({ picking = $0 }) else { return nil }
        scanner.stopScan()
        scanner.changed = nil
        return await open(picked)
    }

    private func open(_ ledger: LedgerDevice) async -> (any LedgerExchanging)? {
        stage = .connecting(ledger)
        guard let connected = await reopen(ledger) else { return nil }
        if verified != ledger.id {
            stage = .deviceCheck(phase: "")
            let checked = await osGate(connected, { [weak self] in await self?.reopen(ledger) }, { [weak self] phase in
                if self?.cancelled == false { self?.stage = .deviceCheck(phase: phase) }
            })
            device = nil
            switch checked {
            case let .success(link) where !cancelled:
                verified = ledger.id
                device = link

            case let .success(link):
                link.close()
                return nil

            case let .failure(refusal):
                gateRefusal = cancelled ? nil : refusal.reason
                return nil
            }
        }
        known = ledger
        return device
    }

    /// One connection to `ledger`, held as `device` so a cancel closes it; nil once cancelled.
    private func reopen(_ ledger: LedgerDevice) async -> (any LedgerExchanging)? {
        guard !cancelled, let connected = try? await connector(ledger.id) else { return nil }
        guard !cancelled else {
            connected.close()
            return nil
        }
        device = connected
        return connected
    }

    private func bluetoothChanged() {
        devices = scanner.devices
        switch stage {
        case .bluetooth, .scanning:
            if scanner.bluetooth == .ready {
                if stage != .scanning { scanner.startScan() }
                stage = .scanning
                devices = scanner.devices
            } else {
                stage = .bluetooth(scanner.bluetooth)
            }

        default:
            break
        }
    }

    /// The Starknet app's sign-hash APDU, as the core builds it: CLA, INS, P1 for the hash, P2,
    /// then the 32-byte hash.
    private enum SignHash {
        static let cla: UInt8 = 0x5a
        static let ins: UInt8 = 0x02
        static let hashBytes = 32
        static let header: [UInt8] = [cla, ins, 1, 0, UInt8(hashBytes)]
    }

    /// The hash a sign-hash APDU carries, at the full 64-digit width the device shows it; nil for
    /// any other APDU.
    nonisolated static func shownHash(_ apdu: Data) -> String? {
        let bytes = [UInt8](apdu)
        guard bytes.count == SignHash.header.count + SignHash.hashBytes,
              Array(bytes.prefix(SignHash.header.count)) == SignHash.header else { return nil }
        return "0x" + bytes.dropFirst(SignHash.header.count).map { String(format: "%02x", $0) }.joined()
    }
}
