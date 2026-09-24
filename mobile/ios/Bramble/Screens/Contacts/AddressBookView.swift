import BrambleCore
import SwiftUI

/// `address-book` (`app/screens/support-flows.ts`, `shell/dashboard-bindings.ts`): paste a wallet
/// card to fill the address and both public keys, or type them; saved contacts for this network.
/// Coordination trusts only these contacts, so the card is shown verified before it is saved.
struct AddressBookView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var walletCard = ""
    @State private var label = ""
    @State private var address = ""
    @State private var nostrPublicKey = ""
    @State private var publicKeyX = ""
    @State private var result: String?
    @State private var cardInvalid = false
    @State private var saving = false

    private var coordination: CoordinationStore { store.coordination }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(title: "Address book", subtitle: "\(coordination.contacts.count) saved", network: store.networkLabel) { dismiss() }
                form
                if coordination.contacts.isEmpty {
                    Eyebrow(text: "Saved addresses")
                    Text("No saved addresses yet. Save one to reuse it when sending.")
                        .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                } else {
                    SettingsSection(title: "Saved addresses") { ForEach(coordination.contacts, id: \.id) { row($0) } }
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
            .padding(.bottom, BrambleSpace.xl)
        }
        .task { await coordination.refresh() }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            BrambleTextArea(label: "Wallet card (optional)", placeholder: "mcw:contact:1:…", text: $walletCard,
                            hint: "Paste a shared Bramble card to fill the address, signer key, and coordination identity together.",
                            invalid: cardInvalid)
                .onChange(of: walletCard) { _, value in readCard(value) }
            BrambleField(label: "Label", placeholder: "", text: $label)
            BrambleField(label: "Address", placeholder: "0x…", text: $address, mono: true)
            BrambleField(label: "Coordination public key (optional)", placeholder: "64-character Nostr public key",
                         text: $nostrPublicKey, mono: true, hint: "Authenticates encrypted multisig intent handoffs from this contact.")
            BrambleField(label: "Signer public key (optional)", placeholder: "0x…", text: $publicKeyX, mono: true,
                         hint: "Lets this contact appear in multisig signer pickers.")
            Text("Saving an existing address updates its label.").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            PillButton("Save address", kind: .secondary, icon: .check, busy: saving) { save() }
            StatusLine(text: result, tone: cardInvalid ? .danger : .muted)
        }
    }

    private func row(_ contact: Contact) -> some View {
        let metrics = BrambleMetrics.MenuRow.self
        return HStack(alignment: .center, spacing: metrics.gap) {
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.label).brambleText(BrambleTypeScale.body.sized(metrics.titleSize), weight: metrics.titleWeight)
                Text(shortAddress(contact.address)).brambleText(BrambleTypeScale.mono, mono: true).foregroundStyle(skin.muted)
                if let key = contact.publicKeyX {
                    Text("Signer key \(shortAddress(key))").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
                if contact.nostrPublicKey != nil {
                    Text("Secure coordination ready").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
            }
            Spacer(minLength: 0)
            CopyButton(value: contact.address, label: "Copy \(contact.label)")
            IconButton(icon: .x, label: "Remove \(contact.label)", tint: skin.danger) {
                Task { try? await coordination.removeContact(contact.id) }
            }
        }
        .padding(metrics.padding)
        .padding(.vertical, BrambleSpace.sm)
        .frame(minHeight: metrics.height)
    }

    /// The extension validates the card on `change` and fills the fields from it.
    private func readCard(_ raw: String) {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            cardInvalid = false
            return
        }
        switch walletContactCardParse(text: value, network: store.network) {
        case .valid(let card):
            cardInvalid = false
            address = card.address
            publicKeyX = card.publicKeyX ?? ""
            nostrPublicKey = card.nostrPublicKey ?? ""
            result = "Wallet card verified. Add a label, then save."
        case .otherNetwork:
            cardInvalid = true
            result = "This wallet card belongs to a different network."
        case .unrecognized:
            cardInvalid = true
            result = "That wallet card is not recognized."
        }
    }

    private func save() {
        guard !cardInvalid else { return }
        let trim = { (value: String) in value.trimmingCharacters(in: .whitespacesAndNewlines) }
        saving = true
        Task {
            defer { saving = false }
            do {
                try await coordination.saveContact(label: label, address: trim(address),
                                                   publicKeyX: trim(publicKeyX).isEmpty ? nil : trim(publicKeyX),
                                                   nostrPublicKey: trim(nostrPublicKey).isEmpty ? nil : trim(nostrPublicKey))
                result = nil
                store.notify("Address saved")
                walletCard = ""
                label = ""
                address = ""
                publicKeyX = ""
                nostrPublicKey = ""
            } catch {
                result = describe(error)
                store.toast = describe(error)
            }
        }
    }
}
