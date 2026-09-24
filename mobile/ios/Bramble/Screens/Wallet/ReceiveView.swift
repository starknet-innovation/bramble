import SwiftUI

/// `receive` from the activity-and-assets journey (`app/screens/flows.ts`): the active account's
/// address, and its Bramble contact card and wallet identity (`ReceiveAddressView`).
struct ReceiveView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: BrambleSpace.md) {
                FlowHeader(title: "Receive", network: store.networkLabel) { dismiss() }
                if let account = store.account {
                    ReceiveAddressView(
                        address: account.address,
                        copyLabel: "Copy address",
                        hint: "Only send \(store.networkInfo.name) assets to this address.",
                        signerKey: account.publicKey
                    )
                }
            }
            .padding(.horizontal, BrambleSpace.lg)
        }
    }
}
