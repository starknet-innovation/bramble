package org.bramble.wallet.ui.onboarding

import org.bramble.core.PassphraseStrength

/**
 * The passphrase step's submit gate and meter line, as the extension's `applyPassphraseMeter`
 * and the check before its submit: the vault must accept the value (the core's 8-character floor,
 * [PassphraseStrength.acceptable]) and the confirmation must match it. Nothing else gates it: the
 * meter still names a weak value, but the extension no longer asks anyone to tick past it.
 */
object PassphraseGate {
    /** Whether [value], confirmed by [confirmation], may seal the vault. */
    fun ready(
        strength: PassphraseStrength,
        value: String,
        confirmation: String,
    ): Boolean = strength.acceptable && confirmation.isNotEmpty() && value == confirmation

    /**
     * The line under the meter: the core's hint while the value is refused or unconfirmed, then
     * the hint with the match, or the mismatch.
     */
    fun status(
        strength: PassphraseStrength,
        value: String,
        confirmation: String,
    ): String =
        when {
            !strength.acceptable || confirmation.isEmpty() -> strength.hint
            ready(strength, value, confirmation) -> "${strength.hint} · Passphrases match"
            else -> "Passphrases do not match"
        }
}
