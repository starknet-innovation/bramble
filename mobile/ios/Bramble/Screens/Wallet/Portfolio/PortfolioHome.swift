import BrambleCore
import SwiftUI

/// `.hero` from `home-view.ts`: the portfolio total (or "—") and the 24h line, both computed by the
/// core (`portfolio_hero`): the magnitude in the up/down hue, the `% · 24h` window in muted 500.
struct PortfolioHeroView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin

    var body: some View {
        let hero = store.portfolio.hero
        VStack(spacing: BrambleSpace.xs) {
            Text(hero.totalText ?? "—")
                .brambleText(BrambleTypeScale.portfolio, weight: BrambleWeight.heavy, tracking: BrambleTracking.amount)
                .monospacedDigit()
                .accessibilityLabel("Portfolio total")
                .accessibilityValue(hero.totalText ?? "Unavailable")
                .accessibilityIdentifier("portfolio-total")
            if let delta = hero.delta {
                HStack(spacing: 6) {
                    Text(delta.amountText).foregroundStyle(delta.down ? skin.danger : skin.positive)
                    Text(delta.windowText).fontWeight(.medium).foregroundStyle(skin.muted)
                }
                .brambleText(BrambleTypeScale.label, weight: 650)
                .monospacedDigit()
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("portfolio-change")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, BrambleSpace.md)
    }
}

/// The Tokens section of `home-tabs.ts`: heading with the portfolio overflow menu, the visible
/// rows (STRK first, hidden and likely-spam tokens off), the error panel, the empty state, and the
/// "Manage tokens · N not shown" row.
struct PortfolioTokens: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let open: (WalletShell.Flow) -> Void

    var body: some View {
        let portfolio = store.portfolio
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            HStack {
                Text("Tokens").brambleText(BrambleTypeScale.title, weight: BrambleWeight.bold)
                Spacer()
                Menu {
                    // Menu rows are rendered by UIKit: the icon is the generated asset by name.
                    Button { open(.tokens) } label: { Label("Manage tokens", image: BrambleIconName.coins.rawValue) }
                    Button { store.tab = .settings } label: { Label("Wallet settings", image: BrambleIconName.settings.rawValue) }
                    Button {
                        Task { await store.portfolio.refresh(force: true) }
                    } label: { Label("Refresh portfolio", image: BrambleIconName.refresh.rawValue) }
                } label: {
                    BrambleIcon(.moreHorizontal).foregroundStyle(skin.muted)
                        .frame(width: BrambleControl.hit, height: BrambleControl.hit)
                }
                .accessibilityLabel("Portfolio actions")
            }
            switch portfolio.balances {
            case .loading:
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, BrambleSpace.lg)
            case let .failed(message):
                VStack(spacing: BrambleSpace.sm) {
                    EmptyCopy(text: message)
                    Button {
                        Task { await store.portfolio.refresh(force: true) }
                    } label: {
                        HStack(spacing: BrambleSpace.xs) {
                            BrambleIcon(.refresh, size: 16)
                            Text("Try again").brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium)
                        }
                        .foregroundStyle(skin.muted)
                        .padding(.horizontal, BrambleSpace.md)
                        .frame(minHeight: 36)
                    }
                    .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Capsule()))
                    .accessibilityLabel("Retry loading balances")
                }
                .frame(maxWidth: .infinity)
            case .loaded:
                let rows = portfolio.home?.visible ?? []
                if rows.isEmpty {
                    EmptyCopy(text: "No tracked balances yet. Add or detect tokens to see them here.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.token.id) { offset, balance in
                            Button { open(.token(balance.token.id)) } label: {
                                PortfolioTokenRow(balance: balance, prices: portfolio.priceView ?? portfolio.emptyPrices)
                            }
                            .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous), scale: 0.985))
                            .overlay(alignment: .top) {
                                if offset > 0 { Rectangle().fill(skin.hairline).frame(height: 1) }
                            }
                        }
                    }
                }
            }
            if let notShown = portfolio.home?.notShown, notShown > 0 {
                MenuGroup {
                    MenuRow(icon: .coins, title: "Manage tokens", value: "\(notShown) not shown") { open(.tokens) }
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
        HStack(spacing: BrambleSpace.md) {
            TokenGlyphView(glyph: tokenGlyph(address: balance.token.address, symbol: balance.token.symbol))
            VStack(alignment: .leading, spacing: 2) {
                Text(balance.token.symbol).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                Text(amount).brambleText(BrambleTypeScale.caption).monospacedDigit().foregroundStyle(skin.muted).lineLimit(1)
            }
            Spacer(minLength: BrambleSpace.sm)
            VStack(alignment: .trailing, spacing: 2) {
                Text(fiat.valueText ?? "—").brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold).monospacedDigit()
                if let change = fiat.change {
                    Text(change.text)
                        .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
                        .monospacedDigit()
                        .foregroundStyle(change.up ? skin.positive : skin.danger)
                }
            }
        }
        .foregroundStyle(skin.text)
        .padding(.horizontal, BrambleSpace.sm)
        .padding(.vertical, BrambleSpace.md)
        .frame(minHeight: BrambleSize.rowCompact)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("token-row-\(balance.token.symbol)")
    }
}

/// `emptyState`: centred muted copy.
struct EmptyCopy: View {
    @Environment(\.skin) private var skin
    let text: String

    var body: some View {
        Text(text)
            .brambleText(BrambleTypeScale.label)
            .foregroundStyle(skin.muted)
            .multilineTextAlignment(.center)
            .padding(.vertical, BrambleSpace.lg)
            .padding(.horizontal, BrambleSpace.md)
            .frame(maxWidth: .infinity)
    }
}
