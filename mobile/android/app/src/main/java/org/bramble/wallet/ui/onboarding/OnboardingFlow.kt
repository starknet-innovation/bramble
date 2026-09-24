package org.bramble.wallet.ui.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleMotion
import org.bramble.wallet.design.brambleTween

enum class OnboardingPath { CREATE, RECOVER }

private enum class Step { WELCOME, IMPORT_METHOD, RECOVERY_PHRASE, PASSPHRASE, REVIEW_ACCOUNT, SAVE_PHRASE, CONFIRM_BACKUP, COMPLETE }

/**
 * First-run flow, step for step with the iOS `OnboardingFlow` (and so the extension wizard):
 *
 *   create: welcome → passphrase → review account → save phrase → confirm backup → all set
 *   import: welcome → method → recovery phrase → passphrase → review account → all set
 *
 * The vault is written when the passphrase is accepted; after that the stack is replaced, so
 * neither the back control nor the system back gesture returns past it. Steps slide and fade on
 * the out ease over `drawerMs`; Compose scales that by the system animator setting, so it is a
 * cut when animations are off.
 */
@Composable
fun OnboardingFlow(store: WalletStore) {
    val scope = rememberCoroutineScope()
    var steps by remember { mutableStateOf(listOf(Step.WELCOME)) }
    var path by remember { mutableStateOf(OnboardingPath.CREATE) }
    var forward by remember { mutableStateOf(true) }
    // Typed on the recovery step, handed to the core at the passphrase step, then cleared.
    var importedPhrase by remember { mutableStateOf("") }

    fun push(step: Step) {
        forward = true
        steps = steps + step
    }
    fun pop() {
        forward = false
        if (steps.size > 1) steps = steps.dropLast(1)
    }
    fun replace(step: Step) {
        forward = true
        steps = listOf(step)
    }

    BackHandler(enabled = steps.size > 1) { pop() }
    Box(Modifier.fillMaxSize()) {
        OnboardingBackdrop()
        OnboardingCard {
            AnimatedContent(
                targetState = steps.last(),
                transitionSpec = {
                    val spec = brambleTween<androidx.compose.ui.unit.IntOffset>(BrambleMotion.drawerMs)
                    val fade = brambleTween<Float>(BrambleMotion.drawerMs)
                    val sign = if (forward) 1 else -1
                    (slideInHorizontally(spec) { sign * it } + fadeIn(fade)) togetherWith
                        (slideOutHorizontally(spec) { -sign * it } + fadeOut(fade))
                },
                label = "onboarding-step",
            ) { step ->
                when (step) {
                    Step.WELCOME -> WelcomeStep(
                        create = { path = OnboardingPath.CREATE; push(Step.PASSPHRASE) },
                        recover = { path = OnboardingPath.RECOVER; push(Step.IMPORT_METHOD) },
                    )
                    Step.IMPORT_METHOD -> ImportMethodStep(back = ::pop, recoveryPhrase = { push(Step.RECOVERY_PHRASE) })
                    Step.RECOVERY_PHRASE -> RecoveryPhraseStep(back = ::pop) { phrase ->
                        importedPhrase = phrase
                        push(Step.PASSPHRASE)
                    }
                    Step.PASSPHRASE -> PassphraseStep(store, path, back = ::pop) { passphrase ->
                        if (path == OnboardingPath.CREATE) {
                            store.create(passphrase)
                        } else {
                            val phrase = importedPhrase
                            store.importWallet(phrase, passphrase)
                            importedPhrase = ""
                        }
                        replace(Step.REVIEW_ACCOUNT)
                    }
                    Step.REVIEW_ACCOUNT -> ReviewAccountStep(store, store.network) {
                        replace(if (path == OnboardingPath.CREATE) Step.SAVE_PHRASE else Step.COMPLETE)
                    }
                    Step.SAVE_PHRASE -> SavePhraseStep(store.pendingBackup) { push(Step.CONFIRM_BACKUP) }
                    Step.CONFIRM_BACKUP -> ConfirmBackupStep(store.pendingBackup, back = ::pop) { replace(Step.COMPLETE) }
                    Step.COMPLETE -> CompleteStep { scope.launch { runCatching { store.finishOnboarding() } } }
                }
            }
        }
    }
}
