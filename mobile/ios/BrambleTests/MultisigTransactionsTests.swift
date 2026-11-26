@testable import Bramble
import BrambleCore
import XCTest

/// Multisig transactions (M18) through the app's own byte-moving code (`ChainReads`,
/// `MultisigTxDriver`, `RpcEndpoint`) over a fake node answering from the extension's recorded
/// proposal (`extension-multisig-transactions.json`): the proposal, both co-signatures and the
/// submission must come out as the extension's bytes, and the core's stale and resend guards must
/// reach the screens' copy. No test touches the network; the one write goes to the fake node.
final class MultisigTransactionsTests: XCTestCase {
    /// The wall clock the reads report (any fixed time).
    private static let nowMs: UInt64 = 1_790_000_000_000

    /// One wallet holding the fixture phrase's OpenZeppelin signers 0 to 3 and the fixture multisig.
    private struct Wallet {
        let net: [String: Any]
        let core: WalletCore
        let node: MultisigNode
        let network: NetworkInfo

        var account: [String: Any] { (net["account"] as? [String: Any]) ?? [:] }
        var proposal: [String: Any] { (net["proposal"] as? [String: Any]) ?? [:] }
        var multisigId: String { account["id"] as? String ?? "" }
        var address: String { account["address"] as? String ?? "" }

        /// The vault record of the fixture signer at OpenZeppelin index `index`.
        func signer(_ index: Int) throws -> String {
            let signers: [[String: Any]] = try fixtureValue(net, "signers")
            let key = try XCTUnwrap(signers.first { $0["accountIndex"] as? Int == index }?["publicKey"] as? String)
            return try XCTUnwrap(try core.accountRecords(network: .sepolia).first { $0.publicKey == key }).id
        }

        func stored() throws -> [MultisigIntent] { try core.multisigIntents(multisigId: multisigId) }
    }

    private func wallet() throws -> Wallet {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "extension-multisig-transactions", withExtension: "json")
        )
        let fixture = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let networks: [[String: Any]] = try fixtureValue(fixture, "networks")
        let net = try XCTUnwrap(networks.first { $0["networkId"] as? String == "SN_SEPOLIA" })
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let core = try WalletCore(dataDir: dir.path, clock: DeviceClock())
        try core.importWallet(password: testPassword, phrase: try fixtureValue(fixture, "mnemonic"))
        _ = try core.restoreRecoveredAccounts(network: .sepolia, selections: (0...3).map { index in
            RecoverySelection(family: .openZeppelin, accountIndex: index, classHash: nil)
        })
        let node = try MultisigNode(
            account: try fixtureValue(net, "account"),
            proposal: try fixtureValue(net, "proposal")
        )
        let wallet = Wallet(net: net, core: core, node: node, network: try sepolia())
        let deploy: [String: Any] = try fixtureValue(net, "deploy")
        let input: [String: Any] = try fixtureValue(deploy, "input")
        let keys: [String] = try fixtureValue(input, "signerPublicKeys")
        _ = try core.saveMultisigSetup(
            network: .sepolia,
            name: nil,
            config: ArgentMultisigConfig(threshold: try fixtureValue(input, "threshold"), signerPublicKeys: keys),
            salt: try fixtureValue(input, "salt"),
            deployerAccountId: try wallet.signer(try fixtureValue(deploy, "deployerAccountIndex"))
        )
        return wallet
    }

    /// A felt's hex digits without the prefix or leading zeros, for comparing spellings.
    private func digits(_ felt: String) -> String {
        String(felt.lowercased().dropFirst(2).drop { $0 == "0" })
    }

    /// The fixture's one STRK transfer, as the composer sends it: token id, recipient, decimal text.
    private func transfer(_ wallet: Wallet) throws -> MultisigProposalRequest {
        let calls: [[String: Any]] = try fixtureValue(wallet.proposal, "calls")
        let call = try XCTUnwrap(calls.first)
        let calldata: [String] = try fixtureValue(call, "calldata")
        let contract: String = try fixtureValue(call, "contractAddress")
        let low = try XCTUnwrap(UInt64(calldata[1].dropFirst(2), radix: MultisigNode.hexRadix))
        let unit: UInt64 = 1_000_000_000_000_000_000
        let fraction = String(String(format: "%018llu", low % unit).reversed().drop { $0 == "0" }.reversed())
        let tracked = TokenPreferences(persisted: nil).tracked(network: .sepolia)
        let token = try XCTUnwrap(tracked.first { digits($0.token.address) == digits(contract) })
        let amount = fraction.isEmpty ? "\(low / unit)" : "\(low / unit).\(fraction)"
        return .transfer(tokenId: token.token.id, recipient: calldata[0], amount: amount)
    }

    private func propose(_ wallet: Wallet, confirmResend: Bool = false) async throws -> MultisigTxStep {
        let read = try await ChainReads.authority(of: wallet.address, on: wallet.network, via: wallet.node)
        let plan = try wallet.core.proposeMultisigTransaction(
            read: read,
            request: try transfer(wallet),
            tokens: TokenPreferences(persisted: nil),
            confirmResend: confirmResend
        )
        return try await MultisigTxDriver.run(plan, network: wallet.network, transport: wallet.node)
    }

    private func intentRead(_ wallet: Wallet, _ id: String) async throws -> MultisigStateRead {
        let core = wallet.core
        return try await ChainReads.multisig(on: wallet.network, via: wallet.node) {
            try core.multisigIntentRead(intentId: id, nowMs: Self.nowMs)
        } status: { read in read.status() }
    }

    func testProposalIsCosignedAndSubmittedAsTheExtensionDoes() async throws {
        let wallet = try wallet()
        let step = try await propose(wallet)
        guard case .proposed(let id) = step else {
            XCTFail("proposed, got \(step)")
            return
        }
        var intent = try XCTUnwrap(try wallet.stored().first { $0.id == id })
        XCTAssertEqual(intent.package, wallet.proposal["proposalPackage"] as? String)
        XCTAssertEqual(intent.state, .collecting)
        XCTAssertEqual(MultisigTxText.status(intent), "Awaiting signatures · 0 of 2")

        for index in try XCTUnwrap(wallet.proposal["cosignerAccountIndexes"] as? [Int]) {
            let read = try await intentRead(wallet, intent.id)
            let signer = try wallet.signer(index)
            intent = try wallet.core.signMultisigIntent(intentId: intent.id, signerAccountId: signer, state: read)
        }
        XCTAssertEqual(intent.state, .ready)
        XCTAssertEqual(intent.package, wallet.proposal["readyPackage"] as? String)
        XCTAssertEqual(MultisigTxText.action(intent, canSign: false, holdsSigner: true).0, .submit)

        let read = try await intentRead(wallet, intent.id)
        let submission = try wallet.core.submitMultisigIntent(intentId: intent.id, state: read)
        let sent = try await MultisigTxDriver.run(submission, network: wallet.network, transport: wallet.node)
        XCTAssertEqual(sent, .submitted(hash: try fixtureValue(wallet.proposal, "transactionHash")))
        XCTAssertEqual(wallet.node.writes, 1, "the threshold signature is posted exactly once")
        XCTAssertEqual(try wallet.stored().first?.state, .submitted)
        let again = try await intentRead(wallet, intent.id)
        XCTAssertThrowsError(try wallet.core.submitMultisigIntent(intentId: intent.id, state: again), "never twice")
    }

    /// A submitted intent's activity row is read by `refresh_activity` for the multisig id
    /// (wallet-core #115), and the core's next list settles the intent from it. Never a write.
    func testSubmittedIntentSettlesAfterTheRefresh() async throws {
        let wallet = try wallet()
        guard case .proposed(let id) = try await propose(wallet) else {
            XCTFail("proposed")
            return
        }
        for index in try XCTUnwrap(wallet.proposal["cosignerAccountIndexes"] as? [Int]) {
            let read = try await intentRead(wallet, id)
            _ = try wallet.core.signMultisigIntent(intentId: id, signerAccountId: try wallet.signer(index), state: read)
        }
        let submission = try wallet.core.submitMultisigIntent(intentId: id, state: try await intentRead(wallet, id))
        _ = try await MultisigTxDriver.run(submission, network: wallet.network, transport: wallet.node)
        XCTAssertEqual(try wallet.stored().first { $0.id == id }?.state, .submitted)

        wallet.node.landed = true
        let ran = await MultisigTxDriver.settle(
            try wallet.stored(),
            of: wallet.multisigId,
            core: wallet.core,
            network: wallet.network,
            transport: wallet.node
        )
        XCTAssertTrue(ran)
        XCTAssertEqual(try wallet.stored().first { $0.id == id }?.state, .accepted)
        XCTAssertEqual(wallet.node.writes, 1, "settling never writes")
    }

    /// The chain's nonce moved past a collecting intent: signing it is refused and it is stored
    /// stale; proposing the same calls again then needs the person's "Send anyway".
    func testStaleIntentAndResendGuardReachTheScreens() async throws {
        let wallet = try wallet()
        guard case .proposed(let id) = try await propose(wallet) else {
            XCTFail("proposed")
            return
        }
        wallet.node.nonce = "0x6"
        let read = try await intentRead(wallet, id)
        let signer = try wallet.signer(1)
        XCTAssertThrowsError(try wallet.core.signMultisigIntent(intentId: id, signerAccountId: signer, state: read))
        let stale = try XCTUnwrap(try wallet.stored().first { $0.id == id })
        XCTAssertEqual(stale.state, .stale)
        XCTAssertEqual(stale.staleReason, .nonce)
        XCTAssertTrue(isOpen(stale))
        let (action, note) = MultisigTxText.action(stale, canSign: true, holdsSigner: true)
        XCTAssertEqual(action, .nothing)
        XCTAssertEqual(
            note,
            "This may already have been sent by another signer. "
                + "This version is out of date — create a new transaction to continue."
        )
        XCTAssertEqual(MultisigTxText.status(stale), "Out of date · needs review · 0 of 2")

        let again = try await propose(wallet)
        XCTAssertEqual(again, .failed(failure: .resendUnconfirmed))
        XCTAssertEqual(
            MultisigTxError(again).errorDescription,
            "This may already have been sent by another signer. Press again to send it anyway."
        )
        guard case .proposed = try await propose(wallet, confirmResend: true) else {
            XCTFail("the confirmed resend is proposed")
            return
        }
        XCTAssertEqual(wallet.node.writes, 0, "proposing never writes")
    }

    func testImportRefusesWhatTheCoreRefuses() async throws {
        let wallet = try wallet()
        let read = try await ChainReads.state(of: wallet.address, on: wallet.network, via: wallet.node)
        let tokens = TokenPreferences(persisted: nil)
        XCTAssertThrowsError(
            try wallet.core.importMultisigIntent(package: "not a package", state: read, tokens: tokens)
        ) { error in
            XCTAssertEqual(describeRefusal(error), "That package isn't a valid transaction. Ask for a fresh copy.")
        }
        let imported = try wallet.core.importMultisigIntent(
            package: try fixtureValue(wallet.proposal, "readyPackage"),
            state: read,
            tokens: tokens
        )
        XCTAssertEqual(imported.state, .ready)
    }

    func testFailureCopyIsTheExtensions() {
        XCTAssertEqual(MultisigTxText.failure(.alreadySent), "This transaction was already sent.")
        XCTAssertEqual(MultisigTxText.failure(.submissionIndeterminate), SendCopy.failureIndeterminate)
        XCTAssertEqual(MultisigTxText.failure(.nodeError), SendCopy.failureDefault)
    }
}

/// The intent card's review (`multisig_intent_review`, wallet-core #146) through the app's own
/// authority read: each call's summary and the core's flags, and whether the chain's signers still
/// match. Signers that moved, or a review that could not be read, offer neither Sign nor Submit and
/// add the extension's sentence after the flags.
extension MultisigTransactionsTests {
    private func review(_ wallet: Wallet, _ id: String) async throws -> MultisigIntentReview {
        let read = try await ChainReads.authority(of: wallet.address, on: wallet.network, via: wallet.node)
        return try wallet.core.multisigIntentReview(intentId: id, tokens: TokenPreferences(persisted: nil), read: read)
    }

    func testTheCardsReviewOffersSigningOnlyWhileTheSignersMatch() async throws {
        let wallet = try wallet()
        guard case .proposed(let id) = try await propose(wallet) else {
            XCTFail("proposed")
            return
        }
        let intent = try XCTUnwrap(try wallet.stored().first { $0.id == id })
        XCTAssertEqual(digits(intent.sender), digits(wallet.address))

        let fresh = try await review(wallet, id)
        XCTAssertTrue(fresh.hasFreshAuthority)
        XCTAssertEqual(fresh.calls.map(\.entrypoint), ["transfer"])
        XCTAssertFalse(fresh.calls[0].summary.isEmpty)
        XCTAssertEqual(MultisigTxText.risks(fresh), fresh.riskFlags.map(\.message))
        XCTAssertEqual(MultisigTxText.action(intent, canSign: true, holdsSigner: true, signers: .match).0, .sign)

        wallet.node.threshold = 1
        let moved = try await review(wallet, id)
        XCTAssertFalse(moved.hasFreshAuthority)
        XCTAssertEqual(moved.calls, fresh.calls, "the calls are reviewed the same either way")
        XCTAssertEqual(MultisigTxText.risks(moved), moved.riskFlags.map(\.message) + [MultisigCopy.cardSignersChanged])
        XCTAssertEqual(
            MultisigCopy.cardSignersChanged,
            "The on-chain signers no longer match this transaction. Signing and submission are disabled."
        )
        let (action, note) = MultisigTxText.action(intent, canSign: true, holdsSigner: true, signers: .changed)
        XCTAssertEqual(action, .nothing)
        XCTAssertEqual(note, MultisigCopy.noteSignersChanged)

        // Unread (still reading) offers nothing yet; unreadable says the signers are unproven.
        XCTAssertEqual(MultisigTxText.action(intent, canSign: true, holdsSigner: true, signers: .reading).0, .nothing)
        XCTAssertEqual(MultisigTxText.risks(nil), [MultisigCopy.cardSignersChanged])
        XCTAssertEqual(wallet.node.writes, 0, "reviewing never writes")
    }

    /// A flag the core raises is listed in its own words: a transfer to the multisig itself.
    func testTheCardsPanelListsTheCoresFlags() async throws {
        let wallet = try wallet()
        guard case let .transfer(tokenId, _, amount) = try transfer(wallet) else {
            XCTFail("a transfer")
            return
        }
        let read = try await ChainReads.authority(of: wallet.address, on: wallet.network, via: wallet.node)
        let plan = try wallet.core.proposeMultisigTransaction(
            read: read,
            request: .transfer(tokenId: tokenId, recipient: wallet.address, amount: amount),
            tokens: TokenPreferences(persisted: nil),
            confirmResend: false
        )
        let step = try await MultisigTxDriver.run(plan, network: wallet.network, transport: wallet.node)
        guard case .proposed(let id) = step else {
            XCTFail("proposed, got \(step)")
            return
        }
        let review = try await review(wallet, id)
        XCTAssertEqual(review.riskFlags.map(\.code), [.selfTransfer])
        XCTAssertEqual(review.calls.first?.flags.map(\.code), [.selfTransfer])
        XCTAssertEqual(MultisigTxText.risks(review), review.riskFlags.map(\.message))
        XCTAssertFalse(MultisigTxText.risks(review)[0].isEmpty)
    }
}

/// A fake node for one multisig: its authority, the recorded nonce and fee estimate, no known
/// transaction hashes until `landed` (then every status read answers accepted on L2), and the
/// recorded acceptance of the one write. Counts writes.
final class MultisigNode: RpcTransport, @unchecked Sendable {
    static let hexRadix = 16
    /// `TXN_HASH_NOT_FOUND`, the answer to every hash lookup.
    private static let notFound = #"{"code":29,"message":"Transaction hash not found"}"#

    private let lock = NSLock()
    private let classHash: String
    private var currentThreshold: Int
    private let guids: [String]
    private let estimate: Any
    private let accepted: Any
    private var currentNonce = "0x5"
    private var writeCount = 0
    private var hasLanded = false

    var nonce: String {
        get { lock.withLock { currentNonce } }
        set { lock.withLock { currentNonce = newValue } }
    }
    /// The threshold the chain reports; changing it moves the signers away from any intent.
    var threshold: Int {
        get { lock.withLock { currentThreshold } }
        set { lock.withLock { currentThreshold = newValue } }
    }
    var writes: Int { lock.withLock { writeCount } }
    var landed: Bool {
        get { lock.withLock { hasLanded } }
        set { lock.withLock { hasLanded = newValue } }
    }

    init(account: [String: Any], proposal: [String: Any]) throws {
        classHash = try fixtureValue(account, "classHash")
        let config: [String: Any] = try fixtureValue(account, "currentConfig")
        currentThreshold = try fixtureValue(config, "threshold")
        let keys: [String] = try fixtureValue(config, "signerPublicKeys")
        guids = try keys.map { key in try argentSignerGuid(publicKey: key) }
        estimate = try Self.recorded(proposal, "prepare", "starknet_estimateFee")
        accepted = try Self.recorded(proposal, "submit", "starknet_addInvokeTransaction")
    }

    private static func recorded(_ proposal: [String: Any], _ phase: String, _ method: String) throws -> Any {
        let lines: [String] = try fixtureValue(proposal, phase)
        let exchanges = lines.compactMap { line in
            try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
        }
        let exchange = try XCTUnwrap(exchanges.first { $0["method"] as? String == method })
        let answer: [String: Any] = try fixtureValue(exchange, "reply")
        return try XCTUnwrap(answer["result"])
    }

    func post(_ body: String, to _: URL, write: Bool) throws -> String {
        let request = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        let id = request["id"] as? Int ?? 0
        let call = (request["params"] as? [String: Any])?["request"] as? [String: Any]
        let result: Any
        switch request["method"] as? String {
        case "starknet_chainId":
            result = "0x534e5f5345504f4c4941"

        case "starknet_blockHashAndNumber":
            result = ["block_hash": "0x1", "block_number": 1]

        case "starknet_getClassHashAt":
            result = classHash

        case "starknet_call":
            let selector = call?["entry_point_selector"] as? String ?? ""
            let count = "0x" + String(guids.count, radix: Self.hexRadix)
            result = selector.hasPrefix("0x1753") ? ["0x" + String(threshold, radix: Self.hexRadix)] : [count] + guids

        case "starknet_getNonce":
            result = nonce

        case "starknet_estimateFee":
            result = estimate

        case "starknet_getTransactionStatus" where landed:
            result = ["finality_status": "ACCEPTED_ON_L2", "execution_status": "SUCCEEDED"]

        case "starknet_addInvokeTransaction":
            XCTAssertTrue(write)
            lock.withLock { writeCount += 1 }
            result = accepted

        default:
            return #"{"jsonrpc":"2.0","id":\#(id),"error":\#(Self.notFound)}"#
        }
        let data = try JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": id, "result": result])
        return String(decoding: data, as: UTF8.self)
    }
}
