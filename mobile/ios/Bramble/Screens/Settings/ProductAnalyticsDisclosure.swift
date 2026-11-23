import SwiftUI

/// "Product analytics" under Settings → Network (`settings/network-views.ts`): the extension's
/// checkbox. Off by default on mobile.
struct ProductAnalyticsDisclosure: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var open = false
    @State private var isOn = GatewayAnalytics.shared.enabled

    var body: some View {
        Disclosure(title: "Product analytics", summary: isOn ? "On" : "Off", isOpen: $open) {
            VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                CheckRow(text: "Share pseudonymous gateway usage", isOn: $isOn)
                Text("Helps Bramble understand feature usage and failures.")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
        }
        .onChange(of: isOn) { _, next in
            GatewayAnalytics.shared.enabled = next
            store.notify(next ? "Product analytics enabled" : "Product analytics disabled")
        }
    }
}
