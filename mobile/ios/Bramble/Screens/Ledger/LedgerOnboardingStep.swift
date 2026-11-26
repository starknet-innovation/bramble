import BrambleCore
import SwiftUI

/// Onboarding's Ledger step: connect and pick, then the passphrase step creates the wallet. The
/// connection ends when the picks are taken or the step leaves the screen.
struct LedgerOnboardingStep: View {
    @Environment(WalletStore.self) private var store
    let back: () -> Void
    let next: ([LedgerAccountRequest]) -> Void
    @State private var model: LedgerConnectModel?

    var body: some View {
        let stage = model?.stage ?? .bluetooth(.unknown)
        OnboardingStep(back: back, icon: .shield, title: LedgerCopy.title(stage), lede: LedgerCopy.lede(stage)) {
            if let model { LedgerConnectContent(model: model) }
        } cta: {
            if let model {
                LedgerConnectAction(model: model, title: "Continue") { requests in
                    model.close()
                    next(requests)
                }
            }
        }
        .onAppear { if model == nil { model = .live(network: store.network, existing: []) } }
        .onDisappear { model?.close() }
    }
}

/// Add account's "Ledger account": connect, pick, then add the picks to the wallet.
struct LedgerAddAccountFlow: View {
    @Environment(WalletStore.self) private var store
    let back: () -> Void
    let added: () -> Void
    @State private var model: LedgerConnectModel?
    @State private var adding = false

    var body: some View {
        let stage = model?.stage ?? .bluetooth(.unknown)
        VStack(alignment: .leading, spacing: BrambleMetrics.Drawer.gap) {
            FlowHeader(title: LedgerCopy.title(stage), back: back)
            ScrollView {
                VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
                    StatusLine(text: stage == .picking ? nil : LedgerCopy.lede)
                    if let model { LedgerConnectContent(model: model) }
                }
            }
            if let model {
                LedgerConnectAction(model: model, title: addTitle(model), busy: adding) { add($0) }
            }
        }
        .onAppear { if model == nil { model = .live(network: store.network, existing: store.heldAddresses) } }
        .onDisappear { model?.close() }
    }

    private func addTitle(_ model: LedgerConnectModel) -> String {
        let count = model.chosen.count
        return count > 1 ? "Add selected (\(count))" : "Add selected"
    }

    private func add(_ requests: [LedgerAccountRequest]) {
        guard !adding else { return }
        adding = true
        model?.close()
        Task {
            do {
                try await store.addLedgerAccounts(requests)
                added()
            } catch {
                store.toast = describe(error)
                adding = false
            }
        }
    }
}
