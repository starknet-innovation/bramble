import CoreImage.CIFilterBuiltins
import SwiftUI
import UniformTypeIdentifiers

/// Receive: the active account's full address and a QR code of it.
struct ReceiveView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var copied = false

    var body: some View {
        let address = store.account?.address ?? ""
        Screen(title: "Receive", subtitle: "Send only Starknet assets on \(store.networkInfo.name) to this address.") {
            Card {
                if let image = qrCode(address) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .padding(BrambleSpace.md)
                        .background(skin.accountAvatarPaper, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
                        .frame(maxWidth: .infinity)
                }
                Text(address)
                    .brambleText(BrambleTypeScale.mono, mono: true)
                    .foregroundStyle(skin.text)
                    .textSelection(.enabled)
            }
            PrimaryButton(title: copied ? "Copied" : "Copy address") {
                // Local-only, expiring pasteboard item: no Universal Clipboard hand-off.
                UIPasteboard.general.setItems(
                    [[UTType.plainText.identifier: address]],
                    options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)]
                )
                copied = true
            }
        }
        .presentationDetents([.large])
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
