package org.bramble.wallet.ui

/**
 * `0x1234…abcd`, the extension's shortened address (`verify-decode.ts`, iOS `shortAddress`).
 * Core addresses are canonical lowercase hex, so taking characters is exact. Shared with the
 * sibling workstreams; replace with a core `short_address` if one is added.
 */
fun shortAddress(address: String): String =
    if (address.length <= 14) address else "${address.take(6)}…${address.takeLast(4)}"
