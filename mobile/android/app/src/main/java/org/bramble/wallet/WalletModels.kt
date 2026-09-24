package org.bramble.wallet

import org.bramble.core.NetworkId

/** Top-level screens, as iOS `WalletStore.Route`. In memory only; never persisted. */
enum class Route { ONBOARDING, LOCKED, WALLET }

/** Dock tabs, as iOS `WalletStore.Tab`. */
enum class Tab { HOME, ACTIVITY, SETTINGS }

/** The non-secret `network` preference: `"mainnet"` (the default) or `"sepolia"`. */
object NetworkPreference {
    const val KEY = "network"

    fun fromStored(value: String?): NetworkId = if (value == "sepolia") NetworkId.SEPOLIA else NetworkId.MAINNET

    fun stored(network: NetworkId): String = if (network == NetworkId.SEPOLIA) "sepolia" else "mainnet"

    /** The header's network label, as the side panel's `.account-network-label`. */
    fun label(network: NetworkId): String = if (network == NetworkId.MAINNET) "Starknet" else "Sepolia"

    /** The chain id shown under each network name (iOS `NetworkView`). */
    fun chainLabel(network: NetworkId): String = if (network == NetworkId.MAINNET) "SN_MAIN" else "SN_SEPOLIA"
}
