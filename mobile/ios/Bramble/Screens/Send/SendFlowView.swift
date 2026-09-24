import BrambleCore
import SwiftUI

/// The Send journey from `send-views.ts`: recipient → details (asset, amount) → review → working
/// → outcome. Every string is the extension's (`SendCopy`, generated); every value shown is the
/// core's; every length is the side panel's send stylesheet (`BrambleMetrics.Send*`, generated).
/// The plan is closed when this screen goes away, and on lock by `WalletStore`.
struct SendFlowView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var model: SendFlowModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.stageGap) {
                if let model {
                    FlowHeader(title: model.title, network: store.networkLabel) { back(model) }
                    SendStageView(model: model, done: { dismiss() }, viewActivity: {
                        store.tab = .activity
                        dismiss()
                    })
                }
                #if DEBUG
                if FixtureTransport.requested() != nil {
                    // UI tests read this to prove the fixture node received no write.
                    Text("rpc-fixture-writes-\(FixtureTransport.writes.value)")
                        .font(.system(size: 1))
                        .opacity(FixtureProbe.opacity)
                        .accessibilityIdentifier("rpc-fixture-writes")
                }
                #endif
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { if model == nil { model = store.makeSendModel() } }
        .onDisappear { model?.close() }
        .onChange(of: model?.toast) { _, toast in
            guard let toast else { return }
            if toast.success { store.notify(toast.message) } else { store.toast = toast.message }
        }
    }

    #if DEBUG
    /// The fixture write counter is present for UI tests but effectively invisible.
    private enum FixtureProbe {
        static let opacity = 0.01
    }
    #endif

    private func back(_ model: SendFlowModel) {
        switch model.stage {
        case .recipient, .submitted, .pending:
            dismiss()

        case .details, .asset, .review, .failed:
            model.back()

        default:
            break
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
        case .recipient:
            SendRecipientView(model: model)

        case .asset:
            SendAssetView(model: model)

        case .details, .reviewing:
            SendDetailsView(model: model)

        case .review:
            SendReviewView(model: model)

        case .authorizing, .broadcasting, .confirming:
            SendWorkingView(stage: model.stage)

        case .pending, .submitted, .failed:
            SendOutcomeView(model: model, done: done, viewActivity: viewActivity)
        }
    }
}

/// `.send-origin-account`: the sending account on the elevated fill.
struct SendOriginCard: View {
    @Environment(\.skin) private var skin
    let account: AccountRecord

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        HStack(spacing: metrics.searchGap) {
            AccountAvatarView(address: account.address)
            VStack(alignment: .leading, spacing: metrics.rowCopyGap) {
                Text(account.displayName).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                Text(account.shortAddress).brambleText(BrambleTypeScale.caption, mono: true).foregroundStyle(skin.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, metrics.originInset)
        .padding(.vertical, BrambleSpace.sm)
        .frame(minHeight: metrics.originHeight)
        .background(skin.elevated, in: RoundedRectangle(cornerRadius: metrics.originRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// `.send-section-title` / `.send-stage-kicker`.
struct SendHeading: View {
    @Environment(\.skin) private var skin
    let text: String
    var kicker = false

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        Text(text)
            .brambleText(
                kicker
                    ? BrambleTypeScale.label.sized(metrics.kickerSize)
                    : BrambleTypeScale.title.sized(metrics.sectionTitleSize),
                weight: kicker ? metrics.kickerWeight : metrics.sectionTitleWeight,
                tracking: kicker ? 0 : BrambleTracking.title
            )
            .foregroundStyle(kicker ? skin.muted : skin.text)
            .accessibilityAddTraits(.isHeader)
    }
}

/// `.send-search-control`: the icon and the input as one flat control on the elevated fill. An
/// invalid value takes the danger-soft fill and danger ink (no edge, stroke or shadow).
struct SendSearchField: View {
    @Environment(\.skin) private var skin
    let placeholder: String
    let label: String
    @Binding var text: String
    var invalid = false
    var submit: () -> Void = {
        // No action by default: pressing return submits nothing unless the caller opts in.
    }

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        HStack(spacing: metrics.searchGap) {
            BrambleIcon(.search).foregroundStyle(invalid ? skin.danger : skin.muted).accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(skin.muted))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .brambleText(BrambleTypeScale.mono, mono: true)
                .foregroundStyle(invalid ? skin.danger : skin.text)
                .accessibilityLabel(label)
                .submitLabel(.continue)
                .onSubmit(submit)
        }
        .padding(.leading, metrics.searchInset)
        .padding(.trailing, BrambleMetrics.Field.padding.trailing)
        .frame(minHeight: metrics.searchHeight)
        .background(
            invalid ? skin.dangerSoft : skin.elevated,
            in: RoundedRectangle(cornerRadius: metrics.searchRadius, style: .continuous)
        )
    }
}

/// `.send-recipient-row` / `.send-asset-row`: a pressable panel row with a mark, copy and a
/// trailing value.
struct SendChoiceRow<Mark: View>: View {
    @Environment(\.skin) private var skin
    let title: String
    let detail: String
    var mono = true
    var value: String?
    let label: String
    @ViewBuilder let mark: () -> Mark
    let action: () -> Void

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        Button(action: action) {
            HStack(spacing: 0) {
                mark().frame(width: BrambleSize.mark, height: BrambleSize.mark)
                VStack(alignment: .leading, spacing: metrics.rowCopyGap) {
                    Text(title)
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                        .foregroundStyle(skin.text)
                        .lineLimit(1)
                    Text(detail)
                        .brambleText(BrambleTypeScale.caption, mono: mono)
                        .foregroundStyle(skin.muted)
                        .lineLimit(1)
                }
                .padding(.horizontal, metrics.rowCopyInset)
                .frame(maxWidth: .infinity, alignment: .leading)
                if let value {
                    Text(value)
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                        .monospacedDigit()
                        .foregroundStyle(skin.text)
                } else {
                    BrambleIcon(.chevronRight, size: BrambleControl.icon).foregroundStyle(skin.muted)
                }
            }
            .padding(metrics.rowPadding)
            .frame(minHeight: metrics.rowHeight)
        }
        .buttonStyle(
            FillPressStyle(
                fill: skin.panel,
                pressed: skin.softPress,
                shape: RoundedRectangle(cornerRadius: metrics.rowRadius, style: .continuous),
                scale: BramblePress.tokenRow
            )
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
    }
}

/// `.send-recipient-stage`: the sending account, the address field, the account / address-book
/// tabs, and Continue.
struct SendRecipientView: View {
    @Bindable var model: SendFlowModel
    @State private var tab = 0

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        VStack(alignment: .leading, spacing: metrics.stageGap) {
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                SendHeading(text: SendCopy.sendingFrom, kicker: true)
                SendOriginCard(account: model.account)
            }
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                SendHeading(text: SendCopy.sendingTo)
                SendSearchField(
                    placeholder: SendCopy.recipientPlaceholder,
                    label: SendCopy.recipientFieldLabel,
                    text: $model.recipientInput,
                    invalid: model.recipientError != nil
                ) { model.continueWithRecipient() }
                StatusLine(text: model.recipientError, tone: .danger)
            }
            SegmentedControl(options: [(SendCopy.myAccounts, 0), (SendCopy.addressBook, 1)], selection: $tab)
            if tab == 0 {
                VStack(spacing: metrics.listGap) {
                    ForEach(model.otherAccounts, id: \.id) { account in
                        SendChoiceRow(
                            title: account.displayName,
                            detail: account.shortAddress,
                            label: "\(account.displayName), \(account.shortAddress)",
                            mark: { AccountAvatarView(address: account.address, size: BrambleSize.mark) },
                            action: { model.useRecipient(account.address) }
                        )
                    }
                }
            } else {
                EmptyState(message: SendCopy.addressBookEmpty)
            }
            PillButton(SendCopy.continueWithAddress) { model.continueWithRecipient() }
                .disabled(model.recipientInput.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}

/// `.send-asset-stage`: the network's bundled tokens with the account's balance.
struct SendAssetView: View {
    @Environment(WalletStore.self) private var store
    let model: SendFlowModel

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        VStack(alignment: .leading, spacing: metrics.listGap) {
            HStack {
                SendHeading(text: SendCopy.yourTokens, kicker: true)
                Spacer()
                SendHeading(text: SendCopy.yourBalance, kicker: true)
            }
            ForEach(model.network.tokens, id: \.address) { token in
                let amount = store.amount(of: token)
                SendChoiceRow(
                    title: token.symbol,
                    detail: amount ?? "…",
                    mono: false,
                    value: "—",
                    label: "\(token.symbol), \(amount ?? "loading")",
                    mark: { TokenMark(address: token.address, symbol: token.symbol) },
                    action: { model.choose(token) }
                )
            }
        }
    }
}
