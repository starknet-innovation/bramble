#if DEBUG
import Foundation

/// Debug-only fixture network for the portfolio UI tests (`-BrambleUITestNetworkStub <scenario>`)
/// and the store's unit tests. It answers the exact requests the core builds — JSON-RPC reads,
/// CoinGecko prices and charts, Starkscan transfers — from fixed public data, so a scenario mirrors
/// one of the extension's portfolio stories without touching a real endpoint. Compiled out of
/// release builds, so a shipped app can never be pointed at fake data.
final class PortfolioNetworkStub: URLProtocol, @unchecked Sendable {
    static let defaultsKey = "BrambleUITestNetworkStub"

    static var scenario: String? { UserDefaults.standard.string(forKey: defaultsKey) }

    /// Routes a session through the stub when a scenario was requested at launch.
    static func install(on config: URLSessionConfiguration) {
        guard scenario != nil else { return }
        config.protocolClasses = [PortfolioNetworkStub.self]
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = request.httpBody ?? request.httpBodyStream.map(Self.drain)
        let (status, data) = PortfolioStubResponder.respond(
            scenario: Self.scenario ?? "ready", url: request.url, body: body
        )
        guard status != 0, let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "application/json"]) else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func drain(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}

/// The scenario data. Status 0 means "no answer" (a transport failure).
enum PortfolioStubResponder {
    static let account = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"
    static let peer = "0x5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f"
    static let strk = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
    static let eth = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    static let usdc = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb"
    /// The contract "Add by contract" reads in the UI test: Test Token (TST), 18 decimals.
    static let customToken = "0x0000000000000000000000000000000000000000000000000000000000000abc"

    private static let lock = NSLock()
    nonisolated(unsafe) private static var balanceReads = 0

    static func respond(scenario: String, url: URL?, body: Data?) -> (Int, Data) {
        guard let url, let host = url.host else { return (0, Data()) }
        if host.contains("coingecko") {
            return coinGecko(scenario: scenario, url: url)
        }
        if host.contains("starkscan") {
            return starkscan(scenario: scenario)
        }
        return rpc(scenario: scenario, url: url, body: body)
    }

    // Compares addresses by value: the core sends the canonical (unpadded) spelling.
    private static func felt(_ address: String) -> Substring {
        address.lowercased().dropFirst(2).drop { $0 == "0" }
    }

    private static func json(_ text: String, status: Int = 200) -> (Int, Data) {
        (status, Data(text.utf8))
    }

    private static func coinGecko(scenario: String, url: URL) -> (Int, Data) {
        if scenario == "prices-offline" { return json("{}", status: 500) }
        if url.path.contains("market_chart") {
            return json(#"{"prices":[[0,0.48],[1,0.5],[2,0.47],[3,0.52]]}"#)
        }
        let address = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "contract_addresses" }?.value ?? ""
        switch address {
        case strk: return json(#"{"\#(strk)":{"usd":0.5,"eur":0.45,"gbp":0.4,"usd_24h_change":2.5}}"#)
        case eth: return json(#"{"\#(eth)":{"usd":2500,"eur":2300,"gbp":1990,"usd_24h_change":-1.2}}"#)
        default: return json("{}")
        }
    }

    private static func starkscan(scenario: String) -> (Int, Data) {
        if scenario == "history-unavailable" { return json("{}", status: 503) }
        let row = { (from: String, to: String, token: String, amount: String, hash: String, time: String) in
            #"{"actionContext":null,"amount":"\#(amount)","blockNumber":900,"fromAddress":"\#(from)","logIndex":0,"rawValue":"\#(amount)","sourceTier":"finalized","standard":"erc20","timestampIso":"\#(time)","toAddress":"\#(to)","tokenAddress":"\#(token)","tokenDecimals":18,"tokenId":null,"tokenName":null,"tokenSymbol":null,"transferIndex":0,"txHash":"\#(hash)","txIndex":0}"#
        }
        let items = [
            row(peer, account, strk, "1500000000000000000", "0x0abc1", "2026-09-20T10:15:30Z"),
            row(account, peer, eth, "100000000000000000", "0x0abc2", "2026-09-19T08:00:00Z"),
        ]
        return json(#"{"items":[\#(items.joined(separator: ","))],"nextCursor":null}"#)
    }

    private static func rpc(scenario: String, url: URL, body: Data?) -> (Int, Data) {
        guard let body,
              let request = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let method = request["method"] as? String,
              let id = request["id"] as? Int else { return (0, Data()) }
        let result = { (value: String) in json(#"{"jsonrpc":"2.0","id":\#(id),"result":\#(value)}"#) }
        switch method {
        case "starknet_chainId":
            return result(url.absoluteString.contains("sepolia") ? #""0x534e5f5345504f4c4941""# : #""0x534e5f4d41494e""#)
        case "starknet_call":
            let call = (request["params"] as? [String: Any])?["request"] as? [String: Any]
            let contract = call?["contract_address"] as? String ?? ""
            let selector = call?["entry_point_selector"] as? String ?? ""
            return self.call(scenario: scenario, contract: contract, selector: selector, reply: result)
        case "starknet_blockNumber", "starknet_getEvents", "starknet_getBlockWithTxHashes":
            if scenario == "history-unavailable" { return (0, Data()) }
            return method == "starknet_blockNumber" ? result("500000") : result(#"{"events":[]}"#)
        default:
            return (0, Data())
        }
    }

    private static func call(scenario: String, contract: String, selector: String,
                             reply: (String) -> (Int, Data)) -> (Int, Data) {
        switch selector {
        case "0x361458367e696363fbcc70777d07ebbd2394e89fd0adcaf147faccd1d294d60": return reply(#"["0x5465737420546f6b656e"]"#)
        case "0x216b05c387bab9ac31918a3e61672f4618601f3c598a2f3f2710f37053e1ea4": return reply(#"["0x545354"]"#)
        case "0x4c4fb1ab068f6039d5780c68dd0fa2f8742cceb3426d19667778ca7f3518a9": return reply(#"["0x12"]"#)
        default: break
        }
        if scenario == "balance-error" { return (0, Data()) }
        if scenario == "saved-data" {
            lock.lock()
            balanceReads += 1
            let reads = balanceReads
            lock.unlock()
            if reads > 2 { return (0, Data()) }
        }
        let low = switch felt(contract) {
        case felt(strk): "0x42ec210956b3ba0000"
        case felt(eth): "0x3782dace9d90000"
        case felt(usdc): "0x4c4b40"
        case felt(customToken): "0x246ddf97976680000"
        default: "0x0"
        }
        return reply(#"["\#(low)","0x0"]"#)
    }
}
#endif
