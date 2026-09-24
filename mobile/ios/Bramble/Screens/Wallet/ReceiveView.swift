import CoreImage.CIFilterBuiltins
import SwiftUI
import UniformTypeIdentifiers

/// `receive` from the activity-and-assets journey: QR card, full address, network line, copy.
struct ReceiveView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

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
                PillButton(copied ? "Copied" : "Copy address", icon: .copy) {
                    // Local-only and expiring: no Universal Clipboard hand-off.
                    UIPasteboard.general.setItems(
                        [[UTType.plainText.identifier: address]],
                        options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)]
                    )
                    copied = true
                }
                .padding(.top, BrambleSpace.sm)
            }
            .padding(.horizontal, BrambleSpace.lg)
        }
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
