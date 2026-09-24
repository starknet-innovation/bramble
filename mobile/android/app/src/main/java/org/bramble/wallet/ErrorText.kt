package org.bramble.wallet

import org.bramble.core.CoreException

/**
 * User-facing text for a core error, in the iOS (and extension) wording. Never includes user
 * input: only the core's fixed `InvalidInput` reasons are shown, and every other failure collapses
 * to one generic line.
 */
fun describe(error: Throwable): String = when (error) {
    is CoreException.WrongPassword -> "Vault passphrase is incorrect"
    is CoreException.InvalidInput -> error.reason.replaceFirstChar { it.uppercase() }
    is CoreException.WalletExists -> "A wallet already exists on this device"
    is CoreException.Locked -> "The wallet is locked"
    else -> "Something went wrong. Try again."
}
