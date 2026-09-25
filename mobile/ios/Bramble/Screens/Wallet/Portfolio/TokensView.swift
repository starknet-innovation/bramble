import BrambleCore
import SwiftUI

/// Metrics shared by the token list rows in this file.
private enum TokenListLayout {
    /// Vertical gap between a row's two text lines.
    static let lineSpacing: CGFloat = 2
    /// Minimum height of the Show / Hide / Add capsule buttons.
    static let capsuleButtonHeight: CGFloat = 36
    /// Opacity of a token row hidden from home.
    static let hiddenRowOpacity: Double = 0.6
}

/// `tokensFlow` from `token-flows.ts`: the add and discover tasks, then every token tracked on the
/// active network with Show/Hide, or the "Likely spam" flag in its place.
struct TokensView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    let open: (WalletShell.Flow) -> Void
    @State private var busy: String?

    var body: some View {
        let portfolio = store.portfolio
        let tracked = portfolio.tracked
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(
                    title: "Tokens",
                    subtitle: "\(tracked.count) tracked",
                    network: store.networkLabel
                ) { dismiss() }
                MenuGroup {
                    MenuRow(icon: .plus, title: "Add by contract") { open(.addToken) }
                    MenuRow(icon: .search, title: "Find held tokens") { open(.discoverTokens) }
                }
                Eyebrow(text: "Tracked tokens").padding(.top, BrambleSpace.sm)
                if tracked.isEmpty {
                    EmptyState(message: "No tokens tracked on this network yet.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(tracked, id: \.token.id) { item in
                            row(
                                item,
                                balance: portfolio.balance(of: item.token),
                                price: portfolio.price(of: item.token)
                            )
                        }
                    }
                }
                Text("Hidden and likely-spam tokens stay off home but remain listed here.")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
    }

    private func row(_ item: TrackedToken, balance: TokenBalance?, price: Double?) -> some View {
        let token = item.token
        return HStack(spacing: BrambleSpace.md) {
            TokenGlyphView(glyph: tokenGlyph(address: token.address, symbol: token.symbol))
            VStack(alignment: .leading, spacing: TokenListLayout.lineSpacing) {
                Text(token.symbol).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                Text(token.name).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted).lineLimit(1)
            }
            Spacer(minLength: BrambleSpace.sm)
            VStack(alignment: .trailing, spacing: TokenListLayout.lineSpacing) {
                if let balance {
                    Text(compactAmount(formatted: balance.formatted, places: nil))
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.bold).monospacedDigit()
                    if let fiat = fiatValueText(
                        formatted: balance.formatted,
                        price: price,
                        currency: store.portfolio.currency
                    ) {
                        Text(fiat).brambleText(BrambleTypeScale.caption).monospacedDigit().foregroundStyle(skin.muted)
                    }
                }
            }
            if item.likelySpam {
                Text("Likely spam")
                    .brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold)
                    .foregroundStyle(skin.warning)
            } else {
                let hidden = item.hiddenFromHome
                Button {
                    Task { toggle(token, hidden: hidden) }
                } label: {
                    Text(hidden ? "Show" : "Hide")
                        .brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium)
                        .foregroundStyle(skin.text)
                        .padding(.horizontal, BrambleSpace.md)
                        .frame(minHeight: TokenListLayout.capsuleButtonHeight)
                }
                .buttonStyle(FillPressStyle(fill: skin.elevated, pressed: skin.softPress, shape: Capsule()))
                .disabled(busy == token.id)
                .accessibilityLabel("\(hidden ? "Show" : "Hide") \(token.symbol)")
            }
        }
        .padding(.vertical, BrambleSpace.sm)
        .opacity(item.hiddenFromHome ? TokenListLayout.hiddenRowOpacity : 1)
        .accessibilityIdentifier("tracked-\(token.symbol)")
    }

    private func toggle(_ token: TokenConfig, hidden: Bool) {
        busy = token.id
        defer { busy = nil }
        // `tokens-ui.ts`: success in design-mobile's success tone (`notify`), failure as an error.
        if store.portfolio.setHidden(token.id, hidden: !hidden) {
            store.notify(hidden ? "Token shown" : "Token hidden")
        } else {
            store.toast = "Token update failed"
        }
    }
}

/// `tokenAddFlow`: the contract address, read on chain before anything is saved.
struct AddTokenView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var result: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
            FlowHeader(
                title: "Add token",
                subtitle: "Track a token by its contract",
                network: store.networkLabel
            ) { dismiss() }
            BrambleField(
                label: "Contract address",
                placeholder: "0x…",
                text: $address,
                mono: true,
                hint: "Name, symbol, and decimals are read from the contract before it is saved."
            )
            PillButton("Read and add token", icon: .check, busy: busy) {
                Task {
                    busy = true
                    let failure = await store.portfolio.addToken(address)
                    busy = false
                    result = failure
                    if let failure {
                        store.toast = failure
                    } else {
                        store.notify("Token added")
                        dismiss()
                    }
                }
            }
            .disabled(address.isEmpty)
            StatusLine(text: result, tone: .danger)
            Spacer()
        }
        .padding(BrambleMetrics.Screen.shellPadding)
    }
}

/// `tokenDiscoverFlow`: scan the registry for held tokens; nothing is added until Add is tapped.
struct DiscoverTokensView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    /// What the last successful scan found; meaningful only once `scanned` is set.
    @State private var found: [TokenBalance] = []
    @State private var scanned = false
    @State private var status: String?
    @State private var failed = false
    @State private var busy = false
    @State private var adding: String?

    private static let scanNotice =
        "Nothing is added until the scan identifies a balance. Likely-spam tokens remain hidden from Home."

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(
                    title: "Find held tokens",
                    subtitle: "Scan the Starknet token registry",
                    network: store.networkLabel
                ) { dismiss() }
                Text(Self.scanNotice)
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                PillButton("Scan for tokens", icon: .refresh, busy: busy) { Task { await scan() } }
                if scanned {
                    if found.isEmpty {
                        EmptyState(message: "No new tokens found in this account.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(found, id: \.token.id) { balance in suggestion(balance) }
                        }
                    }
                }
                StatusLine(text: status, tone: failed ? .danger : .muted)
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
    }

    private func scan() async {
        busy = true
        defer { busy = false }
        switch await store.portfolio.discoverTokens() {
        case let .success(tokens):
            found = tokens
            scanned = true
            failed = false
            status = tokens.isEmpty ? "No new tokens found." : "\(tokens.count) found."

        case let .failure(failure):
            failed = true
            status = failure.message
            store.toast = failure.message
        }
    }

    private func suggestion(_ balance: TokenBalance) -> some View {
        HStack(spacing: BrambleSpace.md) {
            TokenGlyphView(glyph: tokenGlyph(address: balance.token.address, symbol: balance.token.symbol))
            VStack(alignment: .leading, spacing: TokenListLayout.lineSpacing) {
                Text(balance.token.symbol).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                Text("\(compactAmount(formatted: balance.formatted, places: nil)) \(balance.token.symbol)")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            Spacer()
            Button {
                Task {
                    adding = balance.token.id
                    let failure = await store.portfolio.addToken(balance.token.address)
                    adding = nil
                    if let failure {
                        store.toast = failure
                    } else {
                        found.removeAll { $0.token.id == balance.token.id }
                        store.notify("Token added")
                    }
                }
            } label: {
                Text("Add")
                    .brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium)
                    .foregroundStyle(skin.text)
                    .padding(.horizontal, BrambleSpace.md)
                    .frame(minHeight: TokenListLayout.capsuleButtonHeight)
            }
            .buttonStyle(FillPressStyle(fill: skin.elevated, pressed: skin.softPress, shape: Capsule()))
            .disabled(adding != nil)
            .accessibilityLabel("Add \(balance.token.symbol)")
        }
        .padding(.vertical, BrambleSpace.sm)
    }
}
