import BrambleCore
import CoreImage.CIFilterBuiltins
import SwiftUI

/// `receive` from the activity-and-assets journey: QR card, full address, network line, copy, and
/// the collapsed "Wallet identity" disclosure with the signer public key (`receive-view.ts`).
struct ReceiveView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var identityOpen = false

    var body: some View {
        let address = store.account?.address ?? ""
        let networkName = store.networkInfo.name
        let m = BrambleMetrics.Receive.self
        ScrollView {
            VStack(spacing: m.gap) {
                FlowHeader(title: "Receive", network: store.networkLabel) { dismiss() }
                QRCard(text: address)
                VStack(spacing: m.introGap) {
                    Text("Your Starknet address")
                        .brambleText(BrambleTypeScale.title.sized(m.titleSize), weight: BrambleMetrics.H2.weight, tracking: BrambleMetrics.H2.tracking)
                        .accessibilityAddTraits(.isHeader)
                    Text(address)
                        .brambleText(BrambleTypeStyle(size: BrambleTypeScale.mono.size, lineHeight: m.introLineHeight), mono: true)
                        .multilineTextAlignment(.center)
                        .textSelection(.enabled)
                        .accessibilityLabel("Address \(address)")
                    Group {
                        (Text("Network: ") + Text(networkName).fontWeight(.semibold))
                        Text("Only send \(networkName) assets to this address.")
                    }
                    .brambleText(BrambleTypeStyle(size: m.introSize, lineHeight: m.introLineHeight))
                    .foregroundStyle(skin.muted)
                    .multilineTextAlignment(.center)
                }
                // Local-only and expiring (`Clipboard`); "Copied" through `store.notify`.
                CopyButton(value: address, label: "Copy address", style: .pill(.primary))
                    .accessibilityHint("Copies the address to this device's clipboard for two minutes")
                if let publicKey = store.activeRecord?.publicKey { identity(publicKey) }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
    }
}

extension ReceiveView {
    /// `.receive-identity`: collapsed by default; the signer key truncated with `accountLabel`,
    /// copied in full. The coordination key row belongs to the Nostr workstream.
    fileprivate func identity(_ publicKey: String) -> some View {
        Disclosure(title: "Wallet identity", summary: "Signer and coordination keys", isOpen: $identityOpen) {
            HStack(spacing: BrambleMetrics.MenuRow.gap) {
                Text("Signer public key")
                    .brambleText(BrambleTypeScale.body.sized(BrambleMetrics.MenuRow.titleSize), weight: BrambleMetrics.MenuRow.titleWeight)
                Spacer(minLength: BrambleMetrics.MenuRow.gap)
                Text(shortAddress(publicKey)).brambleText(BrambleTypeScale.caption, mono: true).foregroundStyle(skin.muted)
                CopyButton(value: publicKey, label: "Copy signer public key")
            }
        }
    }
}

/// `.qr-card`: pinned to white in every skin so scanners read it, with the md elevation.
struct QRCard: View {
    let text: String

    var body: some View {
        let m = BrambleMetrics.QRCard.self
        if let image = Self.qrCode(text) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(m.padding)
                .frame(width: m.receiveWidth, height: m.receiveWidth)
                .background(Color.white, in: RoundedRectangle(cornerRadius: m.radius, style: .continuous))
                .elevation(BrambleElevation.qrCard)
                .accessibilityLabel("QR code of the address")
        }
    }

    /// A QR code with its standard four-module quiet zone, rendered at 10× for crisp scaling.
    static func qrCode(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
