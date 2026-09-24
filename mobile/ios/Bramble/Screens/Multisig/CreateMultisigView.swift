import BrambleCore
import SwiftUI

/// `multisig-deploy` (`journeys/multisig/multisig-deploy-view.ts`): Participants, Approval, Fund,
/// Deploy. Leaving Approval saves the undeployed setup (its commitment re-derives to the address),
/// so the flow can be closed and resumed. Deployment itself is not on mobile yet: it needs the
/// DEPLOY_ACCOUNT signature path the transactions workstream owns (docs/nostr-multisig.md §2.5).
struct CreateMultisigView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    let resumeId: String?

    @State private var stage = 0
    @State private var name = ""
    @State private var participants: [MultisigParticipant] = []
    @State private var threshold = "1"
    @State private var deployer: String?
    @State private var salt = "0x0"
    @State private var picking = false
    @State private var saved: MultisigRecord?
    @State private var declared: Bool??
    @State private var result: String?
    @State private var busy = false
    @State private var loaded = false
    @State private var advancedOpen = false

    static let steps = ["Participants", "Approval", "Fund", "Deploy"]

    private var coordination: CoordinationStore { store.coordination }
    /// This wallet's account records on the network that are in the signer set.
    private var localSigners: [AccountRecord] {
        store.records.filter { account in participants.contains { $0.publicKeyX == account.publicKey } }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                if picking {
                    ParticipantPickerView(known: knownParticipants(), select: add, close: { picking = false })
                } else {
                    FlowHeader(title: resumeId == nil ? "Create multisig" : "Complete multisig setup",
                               subtitle: "Multiple signers approve together", network: store.networkLabel) { dismiss() }
                    if declared == .some(false) {
                        Text("The pinned Ready Multisig 0.2 class is not declared on this network. Predeclare the audited class before deployment.")
                            .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                    } else {
                        StepProgress(steps: Self.steps, active: stage)
                        classStatus
                        switch stage {
                        case 0: participantsStage
                        case 1: approvalStage
                        case 2: MultisigFundStage(record: saved) { stage = 3 }
                        default: MultisigDeployStage(record: saved)
                        }
                    }
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
            .padding(.bottom, BrambleSpace.xl)
        }
        .task { await load() }
    }

    @ViewBuilder private var classStatus: some View {
        switch declared {
        case nil: StatusLine(text: "Checking the pinned class on this network…")
        case .some(nil): StatusLine(text: "Class availability could not be verified. Deployment remains disabled.", tone: .danger)
        default: EmptyView()
        }
    }

    private var participantsStage: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            if resumeId != nil {
                StatusLine(text: "Saved setup restored. Confirm the signers, then continue.")
            }
            BrambleField(label: "Shared account name (optional)", placeholder: "", text: $name)
                .onChange(of: name) { _, value in
                    let limit = Int(multisigLimits().nameLength)
                    if value.utf16.count > limit { name = String(value.prefix(limit)) }
                }
            HStack {
                Text("Signer set").brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold)
                Spacer()
                Text("\(participants.count) signer\(participants.count == 1 ? "" : "s")").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            MenuGroup { ForEach(participants) { signerRow($0) } }
            PillButton("Add participant", kind: .secondary, icon: .plus) { picking = true }
            PillButton("Continue to approval") { stage = 1 }
                .disabled(localSigners.isEmpty)
            if localSigners.isEmpty {
                StatusLine(text: "Add an account from this wallet to the signer set before continuing.")
            }
        }
    }

    private func signerRow(_ participant: MultisigParticipant) -> some View {
        HStack(spacing: BrambleSpace.sm) {
            AccountAvatarView(address: participant.address ?? participant.publicKeyX)
            VStack(alignment: .leading, spacing: 2) {
                Text(participant.label).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                Text("\(participant.source) · Key \(shortAddress(participant.publicKeyX))").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            Spacer(minLength: 0)
            CopyButton(value: participant.publicKeyX, label: "Copy \(participant.label) signer public key")
            IconButton(icon: .x, label: "Remove \(participant.label)", tint: skin.muted) {
                participants.removeAll { $0.id == participant.id }
            }
            .disabled(participants.count == 1)
        }
        .padding(.horizontal, BrambleSpace.md)
        .padding(.vertical, BrambleSpace.xs)
    }

    private var approvalStage: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            if localSigners.isEmpty {
                StatusLine(text: "No saved participant can deploy from this wallet. Go back and add a local account.", tone: .danger)
            }
            BrambleField(label: "Signatures required", placeholder: "1", text: $threshold,
                         hint: "How many signers must approve each transaction?")
            Text("Deployment signer").brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
            MenuGroup {
                ForEach(localSigners, id: \.id) { account in
                    MenuRow(icon: nil, title: account.displayName, value: account.shortAddress,
                            selected: account.id == effectiveDeployer, chevron: false) { deployer = account.id }
                }
            }
            Text("This account signs and pays for deployment.").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            Disclosure(title: "Advanced deployment settings", summary: "Default salt · 0x0", isOpen: $advancedOpen) {
                BrambleField(label: "Deployment salt", placeholder: "0x0", text: $salt, mono: true)
            }
            HStack(spacing: BrambleSpace.sm) {
                PillButton("Back", kind: .ghost) { stage = 0 }
                PillButton("Review deployment", busy: busy) { review() }
                    .disabled(declared != .some(true) || effectiveDeployer == nil)
            }
            StatusLine(text: result, tone: .danger)
        }
    }

    /// The record id that signs and pays for deployment (never an account index).
    private var effectiveDeployer: String? {
        if let deployer, localSigners.contains(where: { $0.id == deployer }) { return deployer }
        return localSigners.first?.id
    }

    private func knownParticipants() -> [MultisigParticipant] {
        let accounts = store.records.map {
            MultisigParticipant(publicKeyX: $0.publicKey, label: $0.displayName, source: "This wallet", address: $0.address)
        }
        let contacts = coordination.contacts.compactMap { contact in
            contact.publicKeyX.map { MultisigParticipant(publicKeyX: $0, label: contact.label, source: "Saved contact", address: contact.address) }
        }
        return accounts + contacts
    }

    private func add(_ participant: MultisigParticipant) -> String? {
        if participants.contains(where: { $0.publicKeyX == participant.publicKeyX }) {
            return "Each signer public key can only be added once."
        }
        if participants.count >= Int(multisigLimits().signers) {
            return "Argent multisig threshold or signer count is invalid."
        }
        participants.append(participant)
        return nil
    }

    private func review() {
        guard let count = UInt32(threshold.trimmingCharacters(in: .whitespaces)), (1...UInt32(participants.count)).contains(count) else {
            result = "Enter between 1 and \(participants.count) signatures."
            return
        }
        guard let deployer = effectiveDeployer else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                saved = try await coordination.saveSetup(name: name, signerKeys: participants.map(\.publicKeyX), threshold: count,
                                                         salt: salt.trimmingCharacters(in: .whitespaces), deployer: deployer)
                result = nil
                stage = 2
            } catch {
                result = describe(error)
            }
        }
    }

    private func load() async {
        guard !loaded else { return }
        loaded = true
        await coordination.refresh()
        if let resumeId, let record = coordination.multisigs.first(where: { $0.id == resumeId }), let deployment = record.deployment {
            let known = knownParticipants()
            participants = deployment.config.signerPublicKeys.map { key in
                known.first { $0.publicKeyX == key }
                    ?? MultisigParticipant(publicKeyX: key, label: "Signer \(shortAddress(key))", source: "Deployment setup")
            }
            name = record.name ?? ""
            threshold = String(deployment.config.threshold)
            salt = deployment.salt
            saved = record
            stage = 1
        } else if let account = store.activeRecord {
            participants = [MultisigParticipant(publicKeyX: account.publicKey, label: account.displayName,
                                                source: "This wallet", address: account.address)]
        }
        declared = .some(await coordination.classDeclared())
    }
}
