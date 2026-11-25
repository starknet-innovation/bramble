import BrambleCore
import Observation

/// A sans-IO staking read the core steps: the overview or "Your stakes" (`StakingChainRead`) and
/// an action's pinned pool read (`StakingPreparation`). Both answer the same three calls.
protocol StakingReadSteps: AnyObject, Sendable {
    func nextCalls() -> [RpcRequest]
    func accept(reply: RpcReply) -> ScanStep
    func restart()
}

extension StakingChainRead: StakingReadSteps {}
extension StakingPreparation: StakingReadSteps {}

extension PortfolioEndpoints {
    /// Runs `read` to its end on the first verified endpoint that answers, replaying it from the
    /// start on the next after a transport failure (`withRpcFallback`). The core's `view` or `plan`
    /// refuses a read that never finished, so the caller learns the outcome from the core.
    func drive(_ read: some StakingReadSteps, on network: NetworkInfo) async {
        _ = await firstAnswer(on: network) { url -> Void? in
            read.restart()
            while true {
                let calls = read.nextCalls()
                if calls.isEmpty { return () }
                for reply in await send(calls, to: url) where read.accept(reply: reply) == .transport {
                    return nil
                }
            }
        }
    }
}

/// The staking screen's state (`staking-directory-client.ts`, `staking-client.ts`): "Your stakes",
/// Starkscan's validator directory with the paste field, and one validator's pools. The core makes
/// every request, judges every reply and formats every figure; this model only sequences reads and
/// keeps what to show. Mainnet only: `unavailable` holds the core's refusal on any other network,
/// and then nothing is read at all.
@MainActor
@Observable
final class StakingModel {
    /// One read's state on screen.
    enum Load<Value> {
        case loading
        /// The read is switched off (the explorer choice keeps the address from Starkscan).
        case off
        case failed(String)
        case loaded(Value)
    }

    /// Starkscan's validator list, page by page, in its own order.
    struct Directory {
        var entries: [DirectoryEntry]
        var nextCursor: String?
        /// A later page that failed: one line under the list, which stays.
        var moreError: String?
        /// The snapshot was incomplete, so it offers no validator.
        var incomplete = false
    }

    /// The validator on screen: its address (canonical) and the directory's name for it, if any.
    struct Validator: Equatable {
        let staker: String
        let name: String?
    }

    /// The core's refusal when staking is off on this network; nil on Mainnet.
    let unavailable: String?
    private(set) var positions: Load<StakingView> = .loading
    private(set) var directory: Load<Directory> = .loading
    private(set) var validator: Validator?
    private(set) var pools: Load<StakingView> = .loading
    private(set) var loadingMore = false
    var pasteInput = "" { didSet { pasteError = nil } }
    private(set) var pasteError: String?

    let core: WalletCore
    let network: NetworkInfo
    let accountId: String
    let tokens: TokenPreferences
    let transport: any PortfolioTransport
    let endpoints: PortfolioEndpoints
    /// Unix seconds, injected so a test pins the unlock times the rows read.
    let clock: @Sendable () -> UInt64
    /// Bumped whenever the screen opens or leaves a validator; a read that lands late is dropped.
    private var generation = 0

    init(
        core: WalletCore,
        network: NetworkInfo,
        accountId: String,
        tokens: TokenPreferences,
        transport: any PortfolioTransport,
        clock: @escaping @Sendable () -> UInt64
    ) {
        self.core = core
        self.network = network
        self.accountId = accountId
        self.tokens = tokens
        self.transport = transport
        self.clock = clock
        endpoints = PortfolioEndpoints(transport: transport)
        unavailable = Self.refusal(on: network.network)
    }

    /// The core's refusal for staking on `network`, nil where it is on (`STAKING_POLICY`). The app
    /// never decides this from the network itself.
    nonisolated static func refusal(on network: NetworkId) -> String? {
        do {
            _ = try stakingDirectoryRequest(network: network, cursor: nil)
            return nil
        } catch {
            return StakingText.message(error)
        }
    }

    /// Reads "Your stakes" and the directory's first page. Nothing at all where staking is off.
    func load() async {
        guard unavailable == nil else { return }
        async let stakes: Void = loadPositions()
        async let listed: Void = loadDirectory(cursor: nil)
        _ = await (stakes, listed)
    }

    /// "Your stakes": Starkscan names the candidates, the chain read verifies each one.
    func loadPositions() async {
        positions = .loading
        do {
            guard let request = try core.stakingPositionsRequest(accountId: accountId, tokens: tokens) else {
                positions = .off
                return
            }
            let outcome = await transport.perform(request)
            let read = try core.stakingPositions(accountId: accountId, outcome: outcome, tokens: tokens)
            await endpoints.drive(read, on: network)
            positions = try .loaded(read.view(nowSeconds: clock()))
        } catch {
            positions = .failed(StakingText.message(error))
        }
    }

    /// The directory's first page, or (with `cursor`) the next one appended under it.
    func loadDirectory(cursor: String?) async {
        if cursor == nil { directory = .loading } else { loadingMore = true }
        defer { loadingMore = false }
        do {
            guard let request = try stakingDirectoryRequest(network: network.network, cursor: cursor) else {
                directory = .off
                return
            }
            let outcome = await transport.perform(request)
            let page = try stakingDirectoryView(network: network.network, outcome: outcome, tokens: tokens)
            var listed = Directory(entries: [], nextCursor: nil)
            if cursor != nil, case let .loaded(current) = directory { listed = current }
            switch page {
            case .incomplete:
                listed.incomplete = cursor == nil
                listed.moreError = cursor == nil ? nil : StakingCopy.directoryIncomplete
                listed.nextCursor = nil

            case let .ready(entries, nextCursor):
                listed.entries += entries
                listed.nextCursor = nextCursor
                listed.moreError = nil
            }
            directory = .loaded(listed)
        } catch {
            if cursor != nil, case var .loaded(current) = directory {
                current.moreError = StakingText.message(error)
                directory = .loaded(current)
            } else {
                directory = .failed(StakingText.message(error))
            }
        }
    }

    /// The paste field's Open: a valid Starknet address opens that validator; anything else says so.
    func openPasted() async {
        guard let staker = validateRecipient(input: pasteInput) else {
            pasteError = StakingCopy.directoryInvalidAddress
            return
        }
        await open(staker: staker, name: nil)
    }

    /// Opens one validator's pools for the account, each verified on chain.
    func open(staker: String, name: String?) async {
        generation += 1
        let opened = generation
        validator = Validator(staker: staker, name: name)
        pools = .loading
        let result: Load<StakingView>
        do {
            let read = try core.stakingOverview(accountId: accountId, staker: staker, tokens: tokens)
            await endpoints.drive(read, on: network)
            result = try .loaded(read.view(nowSeconds: clock()))
        } catch {
            result = .failed(StakingText.message(error))
        }
        guard opened == generation else { return }
        pools = result
    }

    /// "All validators": back to the list, which re-reads "Your stakes" after an action.
    func closeValidator() {
        generation += 1
        validator = nil
        pools = .loading
    }

    /// The directory's name for `staker`, when the list already holds one.
    func name(of staker: String) -> String? {
        guard case let .loaded(listed) = directory else { return nil }
        let wanted = validateRecipient(input: staker)
        return listed.entries.first { validateRecipient(input: $0.staker) == wanted }?.name
    }
}
