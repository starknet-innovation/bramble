import BrambleCore
import SwiftUI
import UniformTypeIdentifiers

/// `tokenDetailFlow`: price with the 7-day sparkline, the balance, and the contract receipt.
struct TokenDetailView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    let tokenId: String
    @State private var points: [Double] = []
    @State private var copied = false

    var body: some View {
        let portfolio = store.portfolio
        ScrollView {
            if let token = portfolio.tracked.first(where: { $0.token.id == tokenId })?.token {
                VStack(alignment: .leading, spacing: BrambleSpace.md) {
                    FlowHeader(title: token.symbol, subtitle: token.name, network: store.networkLabel) { dismiss() }
                    price(token, portfolio: portfolio)
                    balance(token, portfolio: portfolio)
                    contract(token)
                }
                .padding(.horizontal, BrambleSpace.lg)
                .task(id: token.id) { points = await portfolio.chart(for: token) }
            }
        }
    }

    private func price(_ token: TokenConfig, portfolio: PortfolioStore) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Eyebrow(text: "Price")
            Text(portfolio.price(of: token).map { formatFiat(amount: $0, currency: portfolio.currency) } ?? "Unavailable")
                .brambleText(BrambleTypeScale.amount, weight: BrambleWeight.heavy, tracking: BrambleTracking.display)
                .monospacedDigit()
            if let line = tokenSparkline(values: points) {
                SparklineShape(points: line.points)
                    .stroke(line.trend == .up ? skin.positive : line.trend == .down ? skin.danger : skin.muted,
                            style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    .frame(height: BrambleSize.sparkline)
                    .accessibilityHidden(true)
            } else {
                EmptyCopy(text: "Price history unavailable.")
            }
            Text("7-day price from CoinGecko. Shown for information only.")
                .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
        }
    }

    private func balance(_ token: TokenConfig, portfolio: PortfolioStore) -> some View {
        let held = portfolio.balance(of: token)
        let fiat = held.flatMap { fiatValueText(formatted: $0.formatted, price: portfolio.price(of: token), currency: portfolio.currency) }
        return VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            Eyebrow(text: "Your balance")
            Text(held.map { "\(compactAmount(formatted: $0.formatted, places: nil)) \(token.symbol)" } ?? "0 \(token.symbol)")
                .brambleText(BrambleTypeScale.row, weight: BrambleWeight.bold).monospacedDigit()
            if let fiat {
                Text(fiat).brambleText(BrambleTypeScale.caption).monospacedDigit().foregroundStyle(skin.muted)
            }
        }
    }

    private func contract(_ token: TokenConfig) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Eyebrow(text: "Contract")
            VStack(spacing: 0) {
                ReceiptRow(label: "Address", value: shortAddress(token.address), mono: true) {
                    IconButton(icon: copied ? .check : .copy, label: "Copy token address", tint: skin.muted) {
                        UIPasteboard.general.setItems(
                            [[UTType.plainText.identifier: token.address]],
                            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)]
                        )
                        copied = true
                    }
                }
                ReceiptRow(label: "Symbol", value: token.symbol)
                ReceiptRow(label: "Decimals", value: String(token.decimals))
                ReceiptRow(label: "Network", value: store.networkLabel)
            }
            .padding(.horizontal, BrambleSpace.md)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
        }
    }
}

/// One `receipt` line: muted label, value, optional trailing action.
struct ReceiptRow<Action: View>: View {
    @Environment(\.skin) private var skin
    let label: String
    let value: String
    var mono = false
    @ViewBuilder var action: () -> Action

    init(label: String, value: String, mono: Bool = false, @ViewBuilder action: @escaping () -> Action = { EmptyView() }) {
        self.label = label
        self.value = value
        self.mono = mono
        self.action = action
    }

    var body: some View {
        HStack(spacing: BrambleSpace.sm) {
            Text(label).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
            Spacer(minLength: BrambleSpace.sm)
            Text(value).brambleText(mono ? BrambleTypeScale.mono : BrambleTypeScale.body, weight: BrambleWeight.medium, mono: mono)
            action()
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

/// The sparkline polyline in the core's 100×32 view box, scaled to the frame.
struct SparklineShape: Shape {
    let points: [SparklinePoint]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for (index, point) in points.enumerated() {
            let location = CGPoint(x: rect.minX + point.x / 100 * rect.width, y: rect.minY + point.y / 32 * rect.height)
            if index == 0 { path.move(to: location) } else { path.addLine(to: location) }
        }
        return path
    }
}
