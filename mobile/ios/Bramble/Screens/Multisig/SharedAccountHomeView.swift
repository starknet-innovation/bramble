import BrambleCore
import SwiftUI

/// `multisig-home` (`journeys/multisig/multisig-portfolio.ts`): the shared account's actions and
/// notes, then Tokens and Intents. Intents holds "Co-signer updates": a coordination sync that
/// authenticates gift wraps and reports trusted packages, which are held until intent import
/// lands (docs/nostr-multisig.md §1). Send, Signers, and signing are not on mobile yet.
struct SharedAccountHomeView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openCoordinationFlow) private var open
    let id: String
    @State private var tab = Tab.tokens
    @State private var balances: [String: String]?
    @State private var syncResult: String?
    @State private var syncFailed = false
    @State private var syncing = false
    @State private var confirmingRemove = false

    enum Tab: Hashable { case tokens, intents }

    private var record: MultisigRecord? { store.coordination.multisigs.first { $0.id == id } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                if let record {
                    FlowHeader(title: multisigDisplayName(record), subtitle: multisigConfigLabel(record), network: store.networkLabel) { dismiss() }
                    actions(record)
                    SegmentedControl(options: [("Tokens", Tab.tokens), ("Intents", Tab.intents)], selection: $tab)
                        .accessibilityElement(children: .contain)
                    .accessibilityLabel("Shared account sections")
                    if tab == .tokens { tokens } else { intents(record) }
                    remove(record)
                } else {
                    FlowHeader(title: "Ready multisig", network: store.networkLabel) { dismiss() }
                    Text("This Ready multisig is no longer watched.").brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
            .padding(.bottom, BrambleSpace.xl)
        }
        .task {
            if let address = record?.address { balances = await store.coordination.balances(of: address) }
        }
    }

    private func actions(_ record: MultisigRecord) -> some View {
        let undeployed = record.deployment != nil && !record.hasCurrentConfig
        return VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            HStack(spacing: BrambleSpace.sm) {
                if undeployed {
                    PillButton("Deploy", kind: .secondary, icon: .wallet) { open(.createMultisig(resume: record.id)) }
                }
                PillButton("Receive", kind: .secondary, icon: .qrCode) { open(.sharedReceive(id: record.id)) }
                IconButton(icon: .externalLink, label: "Open in explorer", tint: skin.muted) {
                    if let link = explorerAccountUrl(network: store.network, address: record.address), let url = URL(string: link) {
                        UIApplication.shared.open(url)
                    }
                }
            }
            Group {
                if undeployed {
                    Text("Deployment required. ").bold() + Text("Continue the saved setup before sending.")
                } else if record.threshold == nil {
                    Text("Deployment and signer authority could not be verified. Retry when network access is restored.")
                } else if record.localSignerAccountIds.isEmpty {
                    Text("This wallet does not own a current signer, so it can watch this account but cannot propose actions.")
                } else if !record.hasCurrentConfig {
                    Text("Signer found. ").bold() + Text("Add the remaining public signer keys before sending.")
                }
            }
            .brambleText(BrambleTypeScale.caption)
            .foregroundStyle(skin.muted)
        }
    }

    @ViewBuilder private var tokens: some View {
        if let balances {
            MenuGroup {
                ForEach(store.networkInfo.tokens, id: \.address) { token in
                    HStack(spacing: BrambleSpace.md) {
                        TokenMark(address: token.address, symbol: token.symbol)
                        Text(token.name).brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium)
                        Spacer()
                        Text(balances[token.symbol].flatMap { try? formatTokenAmount(raw: $0, decimals: token.decimals, maxFraction: 4) }
                            .map { "\($0) \(token.symbol)" } ?? "—")
                            .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    }
                    .padding(BrambleMetrics.MenuRow.padding)
                    .frame(minHeight: BrambleSize.row)
                }
            }
        } else {
            Text("Shared balances are unavailable right now.").brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
        }
    }

    private func intents(_ record: MultisigRecord) -> some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            HStack(alignment: .center, spacing: BrambleSpace.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Co-signer updates").brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold)
                    Text("Check securely for intents and signatures shared by known contacts.")
                        .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
                Spacer(minLength: 0)
            }
            PillButton("Check for updates", kind: .secondary, icon: .refresh, busy: syncing) { sync(record) }
            StatusLine(text: syncResult, tone: syncFailed ? .danger : .muted)
            Text("No intents are awaiting verification or signature. Import one to review it here.")
                .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
        }
        .padding(BrambleSpace.lg)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
    }

    private func sync(_ record: MultisigRecord) {
        syncing = true
        Task {
            defer { syncing = false }
            do {
                let outcome = try await store.coordination.sync(record.id)
                syncFailed = false
                syncResult = outcome.held == 0
                    ? "No new co-signer updates"
                    : "\(outcome.held) co-signer update\(outcome.held == 1 ? "" : "s") received. Open them after the next Bramble update."
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
        .confirmationDialog("Stop watching this shared account?", isPresented: $confirmingRemove, titleVisibility: .visible) {
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
                FlowHeader(title: "Receive", subtitle: record.map(multisigDisplayName), network: store.networkLabel) { dismiss() }
                if let record {
                    ReceiveAddressView(address: record.address, copyLabel: "Copy address",
                                       hint: "Send only Starknet assets on \(store.networkInfo.name).")
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
    }
}
