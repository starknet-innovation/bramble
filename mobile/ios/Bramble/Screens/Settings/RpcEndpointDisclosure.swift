import BrambleCore
import SwiftUI

/// "RPC endpoint" under Settings → Network (the extension's `advancedNetworkFlow` `#rpc-form`,
/// bound in `endpoint-ui.ts`): one custom endpoint for the selected network, tried before the
/// bundled ones (`endpointNetwork`). The core trims it, clears it when empty, and refuses anything
/// but a plain `https` URL; its refusal is shown as it words it. Never log the field: the URL may
/// carry an API key.
struct RpcEndpointDisclosure: View {
    /// The extension's "What an endpoint can learn" help, under the field.
    static let hint = "Each service sees the requests sent to it. Use only ones you trust. "
        + "Clear a field to restore the default."
    /// `bindEndpointForm`'s fallback when the save fails for any other reason.
    static let failed = "RPC endpoint update failed"

    @Environment(WalletStore.self) private var store
    @State private var url = ""
    @State private var custom = false
    @State private var result: String?
    @State private var busy = false
    @State private var open = false

    var body: some View {
        Disclosure(title: "RPC endpoint", summary: custom ? "Custom" : "Default", isOpen: $open) {
            VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                BrambleField(
                    label: "Custom endpoint for \(store.networkInfo.name)",
                    placeholder: "https://…",
                    text: $url,
                    mono: true,
                    invalid: result != nil,
                    hint: Self.hint
                )
                PillButton("Save endpoint", kind: .secondary, icon: .check, busy: busy) { save() }
                StatusLine(text: result, tone: .danger)
            }
        }
        .task(id: store.network) { load() }
    }

    private func load() {
        url = (try? store.core.rpcOverride(network: store.network)) ?? ""
        custom = !url.isEmpty
        result = nil
    }

    private func save() {
        busy = true
        let network = store.network, typed = url
        Task {
            defer { busy = false }
            do {
                let saved = try await store.saveRpcOverride(typed, for: network)
                store.notify(saved == nil ? "RPC endpoint reset" : "RPC endpoint saved")
                url = saved ?? ""
                custom = saved != nil
                result = nil
            } catch {
                result = Self.refusal(error)
                store.toast = result
            }
        }
    }

    /// The core's refusal in its own words (`describe`), else the extension's fallback line.
    static func refusal(_ error: Error) -> String {
        if case CoreError.InvalidInput = error { return describe(error) }
        return failed
    }
}
