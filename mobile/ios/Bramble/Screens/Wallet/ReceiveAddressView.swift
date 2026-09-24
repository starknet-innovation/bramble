import BrambleCore
import SwiftUI

/// `receiveAddressView` (`journeys/send/receive-view.ts`): the address QR, the full address, and
/// Copy. An account with a signer key can switch the QR to its Bramble contact card once the
/// coordination key is derived, and shows its "Wallet identity". Preparing or failing to prepare
/// the card never blocks the address. A multisig passes no signer key, so it has neither.
struct ReceiveAddressView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let address: String
    let copyLabel: String
    let hint: String
    var signerKey: String?
    @State private var payload = Payload.address
    @State private var copied: String?

    enum Payload: Hashable { case address, card }

    private static let cardExplainer =
        "The contact card is public: this address, the signer public key, and the coordination public key. It holds nothing secret."

    private var coordination: CoordinationStore { store.coordination }

    /// The public card, once the coordination key is known.
    private var card: String? {
        guard let signerKey, let nostr = coordination.nostrKey else { return nil }
        return try? walletContactCardEncode(card: WalletContactCard(
            network: store.network, address: address, publicKeyX: signerKey, nostrPublicKey: nostr))
    }

    var body: some View {
        let showingCard = payload == .card && card != nil
        VStack(spacing: BrambleSpace.md) {
            QRCard(text: showingCard ? card ?? address : address,
                   label: showingCard ? "QR code for wallet contact card" : "QR code for your Starknet address")
                .padding(.vertical, BrambleSpace.sm)
            Text("Your Starknet address").brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
            Text(address)
                .brambleText(BrambleTypeScale.body, mono: true)
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
            (Text("Network: ").foregroundStyle(skin.muted) + Text(store.networkInfo.name).fontWeight(.semibold).foregroundStyle(skin.muted))
                .brambleText(BrambleTypeScale.label)
            Text(hint).brambleText(BrambleTypeScale.label).foregroundStyle(skin.muted).multilineTextAlignment(.center)
            if signerKey != nil && !coordination.nostrUnavailable {
                // The card option stays unselectable until the card exists, as `disabled` does.
                SegmentedControl(options: [("Address", Payload.address), ("Bramble contact card", Payload.card)],
                                 selection: Binding(get: { payload }, set: { if $0 == .address || card != nil { payload = $0 } }))
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("QR code contents")
                Text(Self.cardExplainer).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted).multilineTextAlignment(.center)
            }
            HStack(spacing: BrambleSpace.sm) {
                PillButton(copied == address ? "Copied" : copyLabel, icon: .copy) { copy(address) }
                if signerKey != nil && !coordination.nostrUnavailable {
                    PillButton(card == nil ? "Preparing card…" : copied == card ? "Copied" : "Copy wallet card", kind: .secondary, icon: .copy) {
                        if let card { copy(card) }
                    }
                    .disabled(card == nil)
                }
            }
            .padding(.top, BrambleSpace.sm)
            if let signerKey { identity(signerKey) }
        }
        .task(id: signerKey) { if signerKey != nil { await coordination.loadNostrKey() } }
    }

    @ViewBuilder
    private func identity(_ signerKey: String) -> some View {
        DisclosureRow(title: "Wallet identity", subtitle: "Signer and coordination keys", flush: true) {
            KeyValueRow(label: "Signer public key", value: signerKey, copyLabel: "Copy signer public key")
            Rectangle().fill(skin.hairline).frame(height: 1)
            if coordination.nostrUnavailable {
                Text("Coordination is unavailable. Share the account address instead.")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                KeyValueRow(label: "Coordination public key", value: coordination.nostrKey,
                            copyLabel: "Copy coordination public key", status: "Preparing secure coordination…")
            }
        }
    }

    private func copy(_ value: String) {
        PublicClipboard.copy(value)
        copied = value
    }
}
