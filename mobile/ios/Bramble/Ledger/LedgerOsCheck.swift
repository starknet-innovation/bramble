import BrambleCore
import Foundation

/// The device OS gate (wallet-core #199, the OS half of the extension's `assertLedgerDeviceReady`):
/// `LedgerOsGate` closes the open app, reads the OS on the dashboard, reopens Starknet (the person
/// may be asked on the device) and checks the model and version against Bramble's minimums.
///
/// Trust boundary: every APDU comes from the core and every reply goes back to it unread; this only
/// moves bytes and reconnects to the same device when the core says an app change dropped the link.
/// Failure: the core's refusal code (`firmware-below-minimum`, `rejected-on-device`, ...), shown
/// through `FriendlyError`; the link is closed.
enum LedgerOsCheck {
    /// Runs one gate over a connected device. `reconnect` opens the same device again (nil when it
    /// cannot, or the flow ended); `phase` sees each step's phase name. Returns the link to keep.
    typealias Run = @MainActor (
        _ device: any LedgerExchanging,
        _ reconnect: @escaping @MainActor () async -> (any LedgerExchanging)?,
        _ phase: @escaping @MainActor (String) -> Void
    ) async -> Result<any LedgerExchanging, LedgerConnectModel.Refusal>

    /// The phase in which the device asks the person to approve opening Starknet.
    static let openingStarknet = "opening-starknet"

    /// The real gate.
    static let run: Run = { device, reconnect, phase in
        let gate = LedgerOsGate()
        var link = device
        var step = gate.start()
        while true {
            switch step {
            case let .send(apdu, name):
                phase(name)
                switch await link.send(apdu) {
                case let .reply(reply):
                    step = gate.reply(reply: reply)

                case let .failure(failure):
                    step = gate.transportFailure(failure: failure)
                }

            case let .reconnect(name):
                phase(name)
                // The app change dropped the link; closing it again is harmless.
                link.close()
                guard let again = await reconnect() else {
                    step = gate.transportFailure(failure: .disconnected)
                    continue
                }
                link = again
                step = gate.reconnected()

            case .supported:
                return .success(link)

            case let .refused(reason):
                link.close()
                return .failure(LedgerConnectModel.Refusal(reason: reason))
            }
        }
    }

    /// Passes every device untouched: for tests of the flows around the gate.
    static let skipped: Run = { device, _, _ in .success(device) }
}
