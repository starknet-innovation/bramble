import BrambleCore
import SwiftUI

/// The Values section of the extension's "Appearance & currency" screen (`settings-views.ts`).
/// Mobile has one such screen: the existing `AppearanceView`, which shows this under Theme.
struct CurrencySection: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin

    var body: some View {
        let selection = Binding<DisplayCurrency>(
            get: { store.portfolio.currency },
            set: { next in Task { await store.portfolio.setCurrency(next) } }
        )
        VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
            Eyebrow(text: "Values")
            Text("Display currency")
                .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                .foregroundStyle(skin.muted)
            SegmentedControl(
                options: [("USD", DisplayCurrency.usd), ("EUR", .eur), ("GBP", .gbp)],
                selection: selection
            )
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
        case .usd:
            "USD"

        case .eur:
            "EUR"

        case .gbp:
            "GBP"
        }
    }
}
