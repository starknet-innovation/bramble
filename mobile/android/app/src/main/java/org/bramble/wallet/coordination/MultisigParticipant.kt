package org.bramble.wallet.coordination

/**
 * One public signer identity chosen for a multisig (iOS `MultisigParticipant`).
 *
 * @property publicKeyX the signer's public key, canonical.
 * @property label the name shown for the signer.
 * @property source where the key came from ("This wallet", "Saved contact", ...).
 * @property address the participant's account address, when known.
 */
internal data class MultisigParticipant(
    val publicKeyX: String,
    val label: String,
    val source: String,
    val address: String? = null,
)
