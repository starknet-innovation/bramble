package org.bramble.wallet.ui.onboarding

/**
 * `backup-verify.ts` (iOS `ConfirmBackupStep`): the backup is confirmed when every requested
 * position is answered with its word, trimmed and case-insensitive. A UI gate over words already
 * held for display; the core is not involved.
 */
object BackupVerify {
    /** `BACKUP_VERIFY_POSITIONS`, 1-based. */
    val POSITIONS = listOf(3, 7, 11)

    /**
     * True when [answers] match [words] at [POSITIONS]; false for a missing, empty, or wrong
     * answer, or a phrase too short to hold every position.
     */
    fun confirmed(
        words: List<String>,
        answers: List<String>,
    ): Boolean =
        answers.size == POSITIONS.size &&
            words.size >= POSITIONS.max() &&
            POSITIONS.zip(answers).all { (position, answer) ->
                val typed = answer.trim().lowercase()
                typed.isNotEmpty() && typed == words[position - 1].lowercase()
            }
}
