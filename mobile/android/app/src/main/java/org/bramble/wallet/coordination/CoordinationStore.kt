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
import org.bramble.core.MultisigAuthorityStatus
import org.bramble.core.MultisigRecord
import org.bramble.core.NetworkInfo
import org.bramble.core.RelayPolicy
import org.bramble.core.WalletCore

/**
 * Public UI state for the wallet card, contacts, shared accounts, and Nostr coordination, as the
 * iOS `CoordinationStore`. The core keeps the coordination private key, gift-wrap plaintext, and
 * raw relay events; this class holds public values, and `CoordinationTransport.kt` moves bytes
 * (chain reads through `RpcClient.post`, one OkHttp WebSocket per relay for a sync). `reset()`
 * runs on lock and cancels any sync (mobile/docs/nostr-multisig.md §10).
 */
class CoordinationStore(
    private val core: WalletCore,
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

    /**
     * A public, canonical address the Send recipient stage offered to save, for the address book
     * to prefill once (it clears this as it takes it); dropped on lock.
     */
    var contactDraft: String? = null
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
        if (started != generation) return
        contacts = nextContacts
        multisigs = nextMultisigs
        relayPolicy = nextPolicy
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
            runCatching { readAuthority(raw.trim().lowercase(), info) }
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

    /** One "Check for updates": the core plans and judges; this only moves frames. */
    suspend fun sync(multisigId: String): CoordinationSyncOutcome =
        coroutineScope {
            val now = (System.currentTimeMillis() / MILLIS_PER_SECOND).toULong()
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
                    core.coordinationSyncFinish(plan)
                }
            syncJob = job
            try {
                job.await()
            } finally {
                syncJob = null
            }
        }
}

/** Seconds from [System.currentTimeMillis], for the core's Unix-time inputs. */
private const val MILLIS_PER_SECOND = 1000

/** Runs a blocking core call off the main thread. */
private suspend fun <T> work(body: () -> T): T = withContext(Dispatchers.Default) { body() }

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
