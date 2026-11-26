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
/// Trust boundary: a name is whatever the peripheral advertises and is only shown. Creating the
/// scanner asks for Bluetooth permission the first time; a refusal is `.unauthorized`.
@MainActor
final class LedgerBleScanner: NSObject, LedgerScanning {
    private(set) var bluetooth = LedgerBluetooth.unknown
    private(set) var devices: [LedgerDevice] = []
    var changed: (() -> Void)?

    private let services = ledgerBleLink().specs.map { CBUUID(string: $0.service) }
    private var central: CBCentralManager?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: nil)
    }

    func startScan() {
        guard let central, central.state == .poweredOn else { return }
        for peripheral in central.retrieveConnectedPeripherals(withServices: services) {
            found(peripheral.identifier, name: peripheral.name)
        }
        if !central.isScanning { central.scanForPeripherals(withServices: services) }
    }

    func stopScan() {
        if central?.isScanning == true { central?.stopScan() }
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
            bluetooth = Self.bluetooth(central?.state ?? .unknown)
            if bluetooth != .ready { devices.removeAll() }
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
