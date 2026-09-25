import BrambleCore
import CoreImage.CIFilterBuiltins
import SwiftUI

/// `receiveAddressView` (`journeys/send/receive-view.ts`): the QR card, the full address, the
/// network line, and Copy. An account with a signer key can switch the QR to its Bramble contact
/// card once the coordination key is derived, and shows the collapsed "Wallet identity". Preparing
/// or failing to prepare the card never blocks the address. A multisig passes no signer key, so it
/// has neither. Copies go through `CopyButton` (`Clipboard`, "Copied" via `store.notify`).
struct ReceiveAddressView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let address: String
    let copyLabel: String
    let hint: String
    var signerKey: String?
    @State private var payload = Payload.address
    @State private var identityOpen = false

    enum Payload: Hashable { case address, card }

    private static let cardExplainer =
        "The contact card is public: this address, the signer public key, and the coordination public key. "
        + "It holds nothing secret."

    private var coordination: CoordinationStore { store.coordination }

    /// The public card, once the coordination key is known.
    private var card: String? {
        guard let signerKey, let nostr = coordination.nostrKey else { return nil }
        return try? walletContactCardEncode(
            card: WalletContactCard(
                network: store.network,
                address: address,
                publicKeyX: signerKey,
                nostrPublicKey: nostr
            )
        )
    }

    private var offersCard: Bool { signerKey != nil && !coordination.nostrUnavailable }

    var body: some View {
        let receive = BrambleMetrics.Receive.self
        let showingCard = payload == .card && card != nil
        VStack(spacing: receive.gap) {
            QRCard(
                text: showingCard ? card ?? address : address,
                label: showingCard ? "QR code for wallet contact card" : "QR code of the address"
            )
            intro
            if offersCard {
                cardChoice
            }
            CopyButton(value: address, label: copyLabel, style: .pill(.primary))
                .accessibilityHint("Copies the address to this device's clipboard for two minutes")
            if offersCard {
                if let card {
                    CopyButton(value: card, label: "Copy wallet card", style: .pill(.secondary))
                } else {
                    PillButton("Preparing card…", kind: .secondary, icon: .copy) {
                        // No action: the card is still being prepared, and the button is disabled.
                    }
                    .disabled(true)
                }
            }
            if let signerKey { identity(signerKey) }
        }
        .task(id: signerKey) { if signerKey != nil { await coordination.loadNostrKey() } }
    }

    /// The heading, the full address, and the network and hint lines under the QR card.
    private var intro: some View {
        let receive = BrambleMetrics.Receive.self
        return VStack(spacing: receive.introGap) {
            Text("Your Starknet address")
                .brambleText(
                    BrambleTypeScale.title.sized(receive.titleSize),
                    weight: BrambleMetrics.H2.weight,
                    tracking: BrambleMetrics.H2.tracking
                )
                .accessibilityAddTraits(.isHeader)
            Text(address)
                .brambleText(
                    BrambleTypeStyle(size: BrambleTypeScale.mono.size, lineHeight: receive.introLineHeight),
                    mono: true
                )
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
                .accessibilityLabel("Address \(address)")
            Group {
                (Text("Network: ") + Text(store.networkInfo.name).fontWeight(.semibold))
                Text(hint)
            }
            .brambleText(BrambleTypeStyle(size: receive.introSize, lineHeight: receive.introLineHeight))
            .foregroundStyle(skin.muted)
            .multilineTextAlignment(.center)
        }
    }

    /// The address / contact-card switch and its explainer. The card option stays unselectable
    /// until the card exists, as `disabled` does.
    @ViewBuilder private var cardChoice: some View {
        let receive = BrambleMetrics.Receive.self
        SegmentedControl(
            options: [("Address", Payload.address), ("Bramble contact card", Payload.card)],
            selection: Binding(get: { payload }, set: { if $0 == .address || card != nil { payload = $0 } })
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("QR code contents")
        Text(Self.cardExplainer)
            .brambleText(BrambleTypeStyle(size: receive.introSize, lineHeight: receive.introLineHeight))
            .foregroundStyle(skin.muted)
            .multilineTextAlignment(.center)
    }

    /// `.receive-identity`: collapsed by default; each key shortened with `shortAddress` and
    /// copied in full.
    private func identity(_ signerKey: String) -> some View {
        Disclosure(title: "Wallet identity", summary: "Signer and coordination keys", isOpen: $identityOpen) {
            KeyValueRow(label: "Signer public key", value: signerKey, copyLabel: "Copy signer public key")
            if coordination.nostrUnavailable {
                Text("Coordination is unavailable. Share the account address instead.")
                    .brambleText(BrambleTypeScale.caption)
                    .foregroundStyle(skin.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                KeyValueRow(
                    label: "Coordination public key",
                    value: coordination.nostrKey,
                    copyLabel: "Copy coordination public key",
                    status: "Preparing secure coordination…"
                )
            }
        }
    }
}

/// `.qr-card`: pinned to white in every skin so scanners read it, with the qrCard elevation.
struct QRCard: View {
    let text: String
    var label = "QR code of the address"

    /// Pixels per QR module in the rendered image, so it scales up crisply.
    private static let moduleScale: CGFloat = 10

    var body: some View {
        let qrCard = BrambleMetrics.QRCard.self
        if let image = Self.qrCode(text) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(qrCard.padding)
                .frame(width: qrCard.receiveWidth, height: qrCard.receiveWidth)
                .background(Color.white, in: RoundedRectangle(cornerRadius: qrCard.radius, style: .continuous))
                .elevation(BrambleElevation.qrCard)
                .accessibilityLabel(label)
        }
    }

    /// A QR code with its standard four-module quiet zone, rendered at 10× for crisp scaling.
    static func qrCode(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: moduleScale, y: moduleScale)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
