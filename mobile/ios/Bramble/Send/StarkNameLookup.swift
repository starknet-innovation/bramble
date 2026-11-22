import BrambleCore
import Foundation

/// Starknet ID name → address on Send's recipient step: the extension's `resolveStarkName`
/// (`packages/platform/starknet/src/rpc/stark-name.ts`) over the core's sans-IO body and judge
/// (`starkNameAddressRequest`, `starkNameJudgeAddress`). Each endpoint proves the network's chain
/// first and is never asked about a name otherwise; `tryNextEndpoint` and transport failures move
/// on; a node's own answer (found, not found, unsupported, failed) stops. With no endpoint left
/// the lookup fails closed: no address is ever taken from it.
enum StarkNameLookup {
    /// A resolved address, or the line the recipient step shows instead (`resolutionFailure`).
    enum Outcome: Equatable {
        case resolved(String)
        case refused(String)
    }

    private static let chainRequestId: UInt64 = 1
    private static let nameRequestId: UInt64 = 2

    /// The note while the read runs.
    static func resolving(_ name: String) -> String { "Resolving \(name)…" }

    /// Resolves `name` (already `starkNameNormalize`d) on `network`, endpoints in order.
    static func resolve(_ name: String, on network: NetworkInfo, via transport: RpcTransport) async -> Outcome {
        guard let body = try? starkNameAddressRequest(id: nameRequestId, network: network.network, name: name) else {
            return .refused(couldNotResolve(name))
        }
        // An endpoint on another chain is failed over like a fault; if none matches, the lookup
        // fails as an error rather than reading as an unreachable network, as the extension's.
        var sawOtherChain = false
        for url in network.rpcUrls.compactMap(URL.init(string:)) {
            guard let chain = try? await transport.post(rpcChainIdRequest(id: chainRequestId), to: url, write: false),
                  let proven = try? rpcVerifyChainId(body: chain, id: chainRequestId, network: network.network)
            else { continue }
            guard proven else {
                sawOtherChain = true
                continue
            }
            guard let reply = try? await transport.post(body, to: url, write: false) else { continue }
            switch starkNameJudgeAddress(body: reply, id: nameRequestId) {
            case let .resolved(address):
                return .resolved(address)

            case .notFound:
                return .refused("No address found for \(name).")

            case .unsupportedNetwork:
                return .refused("Starknet names are not available on this network.")

            case .failed:
                return .refused(couldNotResolve(name))

            case .tryNextEndpoint:
                continue
            }
        }
        return .refused(sawOtherChain ? couldNotResolve(name) : "Could not reach the network to resolve \(name).")
    }

    static func couldNotResolve(_ name: String) -> String { "Could not resolve \(name)." }
}

extension SendFlowModel {
    /// "Continue with address" on text that is not an address (`commitTyped`): a listed contact or
    /// account it names is taken as that row (an exact name first, else a search; more than one
    /// match commits nothing), so a name is never resolved over a row the screen shows. Otherwise a
    /// Starknet name is resolved; anything else is refused as before.
    func continueWithTyped(known: [SendRecipients.Row], networkNow: () -> NetworkId) async {
        if validateRecipient(input: recipientInput) != nil {
            continueWithRecipient(label: SendRecipients.knownLabel(of: recipientInput, in: known))
            return
        }
        let listed = SendRecipients.named(recipientInput, in: known)
        if let row = listed.first {
            if listed.count == 1 { useRecipient(row.address, label: row.name) }
            return
        }
        guard let name = starkNameNormalize(name: recipientInput) else {
            continueWithRecipient()
            return
        }
        await resolveName(name, known: known, networkNow: networkNow)
    }

    /// Resolves `name` and, if the field still spells it and the wallet is still on this network
    /// when the answer lands, takes the address under the canonical name (`choose(…, "stark-name")`).
    private func resolveName(_ name: String, known: [SendRecipients.Row], networkNow: () -> NetworkId) async {
        guard !resolvingName else { return }
        let typed = recipientInput.trimmingCharacters(in: .whitespaces)
        resolvingName = true
        recipientNote = StarkNameLookup.resolving(name)
        let outcome = await StarkNameLookup.resolve(name, on: network, via: transport)
        resolvingName = false
        // Edited since, or read for a network the wallet has left: drop it.
        guard recipientInput.trimmingCharacters(in: .whitespaces) == typed, networkNow() == network.network else {
            return
        }
        switch outcome {
        case let .resolved(address):
            // The core resolves only a nonzero felt; anything the address rules still refuse is a
            // failed lookup, never a silent stop on "Resolving…".
            guard let canonical = validateRecipient(input: address) else {
                recipientNote = StarkNameLookup.couldNotResolve(name)
                return
            }
            recipientNote = nil
            takeResolvedName(canonical, name: name, isNew: SendRecipients.knownLabel(of: canonical, in: known) == nil)

        case let .refused(line):
            recipientNote = line
        }
    }
}
