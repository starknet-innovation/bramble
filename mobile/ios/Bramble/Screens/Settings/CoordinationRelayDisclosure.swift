import BrambleCore
import SwiftUI

/// "Multisig coordination relay" under Settings → Network (`settings/network-views.ts`,
/// `endpoint-ui.ts`): one custom relay replaces the reviewed defaults; empty restores them.
/// Mobile refuses `ws://`, which App Transport Security would block anyway.
struct CoordinationRelayDisclosure: View {
    @Environment(WalletStore.self) private var store
    @State private var relay = ""
    @State private var result: String?
    @State private var failed = false
    @State private var busy = false
    @State private var open = false

    /// The field's hint, the extension's copy.
    private static let relayHint = "Used across networks for encrypted intent handoffs. Every co-signer must "
        + "select the same relay. Leave empty for the reviewed defaults."

    private var policy: RelayPolicy? { store.coordination.relayPolicy }

    var body: some View {
        Disclosure(
            title: "Multisig coordination relay",
            summary: policy?.isCustom == true ? "Custom" : "Reviewed defaults",
            isOpen: $open
        ) {
            VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                BrambleField(
                    label: "Custom Nostr relay",
                    placeholder: "wss://relay.example",
                    text: $relay,
                    mono: true,
                    hint: Self.relayHint
                )
                PillButton("Save coordination relay", kind: .secondary, icon: .check, busy: busy) { save() }
                StatusLine(text: result, tone: .danger)
            }
        }
        .task {
            await store.coordination.refresh()
            if let policy, policy.isCustom { relay = policy.relayUrls.first ?? "" }
        }
    }

    private func save() {
        busy = true
        Task {
            defer { busy = false }
            do {
                store.notify(try await store.coordination.setRelay(relay))
                result = nil
                failed = false
                if policy?.isCustom != true { relay = "" }
            } catch CoreError.InvalidInput(let reason) where reason.contains("wss") {
                failed = true
                result = "Mobile connects to secure relays only (wss://)."
                store.toast = result
            } catch CoreError.InvalidInput {
                failed = true
                result = "Invalid Nostr relay endpoint"
                store.toast = result
            } catch {
                failed = true
                result = "Coordination relay update failed"
                store.toast = result
            }
        }
    }
}
