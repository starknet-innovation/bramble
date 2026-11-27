import BrambleCore
import Foundation

/// Reliability diagnostics, as the extension's `rpc-diagnostics.ts` and `support/diagnostics.ts`:
/// while on, in-memory counters of RPC and Starkscan outcomes by fixed label (endpoint class,
/// outcome) with an average latency. Nothing is sent: the person exports the report themselves.
/// Turning it off clears every counter. No URL, address, amount, key, phrase, note, contact or
/// error text is ever kept; a row is fixed labels and numbers only.
final class ReliabilityDiagnostics: @unchecked Sendable {
    static let shared = ReliabilityDiagnostics()
    static let enabledKey = "bramble:reliability-diagnostics"

    /// One aggregate row, keyed by fixed labels only.
    struct Row: Equatable {
        var count: Int
        var latencyMs: Int
    }

    private enum Status {
        static let success200: UInt16 = 200
        static let tooMany: UInt16 = 429
        static let success: Range<UInt16> = 200..<300
    }

    private static let attosecondsPerMs: Int64 = 1_000_000_000_000_000
    private static let msPerSecond: Int64 = 1_000

    private let defaults: UserDefaults
    private let lock = NSLock()
    private var rpcRows: [String: Row] = [:]
    private var explorerRows: [String: Row] = [:]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The person's choice. Off by default; turning it off clears the counters at once.
    var enabled: Bool {
        get { defaults.bool(forKey: Self.enabledKey) }
        set {
            defaults.set(newValue, forKey: Self.enabledKey)
            if !newValue { lock.withLock { rpcRows = [:]; explorerRows = [:] } }
        }
    }

    /// `rpcEndpointClass`: the class of `url`'s host, never the host itself.
    static func endpointClass(_ url: URL) -> String {
        let host = url.host ?? ""
        if host == GatewayAnalytics.host { return "wallet-gateway" }
        if host.hasSuffix(".nodes.starknet.org") || host == "api.cartridge.gg" { return "foundation" }
        return "custom"
    }

    /// Records one JSON-RPC exchange to `url` that took `elapsed`.
    func recordRpc(_ url: URL, _ outcome: HttpOutcome, elapsed: Duration) {
        let label = if outcome.timedOut {
            "timeout"
        } else if outcome.status == Status.tooMany {
            "rate-limited"
        } else if outcome.status == Status.success200, outcome.body != nil {
            "ok"
        } else {
            "transport-error"
        }
        record(rpc: true, key: "\(Self.endpointClass(url)):\(label)", elapsed: elapsed)
    }

    /// Records one Starkscan read; `applied` is whether the core accepted its answer.
    func recordExplorer(_ outcome: HttpOutcome, applied: Bool, elapsed: Duration) {
        let label = if outcome.timedOut {
            "timeout"
        } else if outcome.status == 0 {
            "transport-error"
        } else if outcome.status == Status.tooMany {
            "rate-limited"
        } else if !Status.success.contains(outcome.status) {
            "http-error"
        } else {
            applied ? "ok" : "invalid-response"
        }
        record(rpc: false, key: label, elapsed: elapsed)
    }

    /// The export: the extension's report shape, limited to what mobile counts. Sorted keys, so the
    /// same counters always give the same text.
    func report(accountCount: Int, network: NetworkId, version: String) -> String {
        let (rpcSnapshot, explorerSnapshot) = lock.withLock { (rpcRows, explorerRows) }
        let rpc = rpcSnapshot.sorted { $0.key < $1.key }.map { key, row -> [String: Any] in
            let parts = key.split(separator: ":").map(String.init)
            return ["count": row.count, "endpoint": parts[0], "latencyMs": row.latencyMs, "outcome": parts[1]]
        }
        let explorer = explorerSnapshot.sorted { $0.key < $1.key }.map { key, row -> [String: Any] in
            ["count": row.count, "latencyMs": row.latencyMs, "outcome": key, "service": "starkscan"]
        }
        let diagnostics: [String: Any] = [
            "accountCount": accountCount,
            "collectionEnabled": enabled,
            "explorer": explorer,
            "networkId": network == .mainnet ? "SN_MAIN" : "SN_SEPOLIA",
            "rpc": rpc
        ]
        let report: [String: Any] = ["build": ["platform": "ios", "version": version], "diagnostics": diagnostics]
        let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        return data.map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }

    private func record(rpc: Bool, key: String, elapsed: Duration) {
        guard enabled else { return }
        let (seconds, attoseconds) = elapsed.components
        let elapsedMs = Int(seconds * Self.msPerSecond + attoseconds / Self.attosecondsPerMs)
        lock.withLock {
            let previous = (rpc ? rpcRows[key] : explorerRows[key]) ?? Row(count: 0, latencyMs: 0)
            let count = previous.count + 1
            let average = (Double(previous.latencyMs * (count - 1) + elapsedMs) / Double(count)).rounded()
            let row = Row(count: count, latencyMs: Int(average))
            if rpc { rpcRows[key] = row } else { explorerRows[key] = row }
        }
    }
}
