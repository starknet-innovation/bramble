package org.bramble.wallet.staking

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import org.bramble.core.DirectoryEntry
import org.bramble.core.DirectoryView
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.RpcReply
import org.bramble.core.RpcRequest
import org.bramble.core.ScanStep
import org.bramble.core.StakingChainRead
import org.bramble.core.StakingView
import org.bramble.core.TokenPreferences
import org.bramble.core.WalletCore
import org.bramble.core.stakingDirectoryRequest
import org.bramble.core.stakingDirectoryView
import org.bramble.core.validateRecipient
import org.bramble.wallet.portfolio.PortfolioReads

/** One read's state on screen. */
sealed interface StakingLoad<out T> {
    /** The read is in flight. */
    data object Loading : StakingLoad<Nothing>

    /** The read is switched off (the explorer choice keeps the address from Starkscan). */
    data object Off : StakingLoad<Nothing>

    /** The read failed; [message] is the core's sentence. */
    data class Failed(
        val message: String,
    ) : StakingLoad<Nothing>

    /** The read answered with [value]. */
    data class Loaded<T>(
        val value: T,
    ) : StakingLoad<T>
}

/**
 * Starkscan's validator list, page by page, in its own order.
 *
 * @property entries every validator listed so far.
 * @property nextCursor the next page's cursor, or null on the last.
 * @property moreError a later page that failed, one line under the list (which stays).
 * @property incomplete the snapshot was incomplete, so it offers no validator.
 */
data class StakingDirectory(
    val entries: List<DirectoryEntry> = emptyList(),
    val nextCursor: String? = null,
    val moreError: String? = null,
    val incomplete: Boolean = false,
)

/**
 * The validator on screen.
 *
 * @property staker its canonical address.
 * @property name the directory's name for it, if the list holds one.
 */
data class StakingValidator(
    val staker: String,
    val name: String?,
)

/** The three calls every sans-IO staking read answers (`StakingChainRead`, `StakingPreparation`). */
internal data class StakingSteps(
    val next: () -> List<RpcRequest>,
    val accept: (RpcReply) -> ScanStep,
    val restart: () -> Unit,
)

/**
 * Runs [read] to its end on the first verified endpoint that answers, replaying it from the start
 * on the next after a transport failure. The core's `view` or `plan` refuses an unfinished read.
 */
internal suspend fun PortfolioReads.drive(
    read: StakingSteps,
    network: NetworkInfo,
) {
    firstAnswer(network) { url ->
        read.restart()
        var calls = read.next()
        var answered: Boolean? = true
        while (calls.isNotEmpty() && answered == true) {
            if (sendAll(calls, url).any { read.accept(it) == ScanStep.TRANSPORT }) answered = null
            calls = if (answered == true) read.next() else emptyList()
        }
        answered
    }
}

/** [StakingChainRead]'s steps. */
internal fun StakingChainRead.steps() = StakingSteps(::nextCalls, ::accept, ::restart)

/**
 * The core's refusal for staking on [network], null where `STAKING_POLICY` has it on (Mainnet).
 * The app never decides this from the network itself.
 */
fun stakingRefusal(network: NetworkId): String? =
    runCatching { stakingDirectoryRequest(network, null) }.exceptionOrNull()?.let(::stakingMessage)

/**
 * The staking screen's state, twin of the iOS `StakingModel`: "Your stakes", Starkscan's directory
 * with the paste field, and one validator's pools. The core makes every request, judges every
 * reply and formats every figure; this only sequences reads. Where the core refuses staking,
 * [unavailable] holds its sentence and nothing is read. Main-thread only.
 */
class StakingModel internal constructor(
    private val core: WalletCore,
    internal val network: NetworkInfo,
    internal val accountId: String,
    internal val tokens: TokenPreferences,
    internal val reads: PortfolioReads,
    /** Unix seconds, injected so a test pins the unlock times the rows read. */
    internal val clock: () -> ULong,
) {
    /** The core's refusal when staking is off on this network; null on Mainnet. */
    val unavailable: String? = stakingRefusal(network.network)

    /** "Your stakes". */
    var positions by mutableStateOf<StakingLoad<StakingView>>(StakingLoad.Loading)
        private set

    /** The validator directory. */
    var directory by mutableStateOf<StakingLoad<StakingDirectory>>(StakingLoad.Loading)
        private set

    /** The validator on screen, or null for the list. */
    var validator by mutableStateOf<StakingValidator?>(null)
        private set

    /** The open validator's pools. */
    var pools by mutableStateOf<StakingLoad<StakingView>>(StakingLoad.Loading)
        private set

    /** True while "Show more" reads the next page. */
    var loadingMore by mutableStateOf(false)
        private set

    /** The paste field's text. */
    var pasteInput by mutableStateOf("")
        private set

    /** Why the pasted text was refused. */
    var pasteError by mutableStateOf<String?>(null)
        private set

    private var generation = 0
    private var positionsRead = 0
    private var directoryRead = 0

    /** Edits the paste field, which clears its error. */
    fun paste(text: String) {
        pasteInput = text
        pasteError = null
    }

    /** Reads "Your stakes" and the directory's first page; nothing where staking is off. */
    suspend fun load() {
        if (unavailable != null) return
        coroutineScope {
            async { loadPositions() }
            async { loadDirectory(null) }
        }
    }

    /**
     * "Your stakes": Starkscan names the candidates, the chain read verifies each one. Only the
     * newest read lands, so a slow first read cannot overwrite a refresh made after a stake.
     */
    suspend fun loadPositions() {
        val read = ++positionsRead
        positions = StakingLoad.Loading
        val result = runCatching { readPositions() }.getOrElse { StakingLoad.Failed(stakingMessage(it)) }
        if (read == positionsRead) positions = result
    }

    private suspend fun readPositions(): StakingLoad<StakingView> {
        val request = core.stakingPositionsRequest(accountId, tokens) ?: return StakingLoad.Off
        val read = core.stakingPositions(accountId, reads.transport.perform(request), tokens)
        reads.drive(read.steps(), network)
        return StakingLoad.Loaded(read.view(clock()))
    }

    /**
     * The directory's first page, or (with [cursor]) the next one appended under it. A Show more
     * while a page is loading is ignored, and only the newest read lands, so no page is appended
     * twice.
     */
    suspend fun loadDirectory(cursor: String?) {
        if (cursor != null && loadingMore) return
        val read = ++directoryRead
        val current = (directory as? StakingLoad.Loaded)?.value
        if (cursor == null) directory = StakingLoad.Loading
        loadingMore = cursor != null
        val result =
            runCatching { readDirectory(cursor, current) }.getOrElse { error ->
                if (cursor != null && current != null) {
                    StakingLoad.Loaded(current.copy(moreError = stakingMessage(error)))
                } else {
                    StakingLoad.Failed(stakingMessage(error))
                }
            }
        if (read != directoryRead) return
        directory = result
        loadingMore = false
    }

    private suspend fun readDirectory(
        cursor: String?,
        current: StakingDirectory?,
    ): StakingLoad<StakingDirectory> {
        val request = stakingDirectoryRequest(network.network, cursor) ?: return StakingLoad.Off
        val base = current?.takeIf { cursor != null } ?: StakingDirectory()
        val page = stakingDirectoryView(network.network, reads.transport.perform(request), tokens)
        return StakingLoad.Loaded(
            when (page) {
                is DirectoryView.Incomplete -> {
                    base.copy(
                        nextCursor = null,
                        incomplete = cursor == null,
                        moreError = StakingCopy.directoryIncomplete.takeIf { cursor != null },
                    )
                }

                is DirectoryView.Ready -> {
                    base.copy(entries = base.entries + page.entries, nextCursor = page.nextCursor, moreError = null)
                }
            },
        )
    }

    /** The paste field's Open: a valid Starknet address opens that validator. */
    suspend fun openPasted() {
        val staker = validateRecipient(pasteInput)
        if (staker == null) {
            pasteError = StakingCopy.directoryInvalidAddress
            return
        }
        open(staker, null)
    }

    /** Opens one validator's pools for the account, each verified on chain. */
    suspend fun open(
        staker: String,
        name: String?,
    ) {
        val opened = ++generation
        validator = StakingValidator(staker, name)
        pools = StakingLoad.Loading
        val result =
            runCatching {
                val read = core.stakingOverview(accountId, staker, tokens)
                reads.drive(read.steps(), network)
                StakingLoad.Loaded(read.view(clock()))
            }.getOrElse { StakingLoad.Failed(stakingMessage(it)) }
        if (opened == generation) pools = result
    }

    /** "All validators": back to the list. */
    fun closeValidator() {
        generation++
        validator = null
        pools = StakingLoad.Loading
    }

    /** The directory's name for [staker], when the list already holds one. */
    fun nameOf(staker: String): String? {
        val wanted = validateRecipient(staker)
        return (directory as? StakingLoad.Loaded)
            ?.value
            ?.entries
            ?.firstOrNull {
                validateRecipient(
                    it.staker,
                ) == wanted
            }?.name
    }
}
