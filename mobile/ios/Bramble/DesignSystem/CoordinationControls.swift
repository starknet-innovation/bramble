import SwiftUI

// Controls the Receive, contacts, and multisig screens add to the design system: the multisig
// creation stepper (`styles-multisig.ts`), the receive key rows (`styles-send.ts`), and the
// multi-line card field. Disclosures, the QR card, and copying use the shared `Disclosure`,
// `QRCard`, and `CopyButton`.

/// `.multisig-deploy-progress`: numbered steps; the active one on accent, finished ones positive.
struct StepProgress: View {
    @Environment(\.skin) private var skin
    let steps: [String]
    let active: Int

    /// Diameter of a numbered step disc.
    private static let discSize: CGFloat = 22
    /// The connector runs through the disc centres: half a disc down from the top.
    private static let connectorY: CGFloat = 11
    private static let connectorThickness: CGFloat = 1
    /// Each step takes an equal column, so the first centre sits half a column in.
    private static let halfColumn: CGFloat = 2

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, label in
                VStack(spacing: BrambleSpace.xs) {
                    Text("\(index + 1)")
                        .brambleText(BrambleTypeScale.micro, weight: BrambleWeight.semibold)
                        .foregroundStyle(discInk(index))
                        .frame(width: Self.discSize, height: Self.discSize)
                        .background(discFill(index), in: Circle())
                    Text(label)
                        .brambleText(BrambleTypeScale.micro)
                        .foregroundStyle(index == active ? skin.text : skin.muted)
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
                Rectangle()
                    .fill(skin.hairline)
                    .frame(width: geometry.size.width * (count - 1) / count, height: Self.connectorThickness)
                    .offset(x: geometry.size.width / (Self.halfColumn * count), y: Self.connectorY)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Multisig creation progress")
    }

    private func discInk(_ index: Int) -> Color {
        index == active ? skin.accentText : index < active ? skin.positive : skin.muted
    }

    private func discFill(_ index: Int) -> Color {
        index == active ? skin.accent : index < active ? skin.positiveSoft : skin.elevated
    }
}

/// `.receive-key-row`: a label, the value shortened with the shared `shortAddress`, and a
/// `CopyButton` that copies it in full (`Clipboard`, "Copied" through `store.notify`). Built on
/// the generated menu-row metrics, like Receive's signer key row.
struct KeyValueRow: View {
    @Environment(\.skin) private var skin
    let label: String
    let value: String?
    let copyLabel: String
    var status: String?

    var body: some View {
        let row = BrambleMetrics.MenuRow.self
        HStack(spacing: row.gap) {
            Text(label)
                .brambleText(BrambleTypeScale.body.sized(row.titleSize), weight: row.titleWeight)
                .foregroundStyle(skin.text)
            Spacer(minLength: row.gap)
            if let value {
                Text(shortAddress(value))
                    .brambleText(BrambleTypeScale.caption, mono: true)
                    .foregroundStyle(skin.muted)
                    .accessibilityLabel(shortAddress(value))
                CopyButton(value: value, label: copyLabel)
            } else if let status {
                Text(status)
                    .brambleText(BrambleTypeScale.caption.sized(row.valueSize))
                    .foregroundStyle(skin.muted)
                    .multilineTextAlignment(.trailing)
            }
        }
        .frame(minHeight: BrambleControl.hit)
    }
}

/// `textareaField`: `BrambleField`'s flat fill over several lines, for pasted wallet cards. No
/// edge, stroke or shadow (the flat-field rule); an invalid card takes the danger fill and ink.
struct BrambleTextArea: View {
    @Environment(\.skin) private var skin
    let label: String
    let placeholder: String
    @Binding var text: String
    var hint: String?
    var invalid = false

    /// Gap between the label, the field, and the hint.
    private static let stackSpacing: CGFloat = 6
    /// A pasted wallet card shows at least three lines and grows to six before scrolling.
    private static let visibleLines = 3...6

    var body: some View {
        VStack(alignment: .leading, spacing: Self.stackSpacing) {
            Text(label)
                .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                .foregroundStyle(skin.muted)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(skin.muted), axis: .vertical)
                .lineLimit(Self.visibleLines)
                .accessibilityLabel(label)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .brambleText(BrambleTypeScale.mono, mono: true)
                .foregroundStyle(invalid ? skin.danger : skin.text)
                .padding(BrambleMetrics.Field.padding)
                .padding(.vertical, BrambleSpace.md)
                .background(invalid ? skin.dangerSoft : skin.elevated, in: FieldShape())
            if let hint {
                Text(hint).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
        }
    }
}
