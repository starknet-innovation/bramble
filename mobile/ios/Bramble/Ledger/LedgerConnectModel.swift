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
/// Bluetooth, list Ledgers, connect to the one chosen, run the device OS gate (`LedgerOsCheck`),
/// read a page of keys at each of the route's
/// schemes (`LedgerKeyReader`), place them per family (`ledgerAccountCandidates`), check each
/// address on chain and preselect the active ones, and keep the person's picks, one more page at
/// a time.
///
/// Trust boundary: every device byte goes to the core unread; a refusal is the core's code,
/// shown through `FriendlyError` (its Ledger table). On-chain state is untrusted and only decides
/// what is listed and preselected. Public keys and addresses only: nothing here signs or writes
/// the vault. Failure ends the connection; Retry starts again from the list.
@MainActor
@Observable
final class LedgerConnectModel {
    enum Stage: Equatable {
        /// Bluetooth is not on (or not known yet); nothing is scanned.
        case bluetooth(LedgerBluetooth)
        case scanning
        case connecting(LedgerDevice)
        /// The device OS gate, at its `phase`: Starknet closes and reopens.
        case checking(phase: String)
        case reading
        case picking
        case failed(String)
    }

    /// Keys read per device round (the core's page limit).
    static let pageSize: UInt32 = 5

    private(set) var stage = Stage.bluetooth(.unknown)
    private(set) var devices: [LedgerDevice] = []
    private(set) var rows: [LedgerRow] = []
    /// Picked rows, by address.
    private(set) var selected: Set<String> = []
    private(set) var loadingMore = false

    private let scanner: any LedgerScanning
    private let connector: (UUID) async throws -> any LedgerExchanging
    private let place: ([LedgerKey], AccountFamily) throws -> [LedgerCandidate]
    private let describe: @Sendable (String) async -> LedgerActivity
    private let existing: Set<String>
    private let osGate: LedgerOsCheck.Run
    let route: LedgerRoute
    private let pageSize: UInt32
    private var device: (any LedgerExchanging)?
    private var nextIndex: UInt32 = 0
    /// Bumped by every restart and close, so a read that outlives its flow changes nothing.
    private var epoch = 0

    /// `existing`: addresses the wallet already holds, offered but never selectable. `place` turns
    /// a page of keys into one family's candidates on the network; `describe` reads an address's
    /// on-chain state.
    init(
        route: LedgerRoute,
        scanner: any LedgerScanning,
        connect: @escaping (UUID) async throws -> any LedgerExchanging,
        place: @escaping ([LedgerKey], AccountFamily) throws -> [LedgerCandidate],
        describe: @escaping @Sendable (String) async -> LedgerActivity,
        existing: Set<String>,
        pageSize: UInt32 = LedgerConnectModel.pageSize,
        osGate: @escaping LedgerOsCheck.Run = LedgerOsCheck.run
    ) {
        self.route = route
        self.scanner = scanner
        connector = connect
        self.place = place
        self.describe = describe
        self.existing = Set(existing.map(Self.canonical))
        self.pageSize = pageSize
        self.osGate = osGate
        scanner.changed = { [weak self] in self?.bluetoothChanged() }
        bluetoothChanged()
    }

    /// The requests the picked accounts make, in the order they were read.
    var chosen: [LedgerAccountRequest] {
        rows.filter { $0.selectable && selected.contains($0.id) }.map(\.candidate.request)
    }

    /// The picker's groups for this route.
    var groups: [LedgerGroup] {
        LedgerGroup.groups(rows, route: route)
    }

    func toggle(_ row: LedgerRow) {
        guard row.selectable else { return }
        if selected.remove(row.id) == nil { selected.insert(row.id) }
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
        stage = .checking(phase: "")
        let reconnect: @MainActor () async -> (any LedgerExchanging)? = { [weak self] in
            await self?.reconnect(device.id, flow: flow)
        }
        let checked = await osGate(connected, reconnect) { [weak self] phase in
            if self?.epoch == flow { self?.stage = .checking(phase: phase) }
        }
        guard flow == epoch else { return }
        switch checked {
        case let .success(link):
            self.device = link

        case let .failure(refusal):
            fail(refusal.reason)
            return
        }
        stage = .reading
        await readPage()
    }

    /// The same Ledger again, after the OS gate's app change dropped the link; nil once the flow ended.
    private func reconnect(_ id: UUID, flow: Int) async -> (any LedgerExchanging)? {
        guard flow == epoch, let link = try? await connector(id) else { return nil }
        guard flow == epoch else {
            link.close()
            return nil
        }
        device = link
        return link
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
        rows = []
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

        case .connecting, .checking, .reading, .picking, .failed:
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
        var pages: [(LedgerScheme, [LedgerKey])] = []
        for scheme in route.schemes {
            let outcome = await Self.read(scheme: scheme, from: nextIndex, count: pageSize, over: device)
            guard flow == epoch else { return }
            switch outcome {
            case let .success(keys):
                pages.append((scheme, keys))

            case let .failure(refusal):
                fail(refusal.reason)
                return
            }
        }
        let placed: [LedgerCandidate]
        do {
            placed = try pages.flatMap { scheme, keys in
                try LedgerRoute.families(scheme).flatMap { try place(keys, $0) }
            }
        } catch {
            fail("unexpected-device-error")
            return
        }
        rows += placed.map { candidate in
            let held = existing.contains(Self.canonical(candidate.address))
            return LedgerRow(candidate: candidate, activity: nil, existing: held)
        }
        nextIndex += UInt32(pages.first?.1.count ?? 0)
        stage = .picking
        await check(placed.map(\.address), flow: flow)
    }

    /// Reads each address's on-chain state, then selects every active, selectable row
    /// (`applyDescribed`).
    private func check(_ addresses: [String], flow: Int) async {
        let read = describe
        let found = await withTaskGroup(of: (String, LedgerActivity).self) { group in
            for address in addresses {
                group.addTask { await (address, read(address)) }
            }
            var results: [String: LedgerActivity] = [:]
            for await (address, activity) in group { results[address] = activity }
            return results
        }
        guard flow == epoch else { return }
        rows = rows.map { row in
            guard let activity = found[row.id] else { return row }
            var updated = row
            updated.activity = activity
            return updated
        }
        for row in rows where found[row.id] != nil && row.active && row.selectable {
            selected.insert(row.id)
        }
    }

    private func fail(_ reason: String) {
        close()
        stage = .failed(FriendlyError.message(reason))
    }

    /// An address in the core's canonical felt form, so padded and unpadded spellings match.
    nonisolated static func canonical(_ address: String) -> String {
        validateRecipient(input: address) ?? address.lowercased()
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
