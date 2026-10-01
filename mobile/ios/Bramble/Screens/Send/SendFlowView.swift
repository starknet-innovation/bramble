import BrambleCore
import SwiftUI

/// The Send journey from `send-views.ts`: recipient → details (amount, with the asset picked in a
/// sheet) → review → working → outcome. Every string is the extension's (`SendCopy`, generated);
/// every value shown is the core's; every length is the side panel's send stylesheet
/// (`BrambleMetrics.Send*`, generated). The plan is closed when this screen goes away, and on
/// lock by `WalletStore`.
struct SendFlowView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    /// The token to open on (a token screen's Send); nil opens on STRK.
    var token: String?
    /// The asset sheet's "Manage tokens" row: opens the token list over the journey.
    var manageTokens: () -> Void = { /* No action unless the shell wires the token list. */ }
    @State private var model: SendFlowModel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.stageGap) {
                if let model {
                    FlowHeader(title: model.title, network: store.networkLabel) { back(model) }
                    SendStageView(model: model, manageTokens: manageTokens, done: { dismiss() }, viewActivity: {
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
        .onAppear { if model == nil { model = store.makeSendModel(token: token) } }
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

        case .details, .review, .failed:
            model.back()

        default:
            break
        }
    }
}

/// Switches on the journey's stage.
struct SendStageView: View {
    let model: SendFlowModel
    let manageTokens: () -> Void
    let done: () -> Void
    let viewActivity: () -> Void

    var body: some View {
        switch model.stage {
        case .recipient:
            SendRecipientView(model: model)

        case .details, .reviewing:
            SendDetailsView(model: model, manageTokens: manageTokens)

        case .review:
            SendReviewView(model: model)

        case .authorizing, .broadcasting, .confirming:
            SendWorkingView()

        case .pending, .submitted, .failed:
            SendOutcomeView(model: model, done: done, viewActivity: viewActivity)
        }
    }
}

/// `.send-origin-account`: the sending account on the elevated fill, its truncated address beside
/// a control that copies it in full (`copySendingAddress`).
struct SendOriginCard: View {
    @Environment(\.skin) private var skin
    let account: AccountRecord

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        HStack(spacing: metrics.searchGap) {
            AccountAvatarView(address: account.address)
            VStack(alignment: .leading, spacing: metrics.rowCopyGap) {
                Text(account.displayName).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                Text(account.shortAddress)
                    .brambleText(BrambleTypeScale.caption, mono: true)
                    .foregroundStyle(skin.muted)
                    .accessibilityValue(account.address)
            }
            Spacer(minLength: 0)
            CopyButton(value: account.address, label: SendCopy.copySendingAddress)
        }
        .padding(.leading, metrics.originInset)
        .padding(.vertical, BrambleSpace.sm)
        .frame(minHeight: metrics.originHeight)
        .background(skin.elevated, in: RoundedRectangle(cornerRadius: metrics.originRadius, style: .continuous))
        .accessibilityElement(children: .contain)
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

/// `.send-recipient-row`: a pressable panel row with a mark, the name over the truncated address,
/// an optional note (the sender's "Current"), and a chevron.
struct SendChoiceRow<Mark: View>: View {
    @Environment(\.skin) private var skin
    let title: String
    let detail: String
    var note: String?
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
                        .brambleText(BrambleTypeScale.caption, mono: true)
                        .foregroundStyle(skin.muted)
                        .lineLimit(1)
                    if let note {
                        Text(note).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    }
                }
                .padding(.horizontal, metrics.rowCopyInset)
                .frame(maxWidth: .infinity, alignment: .leading)
                BrambleIcon(.chevronRight, size: BrambleControl.icon).foregroundStyle(skin.muted)
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

/// `.send-list-heading`: a list's glyph and name, and for a folder the number of accounts in it.
struct SendListHeading: View {
    @Environment(\.skin) private var skin
    let icon: BrambleIconName
    let title: String
    var count: Int?

    var body: some View {
        HStack(spacing: BrambleSpace.sm) {
            BrambleIcon(icon, size: BrambleControl.icon).foregroundStyle(skin.muted)
            Text(title).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
            if let count {
                Text(String(count)).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
