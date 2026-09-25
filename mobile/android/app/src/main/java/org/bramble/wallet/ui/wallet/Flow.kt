package org.bramble.wallet.ui.wallet

/** Screens pushed over the shell, without the dock. */
enum class Flow {
    /** The receive address and QR code. */
    RECEIVE,

    /** The send journey. */
    SEND,

    /** Account names, receipts, and groups. */
    MANAGE_ACCOUNTS,

    /** The network picker. */
    NETWORK,

    /** Appearance and display-currency preferences. */
    APPEARANCE,

    /** Biometric unlock and the auto-lock policy. */
    SECURITY,

    /** The passphrase-gated recovery-phrase reveal. */
    REVEAL,

    /** Removing the wallet from this device. */
    REMOVE,

    /** Saved contacts. */
    ADDRESS_BOOK,

    /** Shared (multisig) accounts. */
    SHARED_ACCOUNTS,

    /** The Ready Multisig gateway. */
    READY_MULTISIG,

    /** The privacy journey: the preparing wait, then the core's blocker. */
    PRIVACY,

    /** The standalone Deploy account flow, from Home's deploy notice. */
    DEPLOY,

    /** A tracked token's detail: price, balance, private balance and contract. */
    TOKEN_DETAIL,
}
