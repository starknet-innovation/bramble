import BrambleCore
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
                Text(shortAddress(value)).brambleText(BrambleTypeScale.caption, mono: true).foregroundStyle(skin.muted)
                    .accessibilityLabel(shortAddress(value))
                CopyButton(value: value, label: copyLabel)
            } else if let status {
                Text(status).brambleText(BrambleTypeScale.caption.sized(row.valueSize)).foregroundStyle(skin.muted).multilineTextAlignment(.trailing)
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
