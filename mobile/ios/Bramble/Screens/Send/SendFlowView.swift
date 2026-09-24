import BrambleCore
import SwiftUI

/// The Send journey from `send-views.ts`: recipient → details (asset, amount) → review → working
/// → outcome. Every string is the extension's (`SendCopy`, generated); every value shown is the
/// core's. The plan is closed when this screen goes away, and on lock by `WalletStore`.
struct SendFlowView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var model: SendFlowModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleSpace.lg) {
                if let model {
                    FlowHeader(title: model.title, network: store.networkLabel) { back(model) }
                    SendStageView(model: model, done: { dismiss() }, viewActivity: {
                        store.tab = .activity
                        dismiss()
                    })
                }
                #if DEBUG
                if FixtureRpcTransport.launchScenario != nil {
                    // UI tests read this to prove the fixture node received no write.
                    Text("rpc-fixture-writes-\(FixtureRpcTransport.writes.value)")
                        .font(.system(size: 1)).opacity(0.01)
                        .accessibilityIdentifier("rpc-fixture-writes")
                }
                #endif
            }
            .padding(.horizontal, BrambleSpace.lg)
            .padding(.bottom, BrambleSpace.xl)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { if model == nil { model = store.makeSendModel() } }
        .onDisappear { model?.close() }
        .onChange(of: model?.toast) { _, message in if let message { store.toast = message } }
    }

    private func back(_ model: SendFlowModel) {
        switch model.stage {
        case .recipient, .submitted, .pending: dismiss()
        case .details, .asset, .review, .failed: model.back()
        default: break
        }
    }
}

/// Switches on the journey's stage.
struct SendStageView: View {
    let model: SendFlowModel
    let done: () -> Void
    let viewActivity: () -> Void

    var body: some View {
        switch model.stage {
        case .recipient: SendRecipientView(model: model)
        case .asset: SendAssetView(model: model)
        case .details, .reviewing: SendDetailsView(model: model)
        case .review: SendReviewView(model: model)
        case .authorizing, .broadcasting, .confirming: SendWorkingView(stage: model.stage)
        case .pending, .submitted, .failed: SendOutcomeView(model: model, done: done, viewActivity: viewActivity)
        }
    }
}

/// `.send-from`: the sending account's avatar, name and truncated address.
struct SendAccountCard: View {
    @Environment(\.skin) private var skin
    let caption: String
    let account: AccountInfo

    var body: some View {
        HStack(spacing: BrambleSpace.md) {
            AccountAvatarView(address: account.address)
            VStack(alignment: .leading, spacing: 2) {
                Text(caption).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                Text("Account \(account.index + 1)").brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                Text(shortAddress(address: account.address)).brambleText(BrambleTypeScale.caption, mono: true).foregroundStyle(skin.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(BrambleSpace.md)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
    }
}

/// `.send-recipient-stage`: the address field, the account / address-book tabs, and Continue.
struct SendRecipientView: View {
    @Environment(\.skin) private var skin
    @Bindable var model: SendFlowModel
    @State private var tab = 0

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            SendAccountCard(caption: SendCopy.sendingFrom, account: model.account)
            Text(SendCopy.sendingTo).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
            HStack(spacing: BrambleSpace.sm) {
                BrambleIcon(.search).foregroundStyle(skin.muted)
                TextField("", text: $model.recipientInput, prompt: Text(SendCopy.recipientPlaceholder).foregroundStyle(skin.muted))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .brambleText(BrambleTypeScale.mono, mono: true)
                    .accessibilityLabel(SendCopy.recipientFieldLabel)
                    .submitLabel(.continue)
                    .onSubmit { model.continueWithRecipient() }
            }
            .padding(.horizontal, BrambleSpace.md)
            .frame(minHeight: BrambleSize.control)
            .background(skin.elevated, in: FieldShape())
            .overlay(alignment: .bottom) { FieldEdge(color: model.recipientError == nil ? skin.border : skin.danger) }
            StatusLine(text: model.recipientError, tone: .danger)
            SegmentedControl(options: [(SendCopy.myAccounts, 0), (SendCopy.addressBook, 1)], selection: $tab)
            if tab == 0 {
                if !model.otherAccounts.isEmpty {
                    MenuGroup {
                        ForEach(model.otherAccounts, id: \.index) { account in
                            MenuRow(icon: nil, title: "Account \(account.index + 1)", value: shortAddress(address: account.address)) {
                                model.useRecipient(account.address)
                            }
                        }
                    }
                }
            } else {
                Text(SendCopy.addressBookEmpty)
                    .brambleText(BrambleTypeScale.label).foregroundStyle(skin.muted)
                    .frame(maxWidth: .infinity).padding(.vertical, BrambleSpace.lg)
            }
            PillButton(SendCopy.continueWithAddress) { model.continueWithRecipient() }
                .disabled(model.recipientInput.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}

/// `.send-asset-stage`: the network's bundled tokens with the account's balance.
struct SendAssetView: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store
    let model: SendFlowModel

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            HStack {
                Text(SendCopy.yourTokens).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                Spacer()
                Text(SendCopy.yourBalance).brambleText(BrambleTypeScale.label).foregroundStyle(skin.muted)
            }
            ForEach(model.network.tokens, id: \.address) { token in
                Button { model.choose(token) } label: {
                    TokenRow(token: token, amount: store.amount(of: token))
                }
                .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous)))
                .accessibilityLabel(token.symbol)
            }
        }
    }
}
