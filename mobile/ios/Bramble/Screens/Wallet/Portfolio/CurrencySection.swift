import BrambleCore
import SwiftUI

/// The Values section of the extension's "Appearance & currency" screen (`settings-views.ts`),
/// appended to the existing `AppearanceView` under its Theme section.
struct CurrencySection: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin

    var body: some View {
        let selection = Binding<DisplayCurrency>(
            get: { store.portfolio.currency },
            set: { next in Task { await store.portfolio.setCurrency(next) } }
        )
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Eyebrow(text: "Values").padding(.top, BrambleSpace.sm)
            Text("Display currency").brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
            SegmentedControl(options: [("USD", DisplayCurrency.usd), ("EUR", .eur), ("GBP", .gbp)], selection: selection)
                .accessibilityIdentifier("display-currency")
            Text("Prices and portfolio totals use this display currency. Token balances remain unchanged.")
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
        }
    }
}

extension DisplayCurrency {
    /// The settings row value: the currency code uppercased.
    var code: String {
        switch self {
        case .usd: "USD"
        case .eur: "EUR"
        case .gbp: "GBP"
        }
    }
}
