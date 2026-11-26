import BrambleCore
import Foundation
import Observation

/// A connected Ledger as the picker uses it: one APDU at a time. `LedgerBleDriver` is the real
/// one; tests replay transcripts.
@MainActor
protocol LedgerExchanging: AnyObject {
    /// The device's reply to `apdu`, or the transport failure.
    func send(_ apdu: Data) async -> LedgerExchange
    /// Ends the connection.
    func close()
}

extension LedgerBleDriver: LedgerExchanging {
    func send(_ apdu: Data) async -> LedgerExchange {
        await exchange(apdu)
    }
}

/// Connect a Ledger and pick its accounts (the extension's `onboard-session.ts`): wait for
/// Bluetooth, list Ledgers, connect to the one chosen, read a page of keys at Bramble's scheme
/// (`LedgerKeyReader`), place them (`ledgerAccountCandidates`), and keep the person's picks, one
/// more page at a time.
///
/// Trust boundary: every device byte goes to the core unread; a refusal is the core's code,
/// shown through `FriendlyError` (its Ledger table). Public keys and addresses only: nothing here
/// signs or writes the vault. Failure ends the connection; Retry starts again from the list.
@MainActor
@Observable
final class LedgerConnectModel {
    enum Stage: Equatable {
        /// Bluetooth is not on (or not known yet); nothing is scanned.
        case bluetooth(LedgerBluetooth)
        case scanning
        case connecting(LedgerDevice)
        case reading
        case picking
        case failed(String)
    }

    /// Keys read per device round (the core's page limit).
    static let pageSize: UInt32 = 5

    private(set) var stage = Stage.bluetooth(.unknown)
    private(set) var devices: [LedgerDevice] = []
    private(set) var candidates: [LedgerCandidate] = []
    /// Picked candidates, by address.
    private(set) var selected: Set<String> = []
    private(set) var loadingMore = false

    private let scanner: any LedgerScanning
    private let connector: (UUID) async throws -> any LedgerExchanging
    private let place: ([LedgerKey]) throws -> [LedgerCandidate]
    private let existing: Set<String>
    private let pageSize: UInt32
    private var device: (any LedgerExchanging)?
    private var nextIndex: UInt32 = 0
    /// Bumped by every restart and close, so a read that outlives its flow changes nothing.
    private var epoch = 0

    /// `existing`: addresses the wallet already holds, offered but never selectable. `place` turns
    /// a page of keys into candidates (the network and family).
    init(
        scanner: any LedgerScanning,
        connect: @escaping (UUID) async throws -> any LedgerExchanging,
        place: @escaping ([LedgerKey]) throws -> [LedgerCandidate],
        existing: Set<String>,
        pageSize: UInt32 = LedgerConnectModel.pageSize
    ) {
        self.scanner = scanner
        connector = connect
        self.place = place
        self.existing = Set(existing.map { $0.lowercased() })
        self.pageSize = pageSize
        scanner.changed = { [weak self] in self?.bluetoothChanged() }
        bluetoothChanged()
    }

    /// The requests the picked accounts make, in the order they were read.
    var chosen: [LedgerAccountRequest] {
        candidates.filter { selected.contains($0.address) }.map(\.request)
    }

    func isExisting(_ candidate: LedgerCandidate) -> Bool {
        existing.contains(candidate.address.lowercased())
    }

    func toggle(_ candidate: LedgerCandidate) {
        guard !isExisting(candidate) else { return }
        if selected.remove(candidate.address) == nil { selected.insert(candidate.address) }
    }

    /// Connects to `device` and reads the first page.
    func choose(_ device: LedgerDevice) async {
        guard stage == .scanning else { return }
        scanner.stopScan()
        stage = .connecting(device)
        let flow = epoch
        let connected: any LedgerExchanging
        do {
            connected = try await connector(device.id)
        } catch {
            guard flow == epoch else { return }
            fail("replug")
            return
        }
        guard flow == epoch else {
            connected.close()
            return
        }
        self.device = connected
        stage = .reading
        await readPage()
    }

    /// Reads the next page into the list.
    func more() async {
        guard stage == .picking, !loadingMore else { return }
        loadingMore = true
        await readPage()
        loadingMore = false
    }

    /// After a failure: drop the connection and what was read, and list Ledgers again.
    func retry() {
        close()
        candidates = []
        selected = []
        nextIndex = 0
        stage = .bluetooth(.unknown)
        bluetoothChanged()
    }

    /// Ends the connection and the scan; the screen is going away or the picks are taken.
    func close() {
        epoch += 1
        scanner.stopScan()
        device?.close()
        device = nil
    }

    private func bluetoothChanged() {
        devices = scanner.devices
        switch stage {
        case .bluetooth, .scanning:
            if scanner.bluetooth == .ready {
                stage = .scanning
                scanner.startScan()
                devices = scanner.devices
            } else {
                stage = .bluetooth(scanner.bluetooth)
            }

        case .connecting, .reading, .picking, .failed:
            // The connection reports a lost Bluetooth itself, as a disconnect.
            break
        }
    }

    private func readPage() async {
        guard let device else {
            fail("replug")
            return
        }
        let flow = epoch
        let outcome = await Self.read(scheme: .bramble, from: nextIndex, count: pageSize, over: device)
        guard flow == epoch else { return }
        switch outcome {
        case let .success(keys):
            do {
                candidates += try place(keys)
                nextIndex += UInt32(keys.count)
                stage = .picking
            } catch {
                fail("unexpected-device-error")
            }

        case let .failure(refusal):
            fail(refusal.reason)
        }
    }

    private func fail(_ reason: String) {
        close()
        stage = .failed(FriendlyError.message(reason))
    }

    /// The core's refusal code.
    struct Refusal: Error {
        let reason: String
    }

    /// One page of keys off `device`, every APDU and reply through a `LedgerKeyReader`.
    static func read(
        scheme: LedgerScheme,
        from start: UInt32,
        count: UInt32,
        over device: any LedgerExchanging
    ) async -> Result<[LedgerKey], Refusal> {
        guard let reader = try? LedgerKeyReader(scheme: scheme, startIndex: start, count: count) else {
            return .failure(Refusal(reason: "unexpected-device-error"))
        }
        var step = reader.start()
        while true {
            switch step {
            case let .send(apdu):
                switch await device.send(apdu) {
                case let .reply(reply):
                    step = reader.reply(reply: reply)

                case let .failure(failure):
                    step = reader.transportFailure(failure: failure)
                }

            case let .keys(keys):
                return .success(keys)

            case let .refused(reason):
                return .failure(Refusal(reason: reason))
            }
        }
    }
}
