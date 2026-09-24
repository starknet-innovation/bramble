import BrambleCore
import CoreImage.CIFilterBuiltins
import SwiftUI
import UniformTypeIdentifiers

// Shared controls for the Receive, contacts, and multisig screens, built from generated tokens
// only: `details.disclosure` (`styles-structure.ts`), the multisig creation stepper
// (`styles-multisig.ts`), the white `.qr-card`, and the receive key rows (`styles-send.ts`).

/// `details.disclosure`: a 52pt summary with title, supporting line, and a chevron that turns as
/// the body opens under a hairline. `flush` is the Receive card variant: transparent, top rule.
struct DisclosureRow<Content: View>: View {
    @Environment(\.skin) private var skin
    let title: String
    var subtitle: String?
    var flush = false
    @State private var open = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { open.toggle() } label: {
                HStack(spacing: BrambleSpace.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium).foregroundStyle(skin.text)
                        if let subtitle {
                            Text(subtitle).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                        }
                    }
                    Spacer(minLength: BrambleSpace.sm)
                    BrambleIcon(.chevronRight, size: 16)
                        .foregroundStyle(skin.muted)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .padding(.horizontal, flush ? 0 : BrambleSpace.lg)
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(title)
            .accessibilityHint(subtitle ?? "")
            .accessibilityAddTraits(open ? .isSelected : [])
            if open {
                VStack(alignment: .leading, spacing: BrambleSpace.md) { content() }
                    .padding(flush ? EdgeInsets(top: BrambleSpace.sm, leading: 0, bottom: 0, trailing: 0)
                        : EdgeInsets(top: BrambleSpace.md, leading: BrambleSpace.lg, bottom: BrambleSpace.lg, trailing: BrambleSpace.lg))
                    .overlay(alignment: .top) {
                        if !flush { Rectangle().fill(skin.hairline).frame(height: 1) }
                    }
            }
        }
        .background(flush ? Color.clear : skin.panel, in: RoundedRectangle(cornerRadius: flush ? 0 : BrambleRadius.lg, style: .continuous))
        .overlay(alignment: .top) {
            if flush { Rectangle().fill(skin.hairline).frame(height: 1) }
        }
        .animation(BrambleEase.out.animation(ms: BrambleMotion.tabMs), value: open)
    }
}

/// `.multisig-deploy-progress`: numbered steps; the active one on accent, finished ones positive.
struct StepProgress: View {
    @Environment(\.skin) private var skin
    let steps: [String]
    let active: Int

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, label in
                VStack(spacing: 4) {
                    Text("\(index + 1)")
                        .brambleText(BrambleTypeScale.micro, weight: BrambleWeight.semibold)
                        .foregroundStyle(index == active ? skin.accentText : index < active ? skin.positive : skin.muted)
                        .frame(width: 22, height: 22)
                        .background(index == active ? skin.accent : index < active ? skin.positiveSoft : skin.elevated, in: Circle())
                    Text(label).brambleText(BrambleTypeScale.micro).foregroundStyle(index == active ? skin.text : skin.muted)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(index == active ? .isSelected : [])
            }
        }
        .background(alignment: .top) {
            // The connector runs between the first and last step centres, behind the discs.
            GeometryReader { geometry in
                let count = CGFloat(max(steps.count, 1))
                Rectangle().fill(skin.hairline)
                    .frame(width: geometry.size.width * (count - 1) / count, height: 1)
                    .offset(x: geometry.size.width / (2 * count), y: 11)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Multisig creation progress")
    }
}

/// `.qr-card`: pinned to white in every skin so scanners read it.
struct QRCard: View {
    let text: String
    let label: String

    var body: some View {
        Group {
            if let image = Self.image(text) {
                Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
            }
        }
        .frame(width: 156, height: 156)
        .padding(BrambleSpace.lg + BrambleSpace.xs)
        .background(.white, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
        .brambleShadow(BrambleShadow.md)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isImage)
    }

    private static func image(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

/// Copies a public value (address, card, key) the way Receive always has: local-only, expiring.
enum PublicClipboard {
    static func copy(_ value: String) {
        UIPasteboard.general.setItems(
            [[UTType.plainText.identifier: value]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)]
        )
    }
}

/// `.receive-key-row`: a label, the shortened value in mono, and its copy control.
struct KeyValueRow: View {
    @Environment(\.skin) private var skin
    let label: String
    let value: String?
    let copyLabel: String
    var status: String?

    var body: some View {
        HStack(spacing: BrambleSpace.sm) {
            Text(label).brambleText(BrambleTypeScale.label, weight: BrambleWeight.bold).foregroundStyle(skin.text)
            Spacer(minLength: BrambleSpace.sm)
            if let value {
                Text(shortKey(value: value)).brambleText(BrambleTypeScale.mono, mono: true).foregroundStyle(skin.text)
                    .accessibilityLabel(shortKey(value: value))
                IconButton(icon: .copy, label: copyLabel, tint: skin.muted) { PublicClipboard.copy(value) }
            } else if let status {
                Text(status).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted).multilineTextAlignment(.trailing)
            }
        }
        .frame(minHeight: BrambleControl.hit)
    }
}

/// `textareaField`: the filled field shape over several lines, for pasted wallet cards.
struct BrambleTextArea: View {
    @Environment(\.skin) private var skin
    let label: String
    let placeholder: String
    @Binding var text: String
    var hint: String?
    var invalid = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(skin.muted), axis: .vertical)
                .lineLimit(3...6)
                .accessibilityLabel(label)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .brambleText(BrambleTypeScale.mono, mono: true)
                .foregroundStyle(skin.text)
                .padding(BrambleSpace.md)
                .background(skin.elevated, in: FieldShape())
                .overlay(alignment: .bottom) { FieldEdge(color: invalid ? skin.danger : skin.border) }
            if let hint {
                Text(hint).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
        }
    }
}
