package org.bramble.wallet

import org.bramble.core.AccountGroup
import org.bramble.core.AccountRecord
import org.bramble.core.NetworkId

/**
 * Top-level screens, as iOS `WalletStore.Route`. In memory only; never persisted. DISCOVERY is an
 * imported vault still waiting for "Find your accounts" (recovery pending, no accounts yet).
 */
enum class Route {
    /** No vault on this device yet: create or import. */
    ONBOARDING,

    /** A vault exists and the core holds no session: the unlock screen. */
    LOCKED,

    /** Unlocked with recovery pending: "Find your accounts". */
    DISCOVERY,

    /** Unlocked with a created wallet's backup still owed: Save phrase, then Confirm backup. */
    BACKUP,

    /** Unlocked with accounts: the wallet shell. */
    WALLET,
    ;

    /** The routes shown only while the core holds an unlocked session. */
    val unlocked: Boolean get() = this == DISCOVERY || this == BACKUP || this == WALLET
}

/** Dock tabs, as iOS `WalletStore.Tab`. */
enum class Tab {
    /** The home screen: the active account and its balances. */
    HOME,

    /** The active account's activity list. */
    ACTIVITY,

    /** The settings list. */
    SETTINGS,
}

/** The non-secret `network` preference: `"mainnet"` (the default) or `"sepolia"`. */
object NetworkPreference {
    /** The `SharedPreferences` key; the value is public, never secret. */
    const val KEY = "network"

    /** The stored value as a network; anything but `"sepolia"` (including null) reads as mainnet. */
    fun fromStored(value: String?): NetworkId = if (value == "sepolia") NetworkId.SEPOLIA else NetworkId.MAINNET

    /** The value [fromStored] reads back for [network]. */
    fun stored(network: NetworkId): String = if (network == NetworkId.SEPOLIA) "sepolia" else "mainnet"

    /** The header's network label, as the side panel's `.account-network-label`. */
    fun label(network: NetworkId): String = if (network == NetworkId.MAINNET) "Starknet" else "Sepolia"

    /** The chain id shown under each network name (iOS `NetworkView`). */
    fun chainLabel(network: NetworkId): String = if (network == NetworkId.MAINNET) "SN_MAIN" else "SN_SEPOLIA"
}

/** One consistent read of the account state, taken off the main thread (`WalletStore`). */
internal data class AccountsSnapshot(
    val records: List<AccountRecord> = emptyList(),
    val allRecords: List<AccountRecord> = emptyList(),
    val groups: List<AccountGroup> = emptyList(),
) {
    val active: AccountRecord? = records.firstOrNull { it.active }
}
