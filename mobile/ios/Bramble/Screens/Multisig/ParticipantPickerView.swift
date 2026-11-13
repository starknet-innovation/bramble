import BrambleCore
import SwiftUI

/// One public signer identity chosen for a multisig (`MultisigParticipant`).
struct MultisigParticipant: Hashable, Identifiable {
    let publicKeyX: String
    let label: String
    let source: String
    var address: String?
    var id: String { publicKeyX }
}

/// `multisigParticipantScreen` (`journeys/multisig/multisig-participant.ts`): known participants
/// from this wallet and the address book, a shared public key, or a full wallet card, which is
/// also saved as a contact so its coordination key is trusted. "Address" (look up a key on
/// chain) needs signer discovery from events, which is deferred, so it is not offered.
struct ParticipantPickerView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let known: [MultisigParticipant]
    /// Returns an error message when the participant cannot be added.
    let select: (MultisigParticipant) -> String?
    let close: () -> Void
    @State private var method = Method.publicKey
    @State private var publicKey = ""
    @State private var name = ""
    @State private var card = ""
    @State private var result: String?
    @State private var busy = false
    @State private var knownOpen = false

    enum Method: Hashable { case publicKey, walletCard }

    private enum Layout {
        static let headingTextSpacing: CGFloat = 2
    }

    /// The longest participant name a wallet card may be saved under, in characters.
    private static let maxNameLength = 64

    private static let walletCardHint = "Adds their Starknet address, signer key, "
        + "and secure coordination key to Address book."

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            header
            if !known.isEmpty {
                knownParticipants
            }
            Text(known.isEmpty ? "Participant details" : "Add someone else")
                .brambleText(BrambleTypeScale.title, weight: BrambleWeight.bold)
            SegmentedControl(
                options: [("Public key", Method.publicKey), ("Wallet card", Method.walletCard)],
                selection: $method
            )
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Participant detail type")
            .onChange(of: method) { _, _ in result = nil }
            methodFields
            StatusLine(text: result, tone: .danger)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: BrambleSpace.sm) {
            IconButton(icon: .chevronLeft, label: "Back to signer setup", tint: skin.muted, action: close)
            VStack(alignment: .leading, spacing: Layout.headingTextSpacing) {
                Text("Add participant").brambleText(
                    BrambleTypeScale.title.sized(BrambleMetrics.H2.size),
                    weight: BrambleMetrics.H2.weight,
                    tracking: BrambleMetrics.H2.tracking
                )
                Text("Use an account address, public key, or full wallet card.")
                    .brambleText(BrambleTypeScale.caption)
                    .foregroundStyle(skin.muted)
            }
        }
    }

    private var knownParticipants: some View {
        Disclosure(
            title: "Choose known participant",
            summary: "\(known.count) from this wallet and Address book",
            isOpen: $knownOpen
        ) {
            ForEach(known) { option in
                Button { finish(option) } label: { knownRow(option) }.buttonStyle(.plain)
                    .accessibilityLabel(option.label)
            }
        }
    }

    @ViewBuilder private var methodFields: some View {
        switch method {
        case .publicKey:
            BrambleField(
                label: "Participant public key",
                placeholder: "0x…",
                text: $publicKey,
                mono: true,
                hint: "Use a key shared by the participant."
            )
            PillButton("Add public key") { addPublicKey() }

        case .walletCard:
            BrambleField(label: "Participant name", placeholder: "e.g. Adrien", text: $name)
            BrambleTextArea(
                label: "Shared wallet card",
                placeholder: "mcw:contact:1:…",
                text: $card,
                hint: Self.walletCardHint
            )
            PillButton("Add participant", busy: busy) { addCard() }
        }
    }

    private func knownRow(_ option: MultisigParticipant) -> some View {
        HStack(spacing: BrambleSpace.sm) {
            AccountAvatarView(address: option.address ?? option.publicKeyX)
            VStack(alignment: .leading, spacing: Layout.headingTextSpacing) {
                Text(option.label)
                    .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    .foregroundStyle(skin.text)
                if let address = option.address {
                    Text(shortAddress(address))
                        .brambleText(BrambleTypeScale.mono, mono: true)
                        .foregroundStyle(skin.muted)
                }
                Text("\(option.source) · Key \(shortAddress(option.publicKeyX))")
                    .brambleText(BrambleTypeScale.caption)
                    .foregroundStyle(skin.muted)
            }
            Spacer(minLength: 0)
            BrambleIcon(.plus).foregroundStyle(skin.muted)
        }
        .frame(minHeight: BrambleSize.row)
    }

    private func finish(_ participant: MultisigParticipant) {
        if let error = select(participant) {
            result = error
            return
        }
        close()
    }

    private func addPublicKey() {
        let key = publicKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let config = ArgentMultisigConfig(threshold: 1, signerPublicKeys: [key])
        guard let canonical = try? argentMultisigNormalize(config: config).signerPublicKeys.first else {
            result = "Enter a valid non-zero Starknet public key."
            return
        }
        finish(
            MultisigParticipant(
                publicKeyX: canonical,
                label: "Signer \(shortAddress(canonical))",
                source: "Shared public key"
            )
        )
    }

    private func addCard() {
        let label = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let parsed = walletContactCardParse(
            text: card.trimmingCharacters(in: .whitespacesAndNewlines),
            network: store.network
        )
        guard case .valid(let contact) = parsed else {
            if case .otherNetwork = parsed {
                result = "That wallet card belongs to a different network."
            } else {
                result = "Paste a valid Bramble card."
            }
            return
        }
        guard let key = contact.publicKeyX, let nostr = contact.nostrPublicKey else {
            result = "Ask the participant to share a full wallet card with signer and coordination keys."
            return
        }
        guard (1...Self.maxNameLength).contains(label.count) else {
            result = "Enter a participant name between 1 and 64 characters."
            return
        }
        let participant = MultisigParticipant(
            publicKeyX: key,
            label: label,
            source: "Wallet card",
            address: contact.address
        )
        if let error = select(participant) {
            result = error
            return
        }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await store.coordination.saveContact(
                    label: label,
                    address: contact.address,
                    publicKeyX: key,
                    nostrPublicKey: nostr
                )
                close()
            } catch {
                result = describe(error)
            }
        }
    }
}
