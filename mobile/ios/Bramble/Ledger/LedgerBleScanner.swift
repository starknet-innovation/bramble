import BrambleCore
import CoreBluetooth
import Foundation

/// Bluetooth as the Ledger screens see it: only `.ready` (powered on) can scan or connect.
enum LedgerBluetooth: Equatable {
    case unknown, ready, off, unauthorized, unsupported
}

/// A Ledger in range or already connected to the phone. `name` is what the device advertises.
struct LedgerDevice: Equatable, Identifiable {
    let id: UUID
    let name: String
}

/// What the connect screen needs from Bluetooth: its state and the Ledgers it finds. Tests swap in
/// a fake.
@MainActor
protocol LedgerScanning: AnyObject {
    var bluetooth: LedgerBluetooth { get }
    var devices: [LedgerDevice] { get }
    /// Called after `bluetooth` or `devices` changes.
    var changed: (() -> Void)? { get set }
    /// Lists Ledgers the phone is connected to and scans for advertising ones. Does nothing until
    /// Bluetooth is on; call again once it is.
    func startScan()
    func stopScan()
}

/// Finds Ledgers over CoreBluetooth: advertisers of the services `ledgerBleLink()` names, plus
/// Ledgers the system is already connected to (a paired Ledger does not always advertise).
///
/// Trust boundary: a name is whatever the peripheral advertises and is only shown. The first read
/// of `bluetooth` (or scan) asks for Bluetooth permission, never creating the scanner; a refusal
/// is `.unauthorized`.
@MainActor
final class LedgerBleScanner: NSObject, LedgerScanning {
    /// Bluetooth's state. The first read creates the CoreBluetooth manager, which is when iOS asks
    /// for Bluetooth permission: only a Ledger screen or a Ledger signature reads it.
    var bluetooth: LedgerBluetooth {
        _ = manager()
        return state
    }

    private var state = LedgerBluetooth.unknown
    private(set) var devices: [LedgerDevice] = []
    var changed: (() -> Void)?

    private let services = ledgerBleLink().specs.map { CBUUID(string: $0.service) }
    private var central: CBCentralManager?

    /// Whether the CoreBluetooth manager exists yet (and so the permission was asked).
    var awake: Bool { central != nil }

    func startScan() {
        let radio = manager()
        guard radio.state == .poweredOn else { return }
        for peripheral in radio.retrieveConnectedPeripherals(withServices: services) {
            found(peripheral.identifier, name: peripheral.name)
        }
        if !radio.isScanning { radio.scanForPeripherals(withServices: services) }
    }

    func stopScan() {
        if central?.isScanning == true { central?.stopScan() }
    }

    /// The CoreBluetooth manager, created on first use, never at init.
    private func manager() -> CBCentralManager {
        if let central { return central }
        let made = CBCentralManager(delegate: self, queue: nil)
        central = made
        return made
    }

    private func found(_ id: UUID, name: String?) {
        guard !devices.contains(where: { $0.id == id }) else { return }
        devices.append(LedgerDevice(id: id, name: name ?? "Ledger"))
        changed?()
    }

    /// CoreBluetooth's state in the screens' terms.
    nonisolated static func bluetooth(_ state: CBManagerState) -> LedgerBluetooth {
        switch state {
        case .poweredOn:
            .ready

        case .poweredOff:
            .off

        case .unauthorized:
            .unauthorized

        case .unsupported:
            .unsupported

        case .unknown, .resetting:
            .unknown

        @unknown default:
            .unknown
        }
    }
}

extension LedgerBleScanner: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_: CBCentralManager) {
        // CoreBluetooth calls on the main queue (`queue: nil`); the actor's own reference is read.
        MainActor.assumeIsolated {
            state = Self.bluetooth(central?.state ?? .unknown)
            if state != .ready { devices.removeAll() }
            changed?()
        }
    }

    nonisolated func centralManager(
        _: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi _: NSNumber
    ) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name
        let id = peripheral.identifier
        MainActor.assumeIsolated { found(id, name: name) }
    }
}
