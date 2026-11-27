package org.bramble.wallet.ui.onboarding

/** Which first-run branch the user chose: a new wallet, one restored from a
 * recovery phrase, or a Ledger. */
enum class OnboardingPath {
    /** Create a new wallet and back up its phrase. */
    CREATE,

    /** Import an existing recovery phrase and rediscover its accounts. */
    RECOVER,

    /** A Ledger-only wallet: connect a Ledger and pick its accounts; there is no phrase. */
    LEDGER,
}
