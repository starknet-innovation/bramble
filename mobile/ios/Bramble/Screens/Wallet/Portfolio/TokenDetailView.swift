import BrambleCore
import SwiftUI

/// `tokenDetailFlow`: price with the 7-day sparkline, the balance, and the contract receipt.
struct TokenDetailView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    let tokenId: String
    var receive: () -> Void = { /* No action unless the shell wires the receive flow. */ }
    /// Opens the privacy journey (Shield, Go private, Deploy and enable).
    var journey: () -> Void = { /* No action unless the shell wires the privacy journey. */ }
    @State private var points: [Double] = []

    /// Stroke width of the price sparkline.
    private static let sparklineLineWidth: CGFloat = 1.5

    var body: some View {
        let portfolio = store.portfolio
        ScrollView {
            if let token = portfolio.tracked.first(where: { $0.token.id == tokenId })?.token {
                VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                    FlowHeader(
                        title: token.symbol,
                        subtitle: token.name,
                        network: store.networkLabel
                    ) { dismiss() }
                    price(token, portfolio: portfolio)
                    balance(token, portfolio: portfolio)
                    // The private half of this token (`tokenDetailPrivacy`): amount, retry, actions.
                    TokenPrivacySection(tokenAddress: token.address, receive: receive, journey: journey)
                    contract(token)
                }
                .padding(BrambleMetrics.Screen.shellPadding)
                .task(id: token.id) { points = await portfolio.chart(for: token) }
            }
        }
    }

    private func price(_ token: TokenConfig, portfolio: PortfolioStore) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Eyebrow(text: "Price")
            Text(
                portfolio.price(of: token).map { formatFiat(amount: $0, currency: portfolio.currency) }
                    ?? "Unavailable"
            )
                .brambleText(BrambleTypeScale.amount, weight: BrambleWeight.heavy, tracking: BrambleTracking.display)
                .monospacedDigit()
            if let line = tokenSparkline(values: points) {
                SparklineShape(points: line.points)
                    .stroke(
                        line.trend == .up ? skin.positive : line.trend == .down ? skin.danger : skin.muted,
                        style: StrokeStyle(lineWidth: Self.sparklineLineWidth, lineCap: .round, lineJoin: .round)
                    )
                    .frame(height: BrambleSize.sparkline)
                    .accessibilityHidden(true)
            } else {
                EmptyState(message: "Price history unavailable.")
            }
            Text("7-day price from CoinGecko. Shown for information only.")
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
        }
    }

    private func balance(_ token: TokenConfig, portfolio: PortfolioStore) -> some View {
        let held = portfolio.balance(of: token)
        let fiat = held.flatMap { heldBalance in
            fiatValueText(
                formatted: heldBalance.formatted,
                price: portfolio.price(of: token),
                currency: portfolio.currency
            )
        }
        return VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            Eyebrow(text: "Your balance")
            Text(
                held.map { "\(compactAmount(formatted: $0.formatted, places: nil)) \(token.symbol)" }
                    ?? "0 \(token.symbol)"
            )
                .brambleText(BrambleTypeScale.row, weight: BrambleWeight.bold).monospacedDigit()
            if let fiat {
                Text(fiat).brambleText(BrambleTypeScale.caption).monospacedDigit().foregroundStyle(skin.muted)
            }
        }
    }

    private func contract(_ token: TokenConfig) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Eyebrow(text: "Contract")
            MenuGroup {
                ReceiptRow(
                    label: "Address",
                    value: shortAddress(token.address),
                    copy: token.address,
                    copyLabel: "Copy token address"
                )
                ReceiptRow(label: "Symbol", value: token.symbol)
                ReceiptRow(label: "Decimals", value: String(token.decimals))
                ReceiptRow(label: "Network", value: store.networkLabel)
            }
        }
    }
}

/// The sparkline polyline in the core's 100×32 view box, scaled to the frame.
struct SparklineShape: Shape {
    let points: [SparklinePoint]

    /// The core's sparkline view box.
    private static let viewBoxWidth: Double = 100
    private static let viewBoxHeight: Double = 32

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for (index, point) in points.enumerated() {
            let location = CGPoint(
                x: rect.minX + point.x / Self.viewBoxWidth * rect.width,
                y: rect.minY + point.y / Self.viewBoxHeight * rect.height
            )
            if index == 0 { path.move(to: location) } else { path.addLine(to: location) }
        }
        return path
    }
}
