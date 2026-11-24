package org.bramble.wallet.ui

import org.bramble.core.accountLabel

/**
 * The app's one short-address helper: the core's `accountLabel` (the extension's `addressLabel`:
 * padded to 64 hex digits, then 6…4 with U+2026), so every screen and platform truncates
 * identically. Kept only for call-site brevity.
 */
fun shortAddress(address: String): String = accountLabel(address)
