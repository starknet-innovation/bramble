package org.bramble.wallet.ledger

import org.bramble.core.LedgerOsGateInterface
import org.bramble.core.LedgerOsStep
import org.bramble.core.TransportFailure

/** The phase in which the device asks the person to approve opening Starknet. */
const val OPENING_STARKNET = "opening-starknet"

/**
 * The Ledgers that passed the OS gate this session, by device id, as iOS `LedgerOsVerified`: the
 * extension's `readiness: "verified"`, which its onboarding and sign session both honour. The
 * connect flow and the signer share it, so a device asks at most once a session. The signer clears
 * it at lock; a dropped link, a wrong device or a failed connect flow forgets that one device.
 */
class LedgerOsVerified {
    /** The verified device ids. */
    val ids = mutableSetOf<String>()

    /** [runOsGate] on device [id] unless it passed this session; a pass is remembered. */
    suspend fun check(
        id: String,
        device: LedgerExchanging,
        gate: () -> LedgerOsGateInterface,
        reconnect: suspend () -> LedgerExchanging?,
        phase: (String) -> Unit,
    ): OsGateResult =
        if (id in ids) {
            OsGateResult.Passed(device)
        } else {
            runOsGate(gate(), device, reconnect, phase).also { if (it is OsGateResult.Passed) ids += id }
        }

    /** The app's one set. */
    companion object {
        /** The session's verified Ledgers, shared by the connect flow and [LedgerSigner.shared]. */
        val session = LedgerOsVerified()
    }
}

/** What [runOsGate] ended with. */
sealed interface OsGateResult {
    /**
     * The device passed; keep [link], the connection after the last app change.
     *
     * @property link the live connection.
     */
    data class Passed(
        val link: LedgerExchanging,
    ) : OsGateResult

    /**
     * The core refused the device, by its code (`firmware-below-minimum`, `rejected-on-device`, ...).
     *
     * @property reason the code, shown through `friendlyError`.
     */
    data class Refused(
        val reason: String,
    ) : OsGateResult
}

/**
 * The device OS gate (wallet-core #199, the OS half of the extension's `assertLedgerDeviceReady`),
 * as iOS `LedgerOsCheck`: [gate] closes the open app, reads the OS on the dashboard, reopens
 * Starknet (the person may be asked on the device) and checks the model and version against
 * Bramble's minimums. [reconnect] opens the same device again when an app change dropped the link
 * (null when it cannot, or the flow ended); [phase] sees each step's phase name.
 *
 * Trust boundary: every APDU comes from the core and every reply goes back to it unread. Failure:
 * the core's refusal code, with the link closed.
 */
suspend fun runOsGate(
    gate: LedgerOsGateInterface,
    device: LedgerExchanging,
    reconnect: suspend () -> LedgerExchanging?,
    phase: (String) -> Unit,
): OsGateResult {
    var link = device
    var step = gate.start()
    while (true) {
        step =
            when (step) {
                is LedgerOsStep.Send -> {
                    phase(step.phase)
                    when (val outcome = link.send(step.apdu)) {
                        is LedgerExchange.Reply -> gate.reply(outcome.reply)
                        is LedgerExchange.Failure -> gate.transportFailure(outcome.failure)
                    }
                }

                is LedgerOsStep.Reconnect -> {
                    phase(step.phase)
                    // The app change dropped the link; closing it again is harmless.
                    link.close()
                    val again = reconnect()
                    if (again == null) {
                        gate.transportFailure(TransportFailure.DISCONNECTED)
                    } else {
                        link = again
                        gate.reconnected()
                    }
                }

                is LedgerOsStep.Supported -> {
                    return OsGateResult.Passed(link)
                }

                is LedgerOsStep.Refused -> {
                    link.close()
                    return OsGateResult.Refused(step.reason)
                }
            }
    }
}
