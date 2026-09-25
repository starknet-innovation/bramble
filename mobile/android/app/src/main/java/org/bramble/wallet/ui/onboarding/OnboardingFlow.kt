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
import org.bramble.wallet.create
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.BrambleMotion
import org.bramble.wallet.design.brambleTween
import org.bramble.wallet.finishOnboarding
import org.bramble.wallet.importWallet

private enum class Step {
    WELCOME,
    IMPORT_METHOD,
    RECOVERY_PHRASE,
    PASSPHRASE,
    REVIEW_ACCOUNT,
    FIND_ACCOUNTS,
    SAVE_PHRASE,
    CONFIRM_BACKUP,
    COMPLETE,
}

/** The navigation and side effects each step triggers; built by [OnboardingFlow] over its state. */
private data class StepActions(
    val push: (Step) -> Unit,
    val pop: () -> Unit,
    val replace: (Step) -> Unit,
    val choose: (OnboardingPath) -> Unit,
    val phraseEntered: (String) -> Unit,
    val passphraseAccepted: suspend (String) -> Unit,
)

/**
 * First-run flow, step for step with the iOS `OnboardingFlow` (and so the extension wizard):
 *
 *   create: welcome → passphrase → review account → save phrase → confirm backup → all set
 *   import: welcome → method → recovery phrase → passphrase → find your accounts → all set
 *
 * The vault is written when the passphrase is accepted; after that the stack is replaced, so
 * neither the back control nor the system back gesture returns past it. An imported vault stays
 * recovery pending until discovery restores its accounts, so unlocking one resumes at "Find your
 * accounts" ([resumingDiscovery], `Route.DISCOVERY`). Steps slide and fade on
 * the out ease over `drawerMs`; Compose scales that by the system animator setting, so it is a
 * cut when animations are off.
 */
@Composable
fun OnboardingFlow(
    store: WalletStore,
    resumingDiscovery: Boolean = false,
) {
    val scope = rememberCoroutineScope()
    var steps by remember { mutableStateOf(listOf(if (resumingDiscovery) Step.FIND_ACCOUNTS else Step.WELCOME)) }
    var path by remember { mutableStateOf(if (resumingDiscovery) OnboardingPath.RECOVER else OnboardingPath.CREATE) }
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

    val actions =
        StepActions(
            push = ::push,
            pop = ::pop,
            replace = ::replace,
            choose = { path = it },
            phraseEntered = { importedPhrase = it },
            passphraseAccepted = { passphrase ->
                writeVault(store, path, passphrase, importedPhrase) { importedPhrase = "" }
                replace(stepAfterVault(path))
            },
        )

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
                    slideInHorizontally(spec) { sign * it } + fadeIn(fade) togetherWith
                        slideOutHorizontally(spec) { -sign * it } + fadeOut(fade)
                },
                label = "onboarding-step",
            ) { step ->
                StepContent(step, store, path, actions) {
                    scope.launch { runCatching { store.finishOnboarding() } }
                }
            }
        }
    }
}

/**
 * Writes the vault at the passphrase step: a new wallet for [OnboardingPath.CREATE], otherwise an
 * import of [phrase], after which [consumed] clears the held phrase. A failure propagates before
 * [consumed] runs, so the phrase is kept for a retry.
 */
private suspend fun writeVault(
    store: WalletStore,
    path: OnboardingPath,
    passphrase: String,
    phrase: String,
    consumed: () -> Unit,
) {
    if (path == OnboardingPath.CREATE) {
        store.create(passphrase)
    } else {
        store.importWallet(phrase, passphrase)
        consumed()
    }
}

/** Where the flow goes once the vault is written; the stack is replaced so back cannot undo it. */
private fun stepAfterVault(path: OnboardingPath): Step =
    if (path == OnboardingPath.CREATE) Step.REVIEW_ACCOUNT else Step.FIND_ACCOUNTS

/**
 * One step of [OnboardingFlow]; [path] is the branch chosen at the welcome step, and [finish]
 * leaves onboarding from the last step.
 */
@Composable
private fun StepContent(
    step: Step,
    store: WalletStore,
    path: OnboardingPath,
    actions: StepActions,
    finish: () -> Unit,
) {
    when (step) {
        Step.WELCOME -> {
            WelcomeStep(
                create = {
                    actions.choose(OnboardingPath.CREATE)
                    actions.push(Step.PASSPHRASE)
                },
                recover = {
                    actions.choose(OnboardingPath.RECOVER)
                    actions.push(Step.IMPORT_METHOD)
                },
            )
        }

        Step.IMPORT_METHOD -> {
            ImportMethodStep(back = actions.pop, recoveryPhrase = { actions.push(Step.RECOVERY_PHRASE) })
        }

        Step.RECOVERY_PHRASE -> {
            RecoveryPhraseStep(
                back = actions.pop,
                onPaste = { store.showNotice(BrambleCopy.clipboardCleared) },
            ) { phrase ->
                actions.phraseEntered(phrase)
                actions.push(Step.PASSPHRASE)
            }
        }

        Step.PASSPHRASE -> {
            PassphraseStep(store, path, back = actions.pop, submit = actions.passphraseAccepted)
        }

        Step.REVIEW_ACCOUNT -> {
            ReviewAccountStep(store, store.network) { actions.replace(Step.SAVE_PHRASE) }
        }

        Step.FIND_ACCOUNTS -> {
            FindAccountsStep(store) { actions.replace(Step.COMPLETE) }
        }

        Step.SAVE_PHRASE -> {
            SavePhraseStep(store.pendingBackup) { actions.push(Step.CONFIRM_BACKUP) }
        }

        Step.CONFIRM_BACKUP -> {
            ConfirmBackupStep(store.pendingBackup, back = actions.pop) { actions.replace(Step.COMPLETE) }
        }

        Step.COMPLETE -> {
            CompleteStep(finish)
        }
    }
}
