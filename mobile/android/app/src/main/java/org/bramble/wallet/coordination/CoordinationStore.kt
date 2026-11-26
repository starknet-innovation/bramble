package org.bramble.wallet.coordination

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.bramble.core.ArgentMultisigConfig
import org.bramble.core.Contact
import org.bramble.core.CoordinationSyncOutcome
import org.bramble.core.CoordinationSyncStep
import org.bramble.core.MultisigAuthorityStatus
import org.bramble.core.MultisigRecord
import org.bramble.core.NetworkInfo
import org.bramble.core.RelayPolicy
import org.bramble.core.TokenPreferences
import org.bramble.core.WalletCore
import org.bramble.wallet.BuildConfig
import org.bramble.wallet.RpcClient
import org.bramble.wallet.RpcPost

/**
 * Public UI state for the wallet card, contacts, shared accounts, and Nostr coordination, as the
 * iOS `CoordinationStore`. The core keeps the coordination private key, gift-wrap plaintext, and
 * raw relay events; this class holds public values, and `CoordinationTransport.kt` moves bytes
 * (chain reads through `chainPost`, `RpcClient.post` in the app; one OkHttp WebSocket per relay
 * for a sync). `reset()` runs on lock and cancels any sync (mobile/docs/nostr-multisig.md §10).
 */
class CoordinationStore(
    internal val core: WalletCore,
    internal val network: () -> NetworkInfo,
) {
    /** This wallet's coordination (Nostr) public key once derived; null before, and after a lock. */
    var nostrKey by mutableStateOf<String?>(null)
        private set

    /** True when the core could not derive the coordination key; the UI then offers the address only. */
    var nostrUnavailable by mutableStateOf(false)
        private set

    /** This network's saved contacts, as the core last listed them. */
    var contacts by mutableStateOf(emptyList<Contact>())
        private set

    /** This network's shared (multisig) accounts, as the core last listed them. */
    var multisigs by mutableStateOf(emptyList<MultisigRecord>())
        private set

    /** The coordination relay settings; null until read, or when the core refused to read them. */
    var relayPolicy by mutableStateOf<RelayPolicy?>(null)
        private set

    /** Open (collecting, ready or stale) signing intents by multisig id, for the list rows. */
    var openIntents by mutableStateOf(emptyMap<String, Int>())
        private set

    /**
     * A public, canonical address the Send recipient stage offered to save, for the address book
     * to prefill once (it clears this as it takes it); dropped on lock.
     */
    var contactDraft: String? = null

    /**
     * Moves the multisig chain reads (authority, class declaration). The app's one HTTP path;
     * replaceable only in a debug build, so instrumented tests can answer from the offline
     * fixture node; a release build refuses.
     */
    internal var chainPost = ChainPost { url, body, maxBytes -> RpcClient.post(url, body, maxBytes = maxBytes) }
        set(value) {
            check(BuildConfig.DEBUG) { "the multisig chain transport is fixed in a release build" }
            field = value
        }

    /**
     * Moves the multisig plans' steps (`MultisigTransactions.kt`), a write among them: the app's one
     * HTTP path, posting a write once and never following a redirect. Replaceable only in a debug
     * build, for the offline fixture node; a release build refuses.
     */
    internal var txPost: RpcPost = RpcClient.https
        set(value) {
            check(BuildConfig.DEBUG) { "the multisig transaction transport is fixed in a release build" }
            field = value
        }
    private var syncJob: Job? = null

    /** Bumped on lock; a core call that finishes after it must not write back. */
    private var generation = 0

    /** A refusal carrying the extension's user-facing copy. */
    class Refusal(
        message: String,
    ) : Exception(message)

    /** Runs on lock: cancels any sync, drops every held value, and fences off in-flight core calls. */
    fun reset() {
        generation += 1
        syncJob?.cancel()
        syncJob = null
        nostrKey = null
        nostrUnavailable = false
        contacts = emptyList()
        multisigs = emptyList()
        relayPolicy = null
        openIntents = emptyMap()
        contactDraft = null
    }

    /** Derives the coordination public key once; a failure sets [nostrUnavailable] instead of throwing. */
    suspend fun loadNostrKey() {
        if (nostrKey != null) return
        val started = generation
        val result = runCatching { work { core.nostrPublicKey() } }
        if (started != generation) return
        result
            .onSuccess {
                nostrKey = it
                nostrUnavailable = false
            }.onFailure { nostrUnavailable = true }
    }

    /** Re-reads contacts, shared accounts, and the relay policy; each read that fails leaves it empty. */
    suspend fun refresh() {
        val id = network().network
        val started = generation
        val nextContacts = runCatching { work { core.contacts(id) } }.getOrDefault(emptyList())
        val nextMultisigs = runCatching { work { core.multisigs(id) } }.getOrDefault(emptyList())
        val nextPolicy = runCatching { work { core.relayPolicy() } }.getOrNull()
        // Stored intents only: settling reads the chain, and only moves Submitted to a closed state.
        val nextOpen = nextMultisigs.associate { record -> record.id to storedIntents(record.id).count(::isOpen) }
        if (started != generation) return
        contacts = nextContacts
        multisigs = nextMultisigs
        relayPolicy = nextPolicy
        openIntents = nextOpen
    }

    /** Saves a contact on this network (the core validates it and throws its refusal), then refreshes. */
    suspend fun saveContact(
        label: String,
        address: String,
        publicKeyX: String?,
        nostrPublicKey: String?,
    ) {
        work { core.saveContact(network().network, label, address, publicKeyX, nostrPublicKey) }
        refresh()
    }

    /** Removes the contact [id]; the core's error propagates. */
    suspend fun removeContact(id: String) {
        work { core.removeContact(id) }
        refresh()
    }

    /** [deployer] is the account record id that signs and pays for deployment. */
    suspend fun saveSetup(
        name: String,
        keys: List<String>,
        threshold: UInt,
        salt: String,
        deployer: String,
    ): MultisigRecord {
        val record =
            work {
                core.saveMultisigSetup(
                    network().network,
                    name,
                    ArgentMultisigConfig(threshold, keys),
                    salt,
                    deployer,
                )
            }
        refresh()
        return record
    }

    /** Removes the shared account [id] from this wallet; the core's error propagates. */
    suspend fun removeShared(id: String) {
        work { core.removeMultisig(id) }
        refresh()
    }

    /** `addMultisig`: returns the status copy, or throws [Refusal] with the extension's error copy. */
    suspend fun addShared(raw: String): String {
        val info = network()
        val read =
            runCatching { readAuthority(raw.trim().lowercase(), info, chainPost) }
                .getOrElse { throw Refusal("Enter a valid non-zero Starknet account address.") }
        authorityRefusal(read.status())?.let { throw it }
        val record = work { core.addMultisig(read) }
        refresh()
        return addedStatus(read.status(), record)
    }

    /**
     * Saves the coordination relay [raw] (empty resets it to the default) and returns the status copy;
     * the core's refusal propagates.
     */
    suspend fun setRelay(raw: String): String {
        val started = generation
        val saved = work { core.setNostrRelayUrl(raw) }
        val nextPolicy = runCatching { work { core.relayPolicy() } }.getOrNull()
        if (started == generation) relayPolicy = nextPolicy
        return if (saved == null) "Coordination relay reset" else "Coordination relay saved"
    }

    /**
     * One "Check for updates": the core plans and judges; this only moves frames, then drives the
     * fresh multisig read the core asks for before each trusted package it imports.
     */
    suspend fun sync(
        multisigId: String,
        tokens: TokenPreferences,
    ): CoordinationSyncOutcome =
        coroutineScope {
            val now = (System.currentTimeMillis() / MILLIS_PER_SECOND).toULong()
            val info = network()
            val job =
                async(Dispatchers.IO) {
                    val plan = core.coordinationSyncBegin(multisigId, now)
                    val policy = core.relayPolicy()
                    plan
                        .relayUrls()
                        .mapIndexed {
                            index,
                            url,
                            ->
                            async { runRelay(plan, index.toUInt(), url, policy) }
                        }.awaitAll()
                    var step = core.coordinationSyncOpen(plan, tokens)
                    while (step is CoordinationSyncStep.Read) {
                        // The core binds the import to this read, so every endpoint drives the same one.
                        val read = step.read
                        readState(info, chainPost) { read }
                        step = core.coordinationSyncImport(plan, read)
                    }
                    (step as CoordinationSyncStep.Done).outcome
                }
            syncJob = job
            try {
                job.await().also { if (it.imported > 0u) refresh() }
            } finally {
                syncJob = null
            }
        }
}

/** Seconds from [System.currentTimeMillis], for the core's Unix-time inputs. */
private const val MILLIS_PER_SECOND = 1000

/** Runs a blocking core call off the main thread. */
internal suspend fun <T> work(body: () -> T): T = withContext(Dispatchers.Default) { body() }

/** `addMultisig`'s refusal for an authority read that cannot be added; null when it can. */
private fun authorityRefusal(status: MultisigAuthorityStatus?): CoordinationStore.Refusal? =
    when (status) {
        MultisigAuthorityStatus.AVAILABLE, MultisigAuthorityStatus.UNDEPLOYED -> {
            null
        }

        MultisigAuthorityStatus.INVALID_CONFIG -> {
            CoordinationStore.Refusal(
                "This Argent multisig returned an invalid signer configuration",
            )
        }

        MultisigAuthorityStatus.UNSUPPORTED_CLASS -> {
            CoordinationStore.Refusal(
                "This address is not the pinned Argent Multisig 0.2 account",
            )
        }

        else -> {
            CoordinationStore.Refusal(
                "Argent multisig authority could not be verified. Check the network and retry",
            )
        }
    }

/** `addMultisig`'s status copy once [record] is stored. */
private fun addedStatus(
    status: MultisigAuthorityStatus?,
    record: MultisigRecord,
): String {
    if (status == MultisigAuthorityStatus.UNDEPLOYED) {
        return "Undeployed multisig added · complete setup to deploy"
    }
    val matched = record.localSignerAccountIds.size
    return if (matched == 0) {
        "Multisig synced · watch-only"
    } else {
        "Multisig synced · $matched wallet signer${if (matched == 1) "" else "s"} found"
    }
}
