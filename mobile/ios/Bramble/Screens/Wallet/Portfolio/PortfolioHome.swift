import BrambleCore
import SwiftUI

/// `.hero` from `home-view.ts`: the portfolio total (or "—") and the 24h line, both computed by the
/// core (`portfolio_hero`): the magnitude in the up/down hue, the `% · 24h` window in muted 500.
struct PortfolioHeroView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin

    /// Gap between the 24h magnitude and its window text.
    private static let deltaGap: CGFloat = 6

    var body: some View {
        let hero = store.portfolio.hero
        let heroMetrics = BrambleMetrics.Hero.self
        VStack(spacing: heroMetrics.gap) {
            Text(hero.totalText ?? "—")
                .brambleText(
                    BrambleTypeStyle(size: heroMetrics.totalSize, lineHeight: heroMetrics.totalLineHeight),
                    weight: heroMetrics.totalWeight,
                    tracking: heroMetrics.totalTracking
                )
                .monospacedDigit()
                .accessibilityLabel("Portfolio total")
                .accessibilityValue(hero.totalText ?? "Unavailable")
                .accessibilityIdentifier("portfolio-total")
            if let delta = hero.delta {
                HStack(spacing: Self.deltaGap) {
                    Text(delta.amountText).foregroundStyle(delta.down ? skin.danger : skin.positive)
                    Text(delta.windowText).fontWeight(.medium).foregroundStyle(skin.muted)
                }
                .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                .monospacedDigit()
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("portfolio-change")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(heroMetrics.padding)
    }
}

/// The Tokens section of `home-tabs.ts`: heading with the portfolio overflow menu, the visible
/// rows (STRK first, hidden and likely-spam tokens off) with private value summed in
/// (`unifiedHomeBalances`; each token's public/private breakdown is on its detail screen), the
/// error panel, the empty state, "Private balances · Try again", and "Manage tokens · N not shown".
struct PortfolioTokens: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let open: (WalletShell.Flow) -> Void
    @State private var retrying = false

    var body: some View {
        let portfolio = store.portfolio
        VStack(alignment: .leading, spacing: 0) {
            header
            switch portfolio.balances {
            case .loading:
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, BrambleSpace.lg)

            case let .failed(message):
                ErrorPanel(message: message, retryHint: "Retry loading balances", busy: retrying) {
                    Task {
                        retrying = true
                        await store.refreshBalances()
                        retrying = false
                    }
                }
                .padding(.top, BrambleSpace.sm)

            case .loaded:
                let rows = portfolio.unified.map(\.balance)
                if rows.isEmpty {
                    EmptyState(message: "No tracked balances yet. Add or detect tokens to see them here.")
                } else {
                    tokenRows(rows)
                }
            }
            PrivacyRetryRow()
            if let notShown = portfolio.home?.notShown, notShown > 0 {
                MenuGroup {
                    MenuRow(icon: .coins, title: "Manage tokens", value: "\(notShown) not shown") { open(.tokens) }
                }
            }
        }
    }

    /// The heading with the portfolio overflow menu.
    private var header: some View {
        HStack {
            Text("Tokens")
                .brambleText(
                    BrambleTypeScale.title.sized(BrambleMetrics.HomeTab.fontSize),
                    weight: BrambleMetrics.HomeTab.weight
                )
                .frame(minHeight: BrambleMetrics.HomeTab.height)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Menu {
                // Menu rows are rendered by UIKit: the icon is the generated asset by name.
                Button { open(.tokens) } label: { Label("Manage tokens", image: BrambleIconName.coins.rawValue) }
                Button { store.tab = .settings } label: {
                    Label("Wallet settings", image: BrambleIconName.settings.rawValue)
                }
                Button {
                    Task { await store.portfolio.refresh(force: true) }
                } label: { Label("Refresh portfolio", image: BrambleIconName.refresh.rawValue) }
            } label: {
                BrambleIcon(.moreHorizontal)
                    .foregroundStyle(skin.muted)
                    .frame(width: BrambleMetrics.IconButton.size, height: BrambleMetrics.IconButton.size)
                    .hitTarget(width: BrambleMetrics.IconButton.size, height: BrambleMetrics.IconButton.size)
            }
            .accessibilityLabel("Portfolio actions")
        }
    }

    /// The visible token rows, each opening its detail, divided by hairlines.
    private func tokenRows(_ rows: [TokenBalance]) -> some View {
        let portfolio = store.portfolio
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.token.id) { offset, balance in
                Button { open(.token(balance.token.id)) } label: {
                    PortfolioTokenRow(balance: balance, prices: portfolio.priceView ?? portfolio.emptyPrices)
                }
                .buttonStyle(
                    FillPressStyle(
                        fill: .clear,
                        pressed: skin.softPress,
                        shape: RoundedRectangle(cornerRadius: BrambleMetrics.TokenRow.radius, style: .continuous),
                        scale: 1
                    )
                )
                .overlay(alignment: .top) {
                    if offset > 0 { Rectangle().fill(skin.hairline).frame(height: 1) }
                }
            }
        }
    }
}

/// `unifiedBalanceRow`'s summary: glyph, symbol over the two-place amount, fiat and 24h badge.
struct PortfolioTokenRow: View {
    @Environment(\.skin) private var skin
    let balance: TokenBalance
    let prices: PriceView

    var body: some View {
        let fiat = tokenRowFiat(balance: balance, prices: prices)
        let amount = portfolioAmount(formatted: balance.formatted)
        let tokenRow = BrambleMetrics.TokenRow.self
        HStack(spacing: tokenRow.gap) {
            TokenGlyphView(glyph: tokenGlyph(address: balance.token.address, symbol: balance.token.symbol))
            VStack(alignment: .leading, spacing: tokenRow.copyGap) {
                Text(balance.token.symbol)
                    .brambleText(BrambleTypeScale.body.sized(tokenRow.symbolSize), weight: tokenRow.symbolWeight)
                Text(amount)
                    .brambleText(BrambleTypeScale.caption.sized(tokenRow.amountSize))
                    .monospacedDigit()
                    .foregroundStyle(skin.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: tokenRow.gap)
            VStack(alignment: .trailing, spacing: tokenRow.copyGap) {
                Text(fiat.valueText ?? "—")
                    .brambleText(BrambleTypeScale.body, weight: tokenRow.valueWeight)
                    .monospacedDigit()
                if let change = fiat.change {
                    Text(change.text)
                        .brambleText(BrambleTypeScale.caption.sized(tokenRow.fiatSize), weight: BrambleWeight.semibold)
                        .monospacedDigit()
                        .foregroundStyle(change.up ? skin.positive : skin.danger)
                }
            }
        }
        .foregroundStyle(skin.text)
        .padding(tokenRow.padding)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("token-row-\(balance.token.symbol)")
    }
}
