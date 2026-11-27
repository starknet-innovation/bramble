import BrambleCore
import SwiftUI

/// Onboarding's Ledger step: connect and pick, reading both Bramble's and Ready's schemes as the
/// extension's first-run setup does, then the passphrase step creates the wallet. The connection
/// ends when the picks are taken or the step leaves the screen.
struct LedgerOnboardingStep: View {
    @Environment(WalletStore.self) private var store
    let back: () -> Void
    let next: ([LedgerAccountRequest]) -> Void
    @State private var model: LedgerConnectModel?

    var body: some View {
        OnboardingStep(back: back, icon: .shield, title: LedgerCopy.title(model), lede: LedgerCopy.lede(model)) {
            if let model { LedgerConnectContent(model: model) }
        } cta: {
            if let model {
                LedgerConnectAction(model: model, title: "Continue") { requests in
                    model.close()
                    next(requests)
                }
            }
        }
        .onAppear {
            if model == nil {
                model = .live(route: .firstRun, network: store.networkInfo, rpc: store.rpc, existing: [])
            }
        }
        .onDisappear { model?.close() }
    }
}

/// Add account's "Ledger account" (Bramble's scheme) and Import's "Ready Ledger account"
/// (Ready's): connect, pick, then add the picks to the wallet.
struct LedgerAddAccountFlow: View {
    @Environment(WalletStore.self) private var store
    let route: LedgerRoute
    let back: () -> Void
    let added: () -> Void
    @State private var model: LedgerConnectModel?
    @State private var adding = false

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Drawer.gap) {
            FlowHeader(title: LedgerCopy.title(model), back: back)
            ScrollView {
                VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
                    StatusLine(text: LedgerCopy.lede(model))
                    if let model { LedgerConnectContent(model: model) }
                }
            }
            if let model {
                LedgerConnectAction(model: model, title: addTitle(model), busy: adding) { add($0) }
            }
        }
        .onAppear {
            if model == nil {
                model = .live(route: route, network: store.networkInfo, rpc: store.rpc, existing: store.heldAddresses)
            }
        }
        .onDisappear { model?.close() }
    }

    private func addTitle(_ model: LedgerConnectModel) -> String {
        let count = model.chosen.count
        return count > 1 ? "Add selected (\(count))" : "Add selected"
    }

    private func add(_ requests: [LedgerAccountRequest]) {
        guard !adding else { return }
        adding = true
        Task {
            do {
                try await store.addLedgerAccounts(requests)
                // Only now: after a failure the connection stays, so Show more still works.
                model?.close()
                added()
            } catch {
                store.toast = describe(error)
                adding = false
            }
        }
    }
}
