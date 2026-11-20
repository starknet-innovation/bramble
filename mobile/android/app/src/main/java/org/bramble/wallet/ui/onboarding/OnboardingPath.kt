package org.bramble.wallet.ui.onboarding

/** Which first-run branch the user chose: a new wallet or one restored from a recovery phrase. */
enum class OnboardingPath {
    /** Create a new wallet and back up its phrase. */
    CREATE,

    /** Import an existing recovery phrase and rediscover its accounts. */
    RECOVER,
}
