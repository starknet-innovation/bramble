package org.bramble.wallet.ledger

import org.bramble.core.LedgerOsGateInterface
import org.bramble.core.LedgerOsStep
import org.bramble.core.TransportFailure

/** The phase in which the device asks the person to approve opening Starknet. */
const val OPENING_STARKNET = "opening-starknet"

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
