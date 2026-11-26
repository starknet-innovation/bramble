import BrambleCore
import SwiftUI

/// One frozen signing intent (`intentCard` in `multisig-views.ts`): the core's summary, each call's
/// summary, the risk panel, its signatures and maximum fee, the exact calls, and the one action its
/// state allows. Every refusal is the core's; a stale or already-sent intent is never signed or
/// sent again here, and one whose signers no longer match the chain is neither signed nor sent.
struct MultisigIntentView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let multisigId: String
    let intentId: String
    @State private var intent: MultisigIntent?
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(
                    title: "Reviewed transaction",
                    subtitle: store.coordination.multisigs.first { $0.id == multisigId }.map(multisigDisplayName),
                    network: store.networkLabel
                ) { dismiss() }
                if let intent {
                    IntentCard(intent: intent) { self.intent = $0 }
                } else if loaded {
                    EmptyState(message: MultisigTxText.gone)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
            .padding(.bottom, BrambleSpace.xl)
        }
        .task {
            intent = await store.coordination.intents(of: multisigId).first { $0.id == intentId }
            loaded = true
        }
    }
}

/// The intent's card, reused in place by the composer and the import once they produce one.
struct IntentCard: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let intent: MultisigIntent
    let changed: (MultisigIntent) -> Void
    @State private var signer: String?
    @State private var busy = false
    @State private var result: String?
    @State private var failed = false
    @State private var technical = false
    /// The core's review, read when the card shows and again whenever the intent changes.
    @State private var review: MultisigIntentReview?
    @State private var reviewed = false

    var body: some View {
        let available = store.coordination.availableSigners(for: intent)
        let (action, note) = MultisigTxText.action(
            intent,
            canSign: !available.isEmpty,
            holdsSigner: store.coordination.holdsSigner(for: intent),
            signers: reviewed ? SignerCheck(review) : .reading
        )
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                Text(intent.summary).brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold)
                if intent.state == .stale {
                    Text("Out of date").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.danger)
                }
                ForEach(Array((review?.calls ?? []).enumerated()), id: \.offset) { _, call in
                    Text(call.summary).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
                facts
            }
            .padding(BrambleSpace.lg)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
            if reviewed, isOpen(intent) {
                SendRisksPanel(messages: MultisigTxText.risks(review))
            }
            if let hash = intent.broadcastTransactionHash {
                KeyValueRow(label: MultisigTxText.submittedKicker, value: hash, copyLabel: MultisigTxText.copyHash)
            }
            if let note {
                Text(note).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            if action == .sign, available.count > 1 {
                Eyebrow(text: MultisigTxText.signerSelect)
                MenuGroup {
                    ForEach(available, id: \.id) { account in
                        MenuRow(icon: .user, title: account.displayName, selected: chosen(available) == account.id) {
                            signer = account.id
                        }
                    }
                }
            }
            controls(action, available: available)
            StatusLine(text: result, tone: failed ? .danger : .positive)
            Disclosure(title: MultisigTxText.technical, isOpen: $technical) { calls }
        }
        .task(id: intent) {
            reviewed = false
            let read = await store.coordination.review(intent)
            // A newer intent cancelled this read; its own task lands instead.
            guard !Task.isCancelled else { return }
            review = read
            reviewed = true
        }
    }

    private var facts: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            fact(MultisigTxText.signatures, MultisigTxText.signatureCount(intent))
            if let fee = intent.maxFee { fact(MultisigTxText.maxFee, fee.display) }
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            Spacer()
            Text(value).brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func controls(_ action: IntentAction, available: [AccountRecord]) -> some View {
        switch action {
        case .sign:
            PillButton(MultisigTxText.sign, busy: busy) { sign(chosen(available)) }

        case .submit:
            PillButton(MultisigTxText.submit, busy: busy) { submit() }

        case .retryUnchangedFee:
            PillButton(MultisigTxText.tryUnchangedFee, kind: .secondary, busy: busy) { submit() }

        case .copyPackage, .nothing:
            EmptyView()
        }
        if [.collecting, .ready].contains(intent.state) {
            CopyButton(
                value: intent.package,
                label: MultisigTxText.copyPackage,
                style: .pill(action == .copyPackage ? .primary : .secondary)
            )
        }
    }

    private var calls: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            KeyValueRow(label: MultisigTxText.hash, value: intent.transactionHash, copyLabel: MultisigTxText.copyHash)
            KeyValueRow(
                label: MultisigCopy.technicalSender,
                value: intent.sender,
                copyLabel: MultisigCopy.technicalCopySender
            )
            KeyValueRow(label: MultisigTxText.nonce, value: nil, copyLabel: "", status: intent.nonce)
            ForEach(Array(intent.calls.enumerated()), id: \.offset) { index, call in
                VStack(alignment: .leading, spacing: BrambleSpace.xs) {
                    Text("Call \(index + 1) · \(call.entrypoint)")
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    Text("Contract · \(call.contractAddress)").brambleText(BrambleTypeScale.caption, mono: true)
                    Text("Calldata · \(call.calldata.isEmpty ? "none" : call.calldata.joined(separator: " "))")
                        .brambleText(BrambleTypeScale.caption, mono: true)
                }
                .foregroundStyle(skin.text)
                .textSelection(.enabled)
            }
        }
    }

    private func chosen(_ available: [AccountRecord]) -> String? {
        signer.flatMap { id in available.first { $0.id == id }?.id } ?? available.first?.id
    }

    private func sign(_ accountId: String?) {
        guard let accountId else { return }
        run {
            let signed = try await store.coordination.sign(intent, with: accountId)
            changed(signed)
            return MultisigTxText.signed(signed)
        }
    }

    private func submit() {
        run {
            let hash = try await store.coordination.submit(intent)
            await reload()
            return MultisigTxText.submitted(hash)
        }
    }

    private func reload() async {
        let id = intent.id
        if let next = await store.coordination.intents(of: intent.multisigId).first(where: { $0.id == id }) {
            changed(next)
        }
    }

    /// Runs one action; a refusal may have marked the intent stale, so it is reread either way.
    private func run(_ body: @escaping () async throws -> String) {
        busy = true
        Task {
            defer { busy = false }
            do {
                result = try await body()
                failed = false
            } catch {
                result = (error as? MultisigTxError)?.errorDescription ?? describeRefusal(error)
                failed = true
                await reload()
            }
        }
    }
}
