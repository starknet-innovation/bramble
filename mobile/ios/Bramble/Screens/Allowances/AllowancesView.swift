import BrambleCore
import SwiftUI

/// `allowancesFlow` (`allowance-views.ts`, bound by `bindAllowances`): every outstanding ERC-20
/// allowance of the active account on this network, the spender first with a copy control, the
/// amount, contract and source on one quiet line under it, and a Revoke control on each row the
/// wallet can revoke. What the listing could not vouch for is said above the list, and above
/// "none found" too. Opened from Settings › Token allowances; Revoke opens `RevokeAllowanceView`,
/// and the list is read again each time it shows.
struct AllowancesView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var state: AllowanceListState = .loading
    @State private var scopeOpen = false
    /// Opens the revoke of one listed allowance.
    let revoke: (AllowanceView) -> Void

    /// The header's count: nothing while reading, "Not loaded" without an answer.
    private var subtitle: String? {
        switch state {
        case .loading:
            nil

        case .unavailable:
            AllowanceCopy.notLoaded

        case let .loaded(list):
            AllowanceCopy.outstanding.replacingOccurrences(of: "{count}", with: String(list.allowances.count))
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(title: AllowanceCopy.title, subtitle: subtitle, network: store.networkLabel) { dismiss() }
                HStack(alignment: .top, spacing: BrambleSpace.sm) {
                    Text(AllowanceCopy.lede)
                        .brambleText(BrambleTypeScale.body)
                        .foregroundStyle(skin.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    IconButton(icon: .refresh, label: AllowanceCopy.refresh) { Task { await load() } }
                        .disabled(state == .loading)
                }
                Disclosure(title: AllowanceCopy.scopeTitle, isOpen: $scopeOpen) {
                    Text(AllowanceCopy.scopeBody)
                        .brambleText(BrambleTypeScale.caption)
                        .foregroundStyle(skin.muted)
                }
                content
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if store.account == nil {
            EmptyState(message: AllowanceCopy.noAccount)
        } else {
            switch state {
            case .loading:
                EmptyState(message: AllowanceCopy.loading)

            case .unavailable:
                EmptyState(message: AllowanceCopy.unavailable)

            case let .loaded(list):
                ForEach(list.notices, id: \.self) { notice in
                    StatusLine(text: AllowanceCopy.notice(notice))
                }
                if list.allowances.isEmpty {
                    EmptyState(message: AllowanceCopy.noneFound)
                } else {
                    MenuGroup {
                        ForEach(list.allowances, id: \.id) { allowance in
                            AllowanceRow(allowance: allowance, tokens: store.allowanceTokens) {
                                revoke(allowance)
                            }
                        }
                    }
                }
            }
        }
    }

    private func load() async {
        state = .loading
        state = await store.loadAllowances()
    }
}

/// The shell's allowance flow: the list, or one listed allowance's revoke. `open` pushes a
/// revoke; `exit` closes every flow (View in Activity).
struct AllowancesDestination: View {
    let revoking: AllowanceView?
    let open: (AllowanceView) -> Void
    let exit: () -> Void

    var body: some View {
        if let revoking {
            RevokeAllowanceView(allowance: revoking, exit: exit)
        } else {
            AllowancesView(revoke: open)
        }
    }
}

/// `allowanceRow`: the spender (truncated, copyable), the amount line with the token contract's
/// copy control, the unconfirmed-contract and pending-revoke notes, and Revoke where it can work.
private struct AllowanceRow: View {
    @Environment(\.skin) private var skin
    let allowance: AllowanceView
    let tokens: [TokenConfig]
    let revoke: () -> Void

    var body: some View {
        let token = AllowanceCopy.token(allowance.token, in: tokens)
        HStack(alignment: .center, spacing: BrambleSpace.sm) {
            VStack(alignment: .leading, spacing: BrambleSpace.xxs) {
                HStack(spacing: BrambleSpace.xs) {
                    Text(shortAddress(allowance.spender))
                        .brambleText(BrambleTypeScale.mono, mono: true)
                        .foregroundStyle(skin.text)
                    CopyButton(value: allowance.spender, label: AllowanceCopy.copySpender)
                }
                HStack(spacing: BrambleSpace.xs) {
                    Text(AllowanceCopy.detail(allowance, token: token))
                        .brambleText(BrambleTypeScale.caption)
                        .foregroundStyle(skin.muted)
                    CopyButton(value: allowance.token, label: AllowanceCopy.copyTokenContract)
                }
                if allowance.unconfirmedToken {
                    note(AllowanceCopy.unconfirmedToken)
                }
                if allowance.revoking {
                    note(AllowanceCopy.revoking)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if AllowanceCopy.canRevoke(allowance) {
                PillButton(AllowanceCopy.revoke, kind: .danger, small: true, action: revoke)
                    .fixedSize()
                    .accessibilityIdentifier("revoke-\(allowance.id)")
            }
        }
        .padding(BrambleMetrics.MenuRow.padding)
        .padding(.vertical, BrambleSpace.md)
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .brambleText(BrambleTypeScale.caption)
            .foregroundStyle(skin.muted)
            .fixedSize(horizontal: false, vertical: true)
    }
}
