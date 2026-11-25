import BrambleCore
import SwiftUI

/// `swapFlow` from `swap-views.ts`: the Sell and Buy panels around the flip control, the rate and
/// fee line, and Review swap; then the review (`SwapReviewSection`) and the receipt. Every string
/// is the extension's (`SwapCopy`, generated) or the core's; every length is the send stylesheet's
/// (`BrambleMetrics.Send`). A quote is asked for 350 ms after the last edit (`QUOTE_DEBOUNCE_MS`).
/// The plan is closed when this screen goes away, and on lock by `WalletStore`.
struct SwapView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    /// The tracked token id to sell (a token screen's Swap); nil opens on ETH → STRK.
    var token: String?
    @State private var model: SwapFlowModel?

    /// `QUOTE_DEBOUNCE_MS`.
    private static let quoteDebounceMs = 350

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Send.stageGap) {
                if let model {
                    FlowHeader(title: title(model), network: store.networkLabel) { back(model) }
                    stage(model)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { if model == nil { model = store.makeSwapModel(token: token) } }
        .onDisappear { model?.close() }
        .task(id: model?.quoteKey) {
            guard let model, model.stage == .edit else { return }
            try? await Task.sleep(for: .milliseconds(Self.quoteDebounceMs))
            guard !Task.isCancelled else { return }
            await model.requestQuote()
        }
    }

    private func title(_ model: SwapFlowModel) -> String {
        switch model.stage {
        case .edit, .preparing:
            SwapCopy.title

        case .review, .submitting:
            SwapCopy.reviewTitle

        case .submitted:
            model.confirmed ? SwapCopy.complete : SwapCopy.submitted

        case .failed:
            SwapCopy.swapFailed
        }
    }

    @ViewBuilder
    private func stage(_ model: SwapFlowModel) -> some View {
        switch model.stage {
        case .edit, .preparing:
            SwapEditView(model: model)

        case .review, .submitting:
            SwapReviewSection(model: model)

        case .submitted, .failed:
            SwapOutcomeView(model: model, leave: leave)
        }
    }

    private func back(_ model: SwapFlowModel) {
        if model.back() {
            dismiss()
        } else if model.stage == .edit {
            Task { await model.requestQuote() }
        }
    }

    private func leave(_ tab: WalletStore.Tab) {
        Task { await store.refreshBalances() }
        store.tab = tab
        dismiss()
    }
}

/// `#swap-edit`: the Sell panel (amount field, Max), the flip control, the Buy panel (the quoted
/// amount), the rate and fee, the loss warning, the core's refusal, and Review swap.
private struct SwapEditView: View {
    @Environment(\.skin) private var skin
    @Bindable var model: SwapFlowModel

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        VStack(alignment: .leading, spacing: metrics.formGap) {
            VStack(spacing: BrambleSpace.sm) {
                panel(.sell)
                IconButton(icon: .arrowDown, label: SwapCopy.flip) { model.flip() }
                    .disabled(model.stage != .edit)
                panel(.buy)
            }
            meta
            if model.quote != nil, model.lossPercent >= SwapCopy.lossWarnPercent {
                StatusLine(text: SwapCopy.highSlippage, tone: .danger)
            }
            StatusLine(
                text: model.stage == .preparing ? SwapCopy.preparing : model.quoting ? SwapCopy.finding : model.note,
                tone: model.note != nil && !model.quoting && model.stage == .edit ? .danger : .muted
            )
            PillButton(
                model.reviewLabel,
                kind: model.quote != nil && model.lossPercent >= SwapCopy.lossHighRiskPercent ? .danger : .primary,
                icon: .swap,
                busy: model.stage == .preparing
            ) {
                Task { await model.reviewSwap() }
            }
            .disabled(!model.canReview)
        }
    }

    /// `.swap-panel`: label, the amount (typed or quoted) beside the token menu, then the balance.
    private func panel(_ side: SwapFlowModel.Side) -> some View {
        let metrics = BrambleMetrics.Send.self
        let token = side == .sell ? model.sell : model.buy
        return VStack(alignment: .leading, spacing: metrics.amountCardGap) {
            Text(side == .sell ? SwapCopy.sell : SwapCopy.buy)
                .brambleText(BrambleTypeScale.caption.sized(metrics.metaSize))
                .foregroundStyle(skin.muted)
            HStack(spacing: BrambleSpace.sm) {
                amount(side)
                tokenMenu(side, token: token)
            }
            if side == .sell {
                HStack(spacing: metrics.metaGap) {
                    Spacer(minLength: 0)
                    Button(SwapCopy.max) { model.fillMax() }
                        .brambleText(BrambleTypeScale.caption.sized(metrics.metaSize), weight: BrambleWeight.semibold)
                        .foregroundStyle(model.rawBalance == nil ? skin.muted : skin.text)
                        .frame(minWidth: BrambleHit.minimum, minHeight: BrambleHit.minimum)
                        .disabled(model.rawBalance == nil || model.stage != .edit)
                }
            }
        }
        .padding(metrics.amountCardPadding)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.amountCardRadius, style: .continuous))
    }

    @ViewBuilder
    private func amount(_ side: SwapFlowModel.Side) -> some View {
        let metrics = BrambleMetrics.Send.self
        let style = BrambleTypeScale.amount.sized(metrics.amountSize)
        if side == .sell {
            TextField("", text: $model.amount, prompt: Text("0").foregroundStyle(skin.muted))
                .keyboardType(.decimalPad)
                .brambleText(style, weight: metrics.amountWeight, tracking: BrambleTracking.amount)
                .monospacedDigit()
                .foregroundStyle(model.insufficient ? skin.danger : skin.text)
                .frame(minHeight: metrics.amountHeight)
                .accessibilityLabel(SwapCopy.amountToSell)
                .disabled(model.stage != .edit)
                // Locales whose decimal pad types "," still enter the extension's "." grammar.
                .onChange(of: model.amount) { _, text in
                    if text.contains(",") { model.amount = text.replacingOccurrences(of: ",", with: ".") }
                }
        } else {
            Text(model.quote?.buyAmount ?? "0")
                .brambleText(style, weight: metrics.amountWeight, tracking: BrambleTracking.amount)
                .monospacedDigit()
                .foregroundStyle(model.quote == nil ? skin.muted : skin.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: metrics.amountHeight, alignment: .leading)
                .accessibilityIdentifier("swap-buy-amount")
        }
    }

    /// The side's token as a native menu of the tracked tokens (`tokenDropdownShell`).
    private func tokenMenu(_ side: SwapFlowModel.Side, token: TokenConfig?) -> some View {
        Menu {
            ForEach(model.tokens, id: \.id) { option in
                Button(option.symbol) { model.choose(option, for: side) }
            }
        } label: {
            HStack(spacing: BrambleSpace.sm) {
                if let token { TokenMark(address: token.address, symbol: token.symbol) }
                Text(token?.symbol ?? SwapCopy.select)
                    .brambleText(BrambleTypeScale.body, weight: BrambleMetrics.Button.weight)
                BrambleIcon(.chevronDown, size: BrambleSpace.lg).foregroundStyle(skin.muted)
            }
            .foregroundStyle(skin.text)
            .frame(minHeight: BrambleHit.minimum)
        }
        .disabled(model.stage != .edit)
        .accessibilityLabel(side == .sell ? SwapCopy.chooseSellToken : SwapCopy.chooseBuyToken)
        .accessibilityValue(token?.symbol ?? "")
    }

    /// `.swap-meta`: "1 SELL = x BUY", "Fee ≈ $…", and Refresh quote.
    private var meta: some View {
        HStack(spacing: BrambleSpace.sm) {
            if let quote = model.quote, let sell = model.sell, let buy = model.buy {
                Text(SwapRate.line(quote, sell: sell.symbol, buy: buy.symbol) ?? "")
                Spacer(minLength: 0)
                Text(SwapCopy.fee.replacingOccurrences(
                    of: "{amount}",
                    with: formatFiat(amount: quote.gasFeesInUsd, currency: .usd)
                ))
            } else {
                Spacer(minLength: 0)
            }
            IconButton(icon: .refresh, label: SwapCopy.refreshQuote) { Task { await model.requestQuote() } }
                .disabled(model.stage != .edit || model.amount.isEmpty || model.quoting)
        }
        .brambleText(BrambleTypeScale.caption)
        .foregroundStyle(skin.muted)
        .monospacedDigit()
    }
}

/// The quote's rate line (`paintSwapMeta`).
enum SwapRate {
    /// Fraction digits for a rate of 1 and over, and under it (`toFixed(4)` / `toFixed(10)`).
    private static let wholeDigits = 4
    private static let fractionDigits = 10

    /// "1 ETH = 1250 STRK", trailing zeros trimmed; nil for no rate.
    static func line(_ quote: SwapQuoteView, sell: String, buy: String) -> String? {
        guard let sold = Double(quote.sellAmount), let bought = Double(quote.buyAmount), sold > 0 else { return nil }
        let rate = bought / sold
        guard rate > 0 else { return nil }
        var text = String(format: "%.\(rate >= 1 ? wholeDigits : fractionDigits)f", rate)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return "1 \(sell) = \(text) \(buy)"
    }
}
