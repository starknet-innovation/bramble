import BrambleCore
import Foundation

/// Runs the core's multisig reads (`multisig_rpc.rs`, `class_declared.rs`) through the app's one
/// `RpcTransport`, each reply bounded by its request's `maxResponseBytes`, over each bundled
/// endpoint in order, as `withRpcFallback`: an endpoint that cannot answer
/// (`NetworkUnavailable`) falls through to the next.
enum ChainReads {
    static func authority(
        of address: String,
        on network: NetworkInfo,
        via transport: RpcTransport
    ) async throws -> MultisigAuthorityRead {
        try await multisig(on: network, via: transport) {
            try MultisigAuthorityRead(network: network.network, address: address)
        } status: { $0.status() }
    }

    /// A multisig's authority and nonce, as an intent import checks them against.
    static func state(
        of address: String,
        on network: NetworkInfo,
        via transport: RpcTransport
    ) async throws -> MultisigStateRead {
        try await multisig(on: network, via: transport) {
            try MultisigStateRead(network: network.network, address: address)
        } status: { $0.status() }
    }

    /// Runs a fresh read from `make` against each endpoint in order until one is reachable
    /// (`NetworkUnavailable` falls through); returns the last read, whatever it decided.
    static func multisig<Read: ChainRead>(
        on network: NetworkInfo,
        via transport: RpcTransport,
        make: @Sendable () throws -> Read,
        status: @Sendable (Read) -> MultisigAuthorityStatus?
    ) async throws -> Read {
        var last = try make()
        for url in network.rpcUrls.compactMap(URL.init(string:)) {
            let read = try make()
            await run(read, at: url, via: transport)
            last = read
            if status(read) != .networkUnavailable { break }
        }
        return last
    }

    /// Declared or undeclared once a node answered; unverified when no endpoint could.
    static func classDeclared(on network: NetworkInfo, via transport: RpcTransport) async -> ClassDeclaration {
        for url in network.rpcUrls.compactMap(URL.init(string:)) {
            let read = ClassDeclaredRead(network: network.network)
            await run(read, at: url, via: transport)
            if let declared = read.declared() { return declared ? .declared : .undeclared }
        }
        return .unverified
    }

    /// Posts each request `read` plans to `url` until it has none; a transport failure is reported
    /// to the read, never thrown.
    private static func run(_ read: some ChainRead, at url: URL, via transport: RpcTransport) async {
        while let request = read.nextRequest() {
            do {
                let body = try await transport.post(
                    request.body,
                    to: url,
                    write: false,
                    maxBytes: request.maxResponseBytes
                )
                try read.acceptResponse(id: request.id, body: body)
            } catch {
                read.transportFailed(id: request.id)
            }
        }
    }
}

/// The core's sans-IO chain reads: the host posts each request and hands back the reply.
protocol ChainRead {
    func nextRequest() -> RpcRequest?
    func acceptResponse(id: UInt64, body: String) throws
    func transportFailed(id: UInt64)
}

extension MultisigAuthorityRead: ChainRead {}
extension MultisigStateRead: ChainRead {}
extension ClassDeclaredRead: ChainRead {}

/// What the chain said about a pinned class hash.
enum ClassDeclaration: Equatable {
    case declared
    case undeclared
    /// No endpoint answered, so the class could not be checked.
    case unverified
}

#if DEBUG
/// Recorded answers for UI tests (`-BrambleStubNetwork YES`); never compiled into release builds.
/// `0x123` is a deployed 1-of-1 multisig whose signer is the parity phrase's first account,
/// `0x456` has another class, every other address is undeployed, and the class is declared. A
/// multisig transaction is proposed at nonce 0 under the fee `extension-multisig-transactions.json`
/// recorded, and no transaction hash is known; nothing is ever broadcast.
struct StubRpcTransport: RpcTransport {
    /// The recorded block number every `starknet_blockHashAndNumber` answer carries.
    private static let stubBlockNumber = 7
    /// JSON-RPC error code the stub returns for an undeployed contract.
    private static let contractNotFoundCode = 20
    /// `TXN_HASH_NOT_FOUND`: the stub knows no transaction.
    private static let hashNotFoundCode = 29
    /// The fee estimate the extension's multisig proposal read (Sepolia).
    private static let estimate: [[String: String]] = [
        [
            "l1_data_gas_consumed": "0x180", "l1_data_gas_price": "0x5a0", "l1_gas_consumed": "0x0",
            "l1_gas_price": "0x2d5c6b1e1ef", "l2_gas_consumed": "0x1234a0", "l2_gas_price": "0xb2d05e00",
            "overall_fee": "0x1bb0f4d6c0000", "unit": "FRI"
        ]
    ]
    /// JSON-RPC error code the stub returns for a method it does not record.
    private static let methodNotFoundCode = -32_601

    let chainId: String
    let signerGuid: String

    func post(_ body: String, to _: URL, write _: Bool) throws -> String {
        let request = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any] ?? [:]
        let id = request["id"] as? Int ?? 0
        let params = request["params"] as? [String: Any] ?? [:]
        let address = params["contract_address"] as? String
            ?? (params["request"] as? [String: Any])?["contract_address"] as? String
        let selector = (params["request"] as? [String: Any])?["entry_point_selector"] as? String ?? ""
        let result: Any
        switch request["method"] as? String {
        case "starknet_chainId":
            result = chainId

        case "starknet_blockHashAndNumber":
            result = ["block_hash": "0xb10c", "block_number": Self.stubBlockNumber]

        case "starknet_getClass":
            result = [String: Any]()

        case "starknet_getClassHashAt":
            switch address {
            case "0x123":
                result = "0x07aeca3456816e3b833506d7cc5c1313d371fbdb0ae95ee70af72a4ddbf42594"

            case "0x456":
                result = "0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381"

            default:
                return Self.error(id: id, code: Self.contractNotFoundCode)
            }

        case "starknet_call":
            result = selector.hasPrefix("0x1753") ? ["0x1"] : ["0x1", signerGuid]

        case "starknet_getNonce":
            result = "0x0"

        case "starknet_estimateFee":
            result = Self.estimate

        case "starknet_getTransactionStatus":
            return Self.error(id: id, code: Self.hashNotFoundCode)

        default:
            return Self.error(id: id, code: Self.methodNotFoundCode)
        }
        let answer: [String: Any] = ["jsonrpc": "2.0", "id": id, "result": result]
        let data = try JSONSerialization.data(withJSONObject: answer)
        // JSONSerialization always writes UTF-8, so this never throws in practice.
        guard let text = String(bytes: data, encoding: .utf8) else { throw CocoaError(.coderInvalidValue) }
        return text
    }

    private static func error(id: Int, code: Int) -> String {
        #"{"jsonrpc":"2.0","id":\#(id),"error":{"code":\#(code),"message":"stub"}}"#
    }
}
#endif
