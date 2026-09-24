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
        ScrollView {
            VStack(spacing: BrambleSpace.md) {
                FlowHeader(title: "Receive", network: store.networkLabel) { dismiss() }
                if let image = qrCode(address) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 156, height: 156)
                        .padding(BrambleSpace.lg + BrambleSpace.xs)
                        // `.qr-card` pins the card to white in every skin so scanners read it.
                        .background(.white, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
                        .brambleShadow(BrambleShadow.md)
                        .padding(.vertical, BrambleSpace.sm)
                }
                Text("Your Starknet address").brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                Text(address)
                    .brambleText(BrambleTypeScale.body, mono: true)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                (Text("Network: ").foregroundStyle(skin.muted) + Text(networkName).fontWeight(.semibold).foregroundStyle(skin.muted))
                    .brambleText(BrambleTypeScale.label)
                Text("Only send \(networkName) assets to this address.")
                    .brambleText(BrambleTypeScale.label).foregroundStyle(skin.muted).multilineTextAlignment(.center)
                // Local-only and expiring (Clipboard): no Universal Clipboard hand-off.
                CopyButton(value: address, label: "Copy address", style: .pill(.primary))
                    .padding(.top, BrambleSpace.sm)
                if let publicKey = store.activeRecord?.publicKey { identity(publicKey) }
            }
            .padding(.horizontal, BrambleSpace.lg)
        }
    }

    /// `.receive-identity`: collapsed by default; the signer key truncated, copied in full. The
    /// coordination key row belongs to the Nostr workstream and is not shown here.
    private func identity(_ publicKey: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { identityOpen.toggle() } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Wallet identity").brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
                        Text("Signer and coordination keys").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    }
                    Spacer()
                    BrambleIcon(identityOpen ? .chevronDown : .chevronRight).foregroundStyle(skin.muted)
                }
                .padding(.horizontal, BrambleSpace.lg)
                .frame(minHeight: 56)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Wallet identity")
            .accessibilityValue(identityOpen ? "Expanded" : "Collapsed")
            if identityOpen {
                HStack {
                    Text("Signer public key").brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    Spacer()
                    Text(accountLabel(address: publicKey)).brambleText(BrambleTypeScale.label, mono: true).foregroundStyle(skin.muted)
                    CopyButton(value: publicKey, label: "Copy signer public key")
                }
                .padding(.leading, BrambleSpace.lg)
                .padding(.trailing, BrambleSpace.sm)
            }
        }
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
        .padding(.top, BrambleSpace.sm)
    }

    private func qrCode(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
