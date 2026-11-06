import BrambleCore
import SwiftUI

/// `.send-details`: the accounts receipt, the amount card (asset trigger, amount, balance with
/// Half and Max), and Review send. The trigger opens `SendAssetSheet`.
struct SendDetailsView: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store
    @Bindable var model: SendFlowModel
    let manageTokens: () -> Void
    @State private var picking = false

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        let invalid = model.amountError != nil
        VStack(alignment: .leading, spacing: metrics.formGap) {
            Eyebrow(text: SendCopy.accountsHeading)
            SendReceipt(rows: [
                SendReceipt.Row(SendCopy.fromLabel, model.account.displayName),
                SendReceipt.Row(SendCopy.toLabel, model.recipient.map { shortAddress($0) } ?? "—", mono: true),
                SendReceipt.Row(SendCopy.networkLabel, store.networkLabel)
            ])
            amountCard(invalid: invalid)
            StatusLine(text: model.amountError, tone: .danger)
            PillButton(
                model.stage == .reviewing ? SendCopy.preparing : SendCopy.reviewLabel,
                icon: .send,
                busy: model.stage == .reviewing
            ) {
                Task { await model.reviewSend() }
            }
            .disabled(model.amount.isEmpty)
        }
        .sheet(isPresented: $picking) { assetSheet }
    }

    private var assetSheet: some View {
        SkinProvider {
            SendAssetSheet(
                tokens: model.network.tokens,
                selected: model.token.address,
                choose: { token in
                    model.choose(token)
                    picking = false
                },
                manageTokens: {
                    picking = false
                    manageTokens()
                },
                close: { picking = false }
            )
            .padding(BrambleMetrics.Drawer.padding)
            .padding(.top, BrambleSpace.sm)
            .background { SheetBackground() }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(BrambleRadius.xl)
        }
        .environment(store)
    }

    /// `.send-amount-card`: the card is the amount field, so it is flat and an invalid
    /// amount turns its fill and ink to the danger tones.
    private func amountCard(invalid: Bool) -> some View {
        let metrics = BrambleMetrics.Send.self
        return VStack(alignment: .leading, spacing: metrics.amountCardGap) {
            tokenTrigger
            TextField(
                "",
                text: $model.amount,
                prompt: Text(SendCopy.amountPlaceholder).foregroundStyle(skin.muted)
            )
            .keyboardType(.decimalPad)
            .multilineTextAlignment(.trailing)
            .brambleText(
                BrambleTypeScale.amount.sized(metrics.amountSize),
                weight: metrics.amountWeight,
                tracking: BrambleTracking.amount
            )
            .monospacedDigit()
            .foregroundStyle(invalid ? skin.danger : skin.text)
            .frame(minHeight: metrics.amountHeight)
            .accessibilityLabel(SendCopy.amountLabel)
            // Locales whose decimal pad types "," still enter the extension's "." grammar.
            .onChange(of: model.amount) { _, text in
                if text.contains(",") {
                    model.amount = text.replacingOccurrences(of: ",", with: ".")
                }
            }
            HStack(spacing: metrics.metaGap) {
                Text(model.balanceLine)
                    .brambleText(BrambleTypeScale.caption.sized(metrics.metaSize))
                    .foregroundStyle(skin.muted)
                Spacer(minLength: 0)
                HStack(spacing: metrics.shortcutsGap) {
                    shortcut(SendCopy.half) { model.fill(half: true) }
                    shortcut(SendCopy.max) { model.fill(half: false) }
                }
            }
            Text(SendCopy.estimatedValueUnavailable)
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.muted)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(metrics.amountCardPadding)
        .background(
            invalid ? skin.dangerSoft : skin.panel,
            in: RoundedRectangle(cornerRadius: metrics.amountCardRadius, style: .continuous)
        )
    }

    /// `.send-token-trigger`: the chosen asset as an elevated pill that opens the asset sheet.
    private var tokenTrigger: some View {
        let metrics = BrambleMetrics.Send.self
        return Button { picking = true } label: {
            HStack(spacing: BrambleSpace.sm) {
                TokenMark(address: model.token.address, symbol: model.token.symbol)
                    .scaleEffect(metrics.tokenTriggerGlyph / BrambleMetrics.TokenRow.markSize)
                    .frame(width: metrics.tokenTriggerGlyph, height: metrics.tokenTriggerGlyph)
                Text(model.token.symbol).brambleText(BrambleTypeScale.body, weight: BrambleMetrics.Button.weight)
                BrambleIcon(.chevronDown, size: BrambleSpace.lg).foregroundStyle(skin.muted)
            }
            .foregroundStyle(skin.text)
            .padding(metrics.tokenTriggerPadding)
            .frame(minHeight: metrics.tokenTriggerHeight)
        }
        .buttonStyle(
            FillPressStyle(
                fill: skin.elevated,
                pressed: skin.softPress,
                shape: Capsule(),
                hit: CGSize(width: BrambleHit.minimum, height: metrics.tokenTriggerHeight)
            )
        )
        .accessibilityLabel("\(SendCopy.assetLabel) \(model.token.symbol)")
    }

    /// `.send-amount-shortcuts button`: a transparent small control, 44pt to the touch.
    private func shortcut(_ title: String, action: @escaping () -> Void) -> some View {
        let metrics = BrambleMetrics.Send.self
        return Button(action: action) {
            Text(title)
                .brambleText(BrambleTypeScale.caption.sized(metrics.metaSize), weight: BrambleWeight.semibold)
                .foregroundStyle(model.rawBalance == nil ? skin.muted : skin.text)
                .padding(metrics.shortcutPadding)
                .frame(minHeight: metrics.shortcutHeight)
        }
        .buttonStyle(
            FillPressStyle(
                fill: .clear,
                pressed: skin.softPress,
                shape: Capsule(),
                hit: CGSize(width: BrambleHit.minimum, height: metrics.shortcutHeight)
            )
        )
        .disabled(model.rawBalance == nil)
        .accessibilityLabel(title)
    }
}
