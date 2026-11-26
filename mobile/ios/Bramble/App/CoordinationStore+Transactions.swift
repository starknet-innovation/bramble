import BrambleCore
import Foundation

/// Multisig transactions (M18, mobile/docs/multisig-transactions.md): propose, co-sign, submit and
/// import, around wallet-core's `multisig_tx_ops`. The core builds and reviews every call, signs
/// inside itself by vault record, and judges every reply; this only moves bytes and keeps no key.
/// Every chain read is fresh, so the core's stale-intent and resend guards see the chain as it is.
extension CoordinationStore {
    /// Milliseconds per second, for the wall clock the core files a found transaction at.
    private static let millisecondsPerSecond: Double = 1_000

    private var nowMs: UInt64 { UInt64(Date().timeIntervalSince1970 * Self.millisecondsPerSecond) }

    /// The signing intents stored for a multisig, newest first; empty when the core refuses.
    /// Submitted intents are settled first (`MultisigTxDriver.settle`), so one the chain has
    /// accepted or rejected leaves "Submitted to Starknet" on this read.
    func intents(of multisigId: String) async -> [MultisigIntent] {
        let listed = await storedIntents(of: multisigId)
        let settled = await MultisigTxDriver.settle(
            listed,
            of: multisigId,
            core: core,
            network: wallet.networkInfo,
            transport: rpc
        )
        return settled ? await storedIntents(of: multisigId) : listed
    }

    private func storedIntents(of multisigId: String) async -> [MultisigIntent] {
        let walletCore = core
        return (try? await work { try walletCore.multisigIntents(multisigId: multisigId) }) ?? []
    }

    /// Freezes and stores `request` from `record` (`prepareIntent`) after a fresh authority read.
    /// `confirmResend` is the person's "Send anyway" after `ResendUnconfirmed`. Throws the core's
    /// refusal, or `MultisigTxError` with how the plan ended.
    func propose(
        _ request: MultisigProposalRequest,
        from record: MultisigRecord,
        confirmResend: Bool = false
    ) async throws -> MultisigIntent {
        let network = wallet.networkInfo, transport = rpc, walletCore = core
        let tokens = wallet.portfolio.preferences
        let read = try await ChainReads.authority(of: record.address, on: network, via: transport)
        let proposal = try await work {
            try walletCore.proposeMultisigTransaction(
                read: read,
                request: request,
                tokens: tokens,
                confirmResend: confirmResend
            )
        }
        let step = try await MultisigTxDriver.run(proposal, network: network, transport: transport)
        guard case .proposed = step, let intent = proposal.intent() else { throw MultisigTxError(step) }
        await refresh()
        return intent
    }

    /// Co-signs `intent` with the vault record `accountId`; the core signs the frozen hash.
    func sign(_ intent: MultisigIntent, with accountId: String) async throws -> MultisigIntent {
        let read = try await intentRead(intent.id), walletCore = core
        let signed = try await work {
            try walletCore.signMultisigIntent(intentId: intent.id, signerAccountId: accountId, state: read)
        }
        await refresh()
        return signed
    }

    /// Sends a ready (or fee-stale) intent's threshold signature exactly once; returns the hash.
    func submit(_ intent: MultisigIntent) async throws -> String {
        let network = wallet.networkInfo, transport = rpc, walletCore = core
        let read = try await intentRead(intent.id)
        let submission = try await work { try walletCore.submitMultisigIntent(intentId: intent.id, state: read) }
        let step = try await MultisigTxDriver.run(submission, network: network, transport: transport)
        await refresh()
        guard case .submitted(let hash) = step else { throw MultisigTxError(step) }
        return hash
    }

    /// The intent card's review (`multisig_intent_review`, the extension's `intentCard`): each frozen
    /// call's summary and flags under the person's tokens, and whether a fresh read of the
    /// multisig's authority still holds the intent's signers. Nil when the core refuses (a locked
    /// wallet, an intent gone); an unreachable chain comes back with `hasFreshAuthority` false.
    /// Either way the card offers neither Sign nor Submit.
    func review(_ intent: MultisigIntent) async -> MultisigIntentReview? {
        let network = wallet.networkInfo, transport = rpc, walletCore = core
        let tokens = wallet.portfolio.preferences
        guard let read = try? await ChainReads.authority(of: intent.sender, on: network, via: transport) else {
            return nil
        }
        return try? await work {
            try walletCore.multisigIntentReview(intentId: intent.id, tokens: tokens, read: read)
        }
    }

    /// Imports a co-signer's package for `record` against a fresh read of it. The core drops the
    /// package's own summary and lifecycle and reviews the calls itself.
    func importIntent(_ package: String, into record: MultisigRecord) async throws -> MultisigIntent {
        let network = wallet.networkInfo, walletCore = core, tokens = wallet.portfolio.preferences
        let read = try await ChainReads.state(of: record.address, on: network, via: rpc)
        let text = package.trimmingCharacters(in: .whitespacesAndNewlines)
        let imported = try await work {
            try walletCore.importMultisigIntent(package: text, state: read, tokens: tokens)
        }
        await refresh()
        return imported
    }

    /// This wallet's accounts that may still sign `intent`: members of the snapshot it was frozen
    /// against that have not signed it. The core checks membership again when it signs.
    func availableSigners(for intent: MultisigIntent) -> [AccountRecord] {
        let signed = Set(intent.signedPublicKeys.compactMap { try? argentSignerGuid(publicKey: $0) })
        let members = Set(intent.signerGuids)
        return wallet.records.filter { record in
            guard let guid = try? argentSignerGuid(publicKey: record.publicKey) else { return false }
            return members.contains(guid) && !signed.contains(guid)
        }
    }

    /// Whether any of this wallet's accounts is in `intent`'s signer snapshot.
    func holdsSigner(for intent: MultisigIntent) -> Bool {
        let members = Set(intent.signerGuids)
        return wallet.records.contains { record in
            (try? argentSignerGuid(publicKey: record.publicKey)).map(members.contains) == true
        }
    }

    /// The read a sign or submit takes, made by the core for that intent, over each endpoint.
    private func intentRead(_ id: String) async throws -> MultisigStateRead {
        let walletCore = core, now = nowMs
        return try await ChainReads.multisig(on: wallet.networkInfo, via: rpc) {
            try walletCore.multisigIntentRead(intentId: id, nowMs: now)
        } status: { $0.status() }
    }
}

/// Collecting, ready and stale intents still need someone; the rest are done or on chain.
func isOpen(_ intent: MultisigIntent) -> Bool {
    [.collecting, .ready, .stale].contains(intent.state)
}

/// A multisig step's refusal as the screen shows it: the core's refusal (`InvalidInput`) read
/// through the extension's friendly copy (`FriendlyError`), as the side panel's multisig screens
/// show it, then redacted like every failure text; any other error as `describe` words it.
func describeRefusal(_ error: Error) -> String {
    guard case let .InvalidInput(reason)? = error as? CoreError else { return describe(error) }
    return redactEndpoints(text: FriendlyError.message(reason))
}

/// How a multisig plan ended when it did not reach its goal; the message is the extension's.
struct MultisigTxError: LocalizedError {
    let failure: MultisigTxFailure?

    init(_ step: MultisigTxStep) {
        if case .failed(let failure) = step { self.failure = failure } else { failure = nil }
    }

    var errorDescription: String? { failure.map(MultisigTxText.failure) ?? SendCopy.failureDefault }
}

/// A multisig plan the core hands out.
protocol MultisigTxPlan: Sendable {
    func advance(reply: StepReply) throws -> MultisigTxStep
}

extension MultisigProposal: MultisigTxPlan {}
extension MultisigSubmission: MultisigTxPlan {}

/// Relays one multisig plan's steps over one bound endpoint (`RpcEndpoint`: the endpoint that
/// proves the chain serves the whole plan; a write is sent exactly once, never redirected).
enum MultisigTxDriver {
    static func run(
        _ plan: some MultisigTxPlan,
        network: NetworkInfo,
        transport: RpcTransport
    ) async throws -> MultisigTxStep {
        let endpoint = RpcEndpoint(network: network, transport: transport)
        var reply = StepReply.start
        while true {
            let step = try plan.advance(reply: reply)
            guard case let .rpc(id, body, purpose, isWrite) = step else { return step }
            reply = await endpoint.exchange(id: id, body: body, purpose: purpose, write: isWrite)
        }
    }

    /// Reads the status of each of `intents`' submitted transactions through `refresh_activity`
    /// for `multisigId` (wallet-core #115: a multisig's submissions are filed under its id), as
    /// Activity's observation does for an account. The plan never signs; the core settles the
    /// intent from the updated row on its next list read. A refused or failed read leaves the
    /// intent submitted for a later list. Returns whether any read ran.
    static func settle(
        _ intents: [MultisigIntent],
        of multisigId: String,
        core: WalletCore,
        network: NetworkInfo,
        transport: RpcTransport
    ) async -> Bool {
        var ran = false
        for intent in intents where intent.state == .submitted {
            guard let hash = intent.broadcastTransactionHash,
                  let plan = try? core.refreshActivity(accountId: multisigId, hash: hash) else { continue }
            _ = try? await SendDriver(plan: plan, network: network, transport: transport).run(from: .start)
            ran = true
        }
        return ran
    }
}
