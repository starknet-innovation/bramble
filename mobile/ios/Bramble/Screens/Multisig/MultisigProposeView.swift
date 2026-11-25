import BrambleCore
import SwiftUI

/// What a proposal form hands its controls: whether a proposal is running, and how to start one.
/// A request the core refused as `ResendUnconfirmed` is armed: pressing its control again sends it
/// with the person's confirmation, as the extension's `armResendConfirmation`.
struct ProposalControl {
    let busy: Bool
    let armed: MultisigProposalRequest?
    let propose: (MultisigProposalRequest) -> Void

    /// The control's label: "Send anyway" once its request is armed.
    func label(_ idle: String, for request: MultisigProposalRequest?) -> String {
        request != nil && request == armed ? MultisigTxText.sendAnyway : idle
    }
}

/// The frame every multisig proposal shares (`prepareIntent`): the form, then, once the core has
/// frozen and stored the intent, its card in place of the form.
struct ProposalScreen<Form: View>: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let title: String
    let multisigId: String
    /// The success toast (`multisig.propose.ready` or `multisig.signers.changeReady`).
    let readyToast: String
    @ViewBuilder let form: (MultisigRecord, ProposalControl) -> Form
    @State private var busy = false
    @State private var armed: MultisigProposalRequest?
    @State private var error: String?
    @State private var intent: MultisigIntent?

    private var record: MultisigRecord? { store.coordination.multisigs.first { $0.id == multisigId } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(title: title, subtitle: record.map(multisigDisplayName), network: store.networkLabel) {
                    dismiss()
                }
                if let intent {
                    IntentCard(intent: intent) { self.intent = $0 }
                } else if let record {
                    form(record, ProposalControl(busy: busy, armed: armed) { propose($0, from: record) })
                    StatusLine(text: error, tone: .danger)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
            .padding(.bottom, BrambleSpace.xl)
        }
    }

    private func propose(_ request: MultisigProposalRequest, from record: MultisigRecord) {
        let confirmed = armed == request
        busy = true
        Task {
            defer { busy = false }
            do {
                intent = try await store.coordination.propose(request, from: record, confirmResend: confirmed)
                store.notify(readyToast)
            } catch let failure as MultisigTxError {
                armed = failure.failure == .resendUnconfirmed ? request : nil
                error = failure.errorDescription
            } catch {
                armed = nil
                self.error = describeRefusal(error)
            }
        }
    }
}

/// `multisig-propose` (`multisig-propose-view.ts`): an ERC-20 transfer from the multisig, built
/// and reviewed by the core over the person's tracked tokens.
struct MultisigProposeView: View {
    @Environment(WalletStore.self) private var store
    let multisigId: String
    @State private var tokenId: String?
    @State private var recipient = ""
    @State private var amount = ""

    var body: some View {
        ProposalScreen(
            title: MultisigTxText.newTransaction,
            multisigId: multisigId,
            readyToast: MultisigTxText.ready
        ) { _, control in
            let tokens = store.portfolio.tracked.map(\.token)
            let selected = tokenId ?? tokens.first?.id
            let request = selected.map { token in
                MultisigProposalRequest.transfer(tokenId: token, recipient: recipient, amount: amount)
            }
            if tokens.isEmpty {
                EmptyState(message: MultisigTxText.noTokens)
            } else {
                Eyebrow(text: MultisigTxText.token)
                MenuGroup {
                    ForEach(tokens, id: \.id) { token in
                        MenuRow(icon: nil, title: token.symbol, selected: token.id == selected) { tokenId = token.id }
                    }
                }
            }
            BrambleField(label: MultisigTxText.recipient, placeholder: "0x…", text: $recipient, mono: true)
            BrambleField(label: MultisigTxText.amountToSend, placeholder: "0", text: $amount, mono: true)
            PillButton(
                control.label(MultisigTxText.reviewTransaction, for: request),
                icon: .send,
                busy: control.busy
            ) {
                if let request { control.propose(request) }
            }
            .disabled(request == nil || recipient.isEmpty || amount.isEmpty)
        }
    }
}

/// `multisig-signers` (`multisig-management-views.ts`): the current signers, then adding a
/// signer, removing one, or changing the approvals required. Each is proposed as the core's
/// self-call (`argentMultisigConfigChangeCall`) and collects signatures like any transaction.
struct MultisigSignersView: View {
    @Environment(\.skin) private var skin
    let multisigId: String
    @State private var newKey = ""
    @State private var addThreshold = ""
    @State private var removing: String?
    @State private var removeThreshold = ""
    @State private var threshold = ""

    var body: some View {
        ProposalScreen(
            title: MultisigTxText.signers,
            multisigId: multisigId,
            readyToast: MultisigTxText.changeReady
        ) { record, control in
            let keys = record.signerPublicKeys
            let add = UInt32(addThreshold).map { after in
                Self.change(.addSigners(signerPublicKeys: [newKey], threshold: after))
            }
            let remove = removing.flatMap { key in
                UInt32(removeThreshold).map { after in
                    Self.change(.removeSigners(signerPublicKeys: [key], threshold: after))
                }
            }
            let change = UInt32(threshold).map { after in Self.change(.changeThreshold(threshold: after)) }
            if let current = record.threshold {
                Text("Currently \(current) of \(keys.count)")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            Eyebrow(text: MultisigTxText.current)
            MenuGroup {
                ForEach(keys, id: \.self) { key in
                    MenuRow(icon: .keyRound, title: shortAddress(key), selected: removing == key) {
                        removing = removing == key ? nil : key
                    }
                    .accessibilityLabel("Signer key \(shortAddress(key))")
                }
            }
            section(MultisigTxText.addParticipant) {
                BrambleField(label: MultisigTxText.enterKey, placeholder: "0x…", text: $newKey, mono: true)
                BrambleField(label: MultisigTxText.approvalsAfterAdding, placeholder: "", text: $addThreshold)
                button(MultisigTxText.reviewAddition, add, control).disabled(add == nil || newKey.isEmpty)
            }
            if removing != nil {
                section(MultisigTxText.reviewRemoval) {
                    BrambleField(label: MultisigTxText.approvalsAfterRemoval, placeholder: "", text: $removeThreshold)
                    button(MultisigTxText.reviewRemoval, remove, control).disabled(remove == nil)
                }
            }
            section("Change approvals required") {
                BrambleField(label: MultisigTxText.newThreshold, placeholder: "", text: $threshold)
                button(MultisigTxText.reviewThreshold, change, control).disabled(change == nil)
            }
        }
    }

    private static func change(_ change: ConfigChange) -> MultisigProposalRequest { .changeSigners(change: change) }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Eyebrow(text: title)
            content()
        }
        .padding(.top, BrambleSpace.md)
    }

    private func button(
        _ title: String,
        _ request: MultisigProposalRequest?,
        _ control: ProposalControl
    ) -> some View {
        PillButton(control.label(title, for: request), kind: .secondary, busy: control.busy) {
            if let request { control.propose(request) }
        }
    }
}

/// `multisig-track`: verify and import a co-signer's full package for this multisig.
struct MultisigImportView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let multisigId: String
    @State private var package = ""
    @State private var busy = false
    @State private var error: String?
    @State private var intent: MultisigIntent?

    private var record: MultisigRecord? { store.coordination.multisigs.first { $0.id == multisigId } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(
                    title: MultisigTxText.importTransaction,
                    subtitle: record.map(multisigDisplayName),
                    network: store.networkLabel
                ) { dismiss() }
                if let intent {
                    IntentCard(intent: intent) { self.intent = $0 }
                } else if let record {
                    BrambleTextArea(
                        label: MultisigTxText.intentPackage,
                        placeholder: "",
                        text: $package,
                        hint: MultisigTxText.importNote
                    )
                    PillButton(MultisigTxText.verifyImport, busy: busy) { verify(into: record) }
                        .disabled(package.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    StatusLine(text: error, tone: .danger)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
            .padding(.bottom, BrambleSpace.xl)
        }
    }

    private func verify(into record: MultisigRecord) {
        busy = true
        Task {
            defer { busy = false }
            do {
                intent = try await store.coordination.importIntent(package, into: record)
                error = nil
                store.notify(MultisigTxText.verified)
            } catch {
                self.error = describeRefusal(error)
            }
        }
    }
}
