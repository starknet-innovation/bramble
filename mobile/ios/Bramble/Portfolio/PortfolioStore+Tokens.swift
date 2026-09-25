import BrambleCore

/// Token management (`token-ops.ts`): show/hide, add by contract (metadata read on chain), find
/// held registry tokens, and a token's 7-day chart. Error copy is the extension's, from the core.
extension PortfolioStore {
    /// `setTokenHidden`; `false` when the id is refused ("Token update failed").
    func setHidden(_ tokenId: String, hidden: Bool) -> Bool {
        guard (try? preferences.setHidden(tokenId: tokenId, hidden: hidden)) != nil else { return false }
        persist()
        recompute()
        return true
    }

    /// `wallet.addToken`: `nil` on success, else the message to show.
    func addToken(_ input: String) async -> String? {
        guard let scope else { return "Add token failed" }
        guard let address = tokenAddAddress(input: input) else { return "invalid add token request" }
        let net = scope.network.network
        let endpoints = endpoints
        let generation = generation
        let outcome: TokenMetaOutcome? = await endpoints.firstAnswer(on: scope.network) { url in
            guard let calls = try? tokenMetadataRequests(firstId: 1, address: address) else {
                return .failed(message: "Add token failed")
            }
            let replies = await endpoints.send(calls, to: url)
            let judged = tokenMetadataJudge(network: net, address: address, firstId: 1, replies: replies)
            if case .transport = judged { return nil }
            return judged
        }
        guard generation == self.generation else { return "Add token failed" }
        switch outcome {
        case let .token(token):
            guard (try? preferences.add(token: token)) != nil else { return "Add token failed" }
            persist()
            recompute()
            await refresh(force: true)
            return nil

        case let .failed(message):
            return message

        case .transport, nil:
            return tokenNetworkError()
        }
    }

    /// `wallet.detectTokens`: held registry tokens not yet tracked, or the failure copy. Nothing is
    /// added until the user taps Add on a result.
    func discoverTokens() async -> Result<[TokenBalance], DiscoveryFailure> {
        guard let scope else { return .failure(DiscoveryFailure(message: "Token scan failed, try again")) }
        let candidates = preferences.discoveryCandidates(network: scope.network.network)
        guard !candidates.isEmpty else { return .success([]) }
        let address = scope.address
        let endpoints = endpoints
        let generation = generation
        let outcome: DiscoveryOutcome? = await endpoints.firstAnswer(on: scope.network) { url in
            guard let calls = try? balanceRequests(firstId: 1, account: address, tokens: candidates) else {
                return nil
            }
            let replies = await endpoints.send(calls, to: url)
            let judged = discoveryJudge(firstId: 1, candidates: candidates, replies: replies)
            if case .transport = judged { return nil }
            return judged
        }
        // A scan that outlived an account/network switch or a lock never shows under the new scope.
        guard generation == self.generation else { return .success([]) }
        switch outcome {
        case let .found(tokens):
            return .success(tokens)

        case let .failed(message):
            return .failure(DiscoveryFailure(message: message))

        case .transport, nil:
            return .failure(DiscoveryFailure(message: tokenNetworkError()))
        }
    }

    /// `getTokenChart` for a tracked token in the display currency.
    func chart(for token: TokenConfig) async -> [Double] {
        guard let scope else { return [] }
        let now = clock()
        let planned = try? prices.chartPlan(
            network: scope.network.network,
            address: token.address,
            currency: currency,
            nowMs: now
        )
        guard let plan = planned else {
            return []
        }
        switch plan {
        case let .serve(points):
            return points

        case let .fetch(request):
            let generation = generation
            let outcome = await transport.perform(request)
            // Dropped after a lock or scope change, so a deleted session's cache is never rewritten.
            guard generation == self.generation else { return [] }
            let points = prices.chartApply(address: token.address, currency: currency, outcome: outcome, nowMs: now)
            persist()
            return points
        }
    }

    /// The current fiat price of a token (`prices[address]`), `nil` when unpriced.
    func price(of token: TokenConfig) -> Double? {
        priceView?.prices.first { $0.address == token.address }?.value
    }

    /// The loaded balance of a token, if any.
    func balance(of token: TokenConfig) -> TokenBalance? {
        guard case let .loaded(view) = balances else { return nil }
        return view.balances.first { $0.token.id == token.id }
    }
}

/// A discovery failure's user-facing line.
struct DiscoveryFailure: Error, Equatable {
    let message: String
}
