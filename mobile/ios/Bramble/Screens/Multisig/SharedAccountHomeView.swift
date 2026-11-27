import BrambleCore
import SwiftUI

/// `multisig-home` (`journeys/multisig/multisig-portfolio.ts`): the shared account's actions and
/// notes, then Tokens and Transactions. Transactions lists the open signing intents and imports
/// one; "Co-signer updates" syncs gift wraps and imports every trusted package they carry.
struct SharedAccountHomeView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openCoordinationFlow) private var open
    let id: String
    @State private var tab = Tab.tokens
    /// Raw balances by token symbol; meaningful only while `balancesAvailable` is true.
    @State private var balances: [String: String] = [:]
    /// False until a balance read succeeds (and after one fails), which shows the unavailable line.
    @State private var balancesAvailable = false
    @State private var syncResult: String?
    @State private var syncFailed = false
    @State private var syncing = false
    @State private var confirmingRemove = false
    @State private var intents: [MultisigIntent] = []
    /// False until the first read, so the empty line never shows ahead of the list.
    @State private var intentsLoaded = false

    enum Tab: Hashable { case tokens, intents }

    private enum Layout {
        static let intentsTextSpacing: CGFloat = 2
    }

    /// Fraction digits shown for each shared token balance.
    private static let balanceFractionDigits: UInt8 = 4

    private var record: MultisigRecord? { store.coordination.multisigs.first { $0.id == id } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                if let record {
                    FlowHeader(
                        title: multisigDisplayName(record),
                        subtitle: multisigConfigLabel(record),
                        network: store.networkLabel
                    ) { dismiss() }
                    actions(record)
                    SegmentedControl(
                        options: [("Tokens", Tab.tokens), (MultisigTxText.transactions, Tab.intents)],
                        selection: $tab
                    )
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Shared account sections")
                    if tab == .tokens { tokens } else { intents(record) }
                    remove(record)
                } else {
                    FlowHeader(title: "Ready multisig", network: store.networkLabel) { dismiss() }
                    Text("This Ready multisig is no longer watched.")
                        .brambleText(BrambleTypeScale.body)
                        .foregroundStyle(skin.muted)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
            .padding(.bottom, BrambleSpace.xl)
        }
        // `.task` restarts on every appear, so a signature or submission made one screen deeper
        // shows here on return, as well as on each switch to Transactions.
        .task(id: tab) { await loadIntents() }
        .task {
            if let address = record?.address {
                let fetched = try? await store.coordination.balances(of: address)
                balances = fetched ?? [:]
                balancesAvailable = fetched != nil
            }
        }
    }

    private func actions(_ record: MultisigRecord) -> some View {
        let undeployed = record.deployment != nil && !record.hasCurrentConfig
        return VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            HStack(spacing: BrambleSpace.sm) {
                if record.hasCurrentConfig, !record.localSignerAccountIds.isEmpty {
                    PillButton(MultisigTxText.send, kind: .secondary, icon: .send) { open(.propose(id: record.id)) }
                    PillButton(MultisigTxText.signers, kind: .secondary, icon: .users) { open(.signers(id: record.id)) }
                }
                if undeployed {
                    PillButton("Deploy", kind: .secondary, icon: .wallet) { open(.createMultisig(resume: record.id)) }
                }
                PillButton("Receive", kind: .secondary, icon: .qrCode) { open(.sharedReceive(id: record.id)) }
                IconButton(icon: .externalLink, label: "Open in explorer", tint: skin.muted) {
                    if let link = explorerAccountUrl(network: store.network, address: record.address),
                       let url = URL(string: link) {
                        UIApplication.shared.open(url)
                    }
                }
            }
            Group {
                if undeployed {
                    Text("Deployment required. ").bold() + Text("Continue the saved setup before sending.")
                } else if record.threshold == nil {
                    Text(Self.authorityUnverifiedMessage)
                } else if record.localSignerAccountIds.isEmpty {
                    Text(Self.watchOnlyMessage)
                } else if !record.hasCurrentConfig {
                    Text("Signer found. ").bold() + Text("Add the remaining public signer keys before sending.")
                }
            }
            .brambleText(BrambleTypeScale.caption)
            .foregroundStyle(skin.muted)
        }
    }

    private static let authorityUnverifiedMessage = "Deployment and signer authority could not be verified. "
        + "Retry when network access is restored."

    private static let watchOnlyMessage = "This wallet does not own a current signer, "
        + "so it can watch this account but cannot propose actions."

    @ViewBuilder private var tokens: some View {
        if balancesAvailable {
            MenuGroup {
                ForEach(store.networkInfo.tokens, id: \.address) { token in
                    HStack(spacing: BrambleSpace.md) {
                        TokenMark(address: token.address, symbol: token.symbol)
                        Text(token.name).brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium)
                        Spacer()
                        Text(balanceLabel(raw: balances[token.symbol], token: token))
                            .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    }
                    .padding(BrambleMetrics.MenuRow.padding)
                    .frame(minHeight: BrambleSize.row)
                }
            }
        } else {
            Text("Shared balances are unavailable right now.")
                .brambleText(BrambleTypeScale.body)
                .foregroundStyle(skin.muted)
        }
    }

    /// The formatted balance with its symbol, or a dash when the read has no usable amount.
    private func balanceLabel(raw: String?, token: TokenInfo) -> String {
        raw.flatMap { value in
            try? formatTokenAmount(raw: value, decimals: token.decimals, maxFraction: Self.balanceFractionDigits)
        }
        .map { amount in "\(amount) \(token.symbol)" } ?? "—"
    }

    private func intents(_ record: MultisigRecord) -> some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            HStack(alignment: .center, spacing: BrambleSpace.md) {
                VStack(alignment: .leading, spacing: Layout.intentsTextSpacing) {
                    Text("Co-signer updates").brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold)
                    Text("Check securely for intents and signatures shared by known contacts.")
                        .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
                Spacer(minLength: 0)
            }
            PillButton("Check for updates", kind: .secondary, icon: .refresh, busy: syncing) { sync(record) }
            StatusLine(text: syncResult, tone: syncFailed ? .danger : .muted)
            if !intents.isEmpty {
                Eyebrow(text: Self.intentsHeading(intents))
                MenuGroup {
                    ForEach(intents, id: \.id) { intent in
                        MenuRow(icon: .users, title: intent.summary, value: MultisigTxText.status(intent)) {
                            open(.intent(multisigId: record.id, intentId: intent.id))
                        }
                    }
                }
            } else if intentsLoaded {
                Text(MultisigTxText.nothingImport).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            }
            PillButton(MultisigTxText.importTransaction, kind: .ghost, icon: .chevronRight, small: true) {
                open(.importIntent(id: record.id))
            }
        }
        .padding(BrambleSpace.lg)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
    }

    private func loadIntents() async {
        guard tab == .intents else { return }
        intents = await store.coordination.intents(of: id).filter(isOpen)
        intentsLoaded = true
    }

    /// `compactIntentList`'s heading: all stale, some stale, or all awaiting.
    private static func intentsHeading(_ intents: [MultisigIntent]) -> String {
        if intents.allSatisfy({ $0.state == .stale }) { return MultisigTxText.attention }
        return intents.contains { $0.state == .stale } ? MultisigTxText.needingYou : MultisigTxText.waiting
    }

    private func sync(_ record: MultisigRecord) {
        syncing = true
        Task {
            defer { syncing = false }
            do {
                let outcome = try await store.coordination.sync(record.id)
                syncFailed = false
                syncResult = switch outcome.imported {
                case 0:
                    "No new co-signer updates"

                case 1:
                    "1 signing intent updated"

                default:
                    "\(outcome.imported) signing intents updated. Review them in Intents"
                }
                await loadIntents()
            } catch CoreError.Locked {
                syncFailed = true
                syncResult = "The wallet is locked"
            } catch CoreError.Coordination {
                syncFailed = true
                syncResult = "Secure co-signer updates are unavailable. Try again shortly"
            } catch {
                syncFailed = true
                syncResult = "Secure co-signer updates could not be verified. Try again shortly"
            }
        }
    }

    private func remove(_ record: MultisigRecord) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Text("Removing stops local tracking only. It never changes the on-chain account.")
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            PillButton("Stop watching", kind: .ghost) { confirmingRemove = true }
        }
        .padding(.top, BrambleSpace.md)
        .confirmationDialog(
            "Stop watching this shared account?",
            isPresented: $confirmingRemove,
            titleVisibility: .visible
        ) {
            Button("Stop watching", role: .destructive) {
                Task {
                    try? await store.coordination.removeShared(record.id)
                    dismiss()
                }
            }
        }
    }
}

/// `multisig-receive`: the shared address only; a multisig has no contact card or identity.
struct SharedReceiveView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let id: String

    var body: some View {
        let record = store.coordination.multisigs.first { $0.id == id }
        ScrollView {
            VStack(spacing: BrambleMetrics.Receive.gap) {
                FlowHeader(
                    title: "Receive",
                    subtitle: record.map(multisigDisplayName),
                    network: store.networkLabel
                ) { dismiss() }
                if let record {
                    ReceiveAddressView(
                        address: record.address,
                        copyLabel: "Copy address",
                        hint: "Send only Starknet assets on \(store.networkInfo.name)."
                    )
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
    }
}
