import BrambleCore
import CoreBluetooth
import Foundation

/// A Ledger's Bluetooth LE link over CoreBluetooth: find, connect, subscribe, then whole writes
/// and notifications for `LedgerBleDriver`. The GATT identifiers are the core's
/// (`ledgerBleLink()`); this type never reads or alters what it carries.
///
/// Trust boundary: everything a peripheral sends is untrusted bytes, handed on unparsed. Failure:
/// a disconnect, Bluetooth turning off, or `close()` ends the link and every pending and later
/// call throws `LedgerLinkError.disconnected`; a failed write or notification throws `.failed`.
/// Untested on a device: neither simulator has Bluetooth.
@MainActor
final class LedgerBleLink: NSObject, LedgerLink {
    /// Connecting includes the pairing prompt a first connection shows, so this is generous.
    static let connectTimeoutMs: UInt32 = 30_000
    /// More unread notifications than any reply needs (64 KiB at 20 bytes a frame) ends the link.
    private static let inboxLimit = 4_096

    private let specs = ledgerBleLink().specs
    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var notifyChar: CBCharacteristic?
    private var writeChar: CBCharacteristic?
    private var withoutResponse = false
    private var closed = false
    private var inbox: [Data] = []
    private var pending: CheckedContinuation<Void, Error>?
    private var waitingForNotification: CheckedContinuation<Data, Error>?

    private var services: [CBUUID] { specs.map { CBUUID(string: $0.service) } }

    /// The identifiers of Ledgers the system is connected to, and of those `remembered` from an
    /// earlier connection. The first call turns the link's Bluetooth on (and asks for permission),
    /// so it finds nothing until Bluetooth is on. Scanning for a new device is not here yet.
    func ledgers(remembered: [UUID]) -> [UUID] {
        guard let manager = bluetooth(), manager.state == .poweredOn else { return [] }
        let known = manager.retrievePeripherals(withIdentifiers: remembered).map(\.identifier)
        let connected = manager.retrieveConnectedPeripherals(withServices: services).map(\.identifier)
        return known + connected.filter { !known.contains($0) }
    }

    /// Connects to the Ledger `id` (from `ledgers`), finds its service's characteristics and
    /// subscribes to notifications, within `connectTimeoutMs`. Pairing, when the device asks for
    /// it, happens here (the system prompts). On any failure the link is closed; Bluetooth off or
    /// an unknown device is `.disconnected`.
    func connect(_ id: UUID) async throws {
        guard let manager = bluetooth(), manager.state == .poweredOn, !closed,
              let target = manager.retrievePeripherals(withIdentifiers: [id]).first
        else {
            close()
            throw LedgerLinkError.disconnected
        }
        peripheral = target
        target.delegate = self
        do {
            let abandon: @Sendable () -> Void = { Task { @MainActor in self.close() } }
            try await withTimeout(Self.connectTimeoutMs, onTimeout: abandon) { try await self.open() }
        } catch {
            close()
            throw error
        }
    }

    private func open() async throws {
        guard let central, let target = peripheral else { throw LedgerLinkError.disconnected }
        try await wait { central.connect(target) }
        try await wait { target.discoverServices(services) }
        guard let service = target.services?.first(where: { services.contains($0.uuid) }),
              let spec = specs.first(where: { CBUUID(string: $0.service) == service.uuid })
        else { throw LedgerLinkError.failed }
        let notifyId = CBUUID(string: spec.notify)
        let writeId = CBUUID(string: spec.write)
        let writeCmdId = CBUUID(string: spec.writeCmd)
        try await wait { target.discoverCharacteristics([notifyId, writeId, writeCmdId], for: service) }
        let chars = service.characteristics ?? []
        let writeCmd = chars.first { $0.uuid == writeCmdId && $0.properties.contains(.writeWithoutResponse) }
        let notify = chars.first { $0.uuid == notifyId && $0.properties.contains(.notify) }
        writeChar = writeCmd ?? chars.first { $0.uuid == writeId && $0.properties.contains(.write) }
        withoutResponse = writeCmd != nil
        guard let notify, writeChar != nil else { throw LedgerLinkError.failed }
        notifyChar = notify
        try await wait { target.setNotifyValue(true, for: notify) }
    }

    private func bluetooth() -> CBCentralManager? {
        if central == nil { central = CBCentralManager(delegate: self, queue: nil) }
        return central
    }

    var maximumWriteLength: Int {
        peripheral?.maximumWriteValueLength(for: withoutResponse ? .withoutResponse : .withResponse) ?? 0
    }

    func write(_ frame: Data) async throws {
        guard !closed, let peripheral, let writeChar else { throw LedgerLinkError.disconnected }
        if withoutResponse {
            if !peripheral.canSendWriteWithoutResponse {
                try await wait { /* `peripheralIsReady` resumes it. */ }
            }
            peripheral.writeValue(frame, for: writeChar, type: .withoutResponse)
        } else {
            try await wait { peripheral.writeValue(frame, for: writeChar, type: .withResponse) }
        }
    }

    func nextNotification() async throws -> Data {
        guard !closed else { throw LedgerLinkError.disconnected }
        if !inbox.isEmpty { return inbox.removeFirst() }
        return try await withCheckedThrowingContinuation { waitingForNotification = $0 }
    }

    func close() {
        guard !closed else { return }
        closed = true
        inbox.removeAll()
        if let peripheral { central?.cancelPeripheralConnection(peripheral) }
        fail(LedgerLinkError.disconnected)
    }

    /// Runs `start`, then suspends until a delegate callback resumes `pending`.
    private func wait(_ start: () -> Void) async throws {
        guard !closed else { throw LedgerLinkError.disconnected }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            pending = cont
            start()
        }
    }

    private func resume(_ error: Error?) {
        let cont = pending
        pending = nil
        if let error { cont?.resume(throwing: error) } else { cont?.resume() }
    }

    private func fail(_ error: Error) {
        resume(error)
        waitingForNotification?.resume(throwing: error)
        waitingForNotification = nil
    }

    private func received(_ value: Data) {
        guard !closed else { return }
        if let waiter = waitingForNotification {
            waitingForNotification = nil
            waiter.resume(returning: value)
        } else if inbox.count < Self.inboxLimit {
            inbox.append(value)
        } else {
            close()
        }
    }
}

extension LedgerBleLink: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_: CBCentralManager) {
        // CoreBluetooth calls on the main queue (`queue: nil`). The parameter is not Sendable, so
        // the actor's own reference is read instead.
        MainActor.assumeIsolated {
            if self.central?.state != .poweredOn, peripheral != nil { close() }
        }
    }

    nonisolated func centralManager(_: CBCentralManager, didConnect _: CBPeripheral) {
        MainActor.assumeIsolated { resume(nil) }
    }

    nonisolated func centralManager(
        _: CBCentralManager,
        didFailToConnect _: CBPeripheral,
        error _: Error?
    ) {
        MainActor.assumeIsolated { close() }
    }

    nonisolated func centralManager(
        _: CBCentralManager,
        didDisconnectPeripheral _: CBPeripheral,
        error _: Error?
    ) {
        MainActor.assumeIsolated { close() }
    }
}

extension LedgerBleLink: CBPeripheralDelegate {
    nonisolated func peripheral(_: CBPeripheral, didDiscoverServices error: Error?) {
        let failed = error != nil
        MainActor.assumeIsolated { resume(failed ? LedgerLinkError.failed : nil) }
    }

    nonisolated func peripheral(
        _: CBPeripheral,
        didDiscoverCharacteristicsFor _: CBService,
        error: Error?
    ) {
        let failed = error != nil
        MainActor.assumeIsolated { resume(failed ? LedgerLinkError.failed : nil) }
    }

    nonisolated func peripheral(
        _: CBPeripheral,
        didUpdateNotificationStateFor _: CBCharacteristic,
        error: Error?
    ) {
        let failed = error != nil
        MainActor.assumeIsolated { resume(failed ? LedgerLinkError.failed : nil) }
    }

    nonisolated func peripheral(
        _: CBPeripheral,
        didWriteValueFor _: CBCharacteristic,
        error: Error?
    ) {
        let failed = error != nil
        MainActor.assumeIsolated { resume(failed ? LedgerLinkError.failed : nil) }
    }

    nonisolated func peripheralIsReady(toSendWriteWithoutResponse _: CBPeripheral) {
        MainActor.assumeIsolated { resume(nil) }
    }

    nonisolated func peripheral(
        _: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        let value = error == nil ? characteristic.value : nil
        MainActor.assumeIsolated {
            if let value { received(value) } else { fail(LedgerLinkError.failed) }
        }
    }
}
