import BrambleCore
import SwiftUI

/// The Home Shield tile (`wallet-shell.ts` `shieldTile`). Label and accessibility label are the
/// extension's; the tap follows mobile/docs/privacy.md §2.1 (deploy and every write suppressed).
struct ShieldActionTile: View {
    @Environment(WalletStore.self) private var store
    let receive: () -> Void
    let journey: () -> Void

    var body: some View {
        let tile = store.shieldTileState
        ActionTile(title: tile.copy.label, icon: .shield, action: tile == .fundFirst ? receive : journey)
            .disabled(tile == .noStrkToken || store.account == nil)
            .accessibilityLabel(tile.copy.accessibility)
    }
}

/// `.hero-stale`: "Includes shielded balances" under the total.
struct ShieldedHeroLabel: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin

    var body: some View {
        if store.includesShieldedBalances {
            HStack(spacing: BrambleSpace.xs) {
                BrambleIcon(.lock, size: 12)
                Text(PrivacyCopy.heroShielded).brambleText(BrambleTypeScale.caption)
            }
            .foregroundStyle(skin.muted)
            .frame(maxWidth: .infinity)
        }
    }
}

/// `.token-unified`: the summed amount, expanding to the public/private breakdown.
struct UnifiedTokenRow: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var expanded = false
    let row: UnifiedBalance
    let receive: () -> Void
    let journey: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button { expanded.toggle() } label: {
                HStack(spacing: BrambleSpace.md) {
                    TokenMark(address: row.tokenAddress, symbol: row.symbol)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.symbol).brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
                        Text(row.compact).brambleText(BrambleTypeScale.body).monospacedDigit().foregroundStyle(skin.muted)
                    }
                    Spacer()
                    Text("—").brambleText(BrambleTypeScale.row, weight: BrambleWeight.bold)
                }
                .padding(.horizontal, BrambleSpace.sm)
                .padding(.vertical, BrambleSpace.md)
                .frame(minHeight: BrambleSize.rowCompact)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show \(row.symbol) balance breakdown")
            if expanded {
                VStack(spacing: BrambleSpace.xs) {
                    breakdown(label: PrivacyCopy.publicBalance, value: "\(row.publicCompact) \(row.symbol)", lock: false)
                    privateLine
                }
                .padding(.horizontal, BrambleSpace.sm)
                .padding(.bottom, BrambleSpace.md)
            }
        }
    }

    private func breakdown(label: String, value: String, lock: Bool, muted: Bool = false) -> some View {
        HStack {
            HStack(spacing: BrambleSpace.xs) {
                if lock { BrambleIcon(.lock, size: 12) }
                Text(label)
            }
            .foregroundStyle(skin.muted)
            Spacer()
            Text(value).foregroundStyle(muted ? skin.muted : skin.text)
        }
        .brambleText(BrambleTypeScale.label)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var privateLine: some View {
        let line = store.privateLineFor(row.tokenAddress)
        switch line {
        case .fundWithStrk:
            Button(action: receive) { breakdown(label: PrivacyCopy.privateBalance, value: line.text, lock: true) }
                .buttonStyle(.plain)
        case .deployAndEnable, .registerToStart:
            Button(action: journey) { breakdown(label: PrivacyCopy.privateBalance, value: line.text, lock: true) }
                .buttonStyle(.plain)
        case .discovering, .unavailable:
            breakdown(label: PrivacyCopy.privateBalance, value: line.text, lock: true, muted: true)
        case .amount:
            breakdown(label: PrivacyCopy.privateBalance, value: line.text, lock: true)
        }
    }
}

/// `data-privacy-retry`: "Private balances · Try again" under the list after a failed read.
struct PrivacyRetryRow: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin

    var body: some View {
        if store.privacyHeaderStatus == .unavailable {
            Button { Task { await store.refreshPrivacy() } } label: {
                HStack {
                    HStack(spacing: BrambleSpace.xs) {
                        BrambleIcon(.lock, size: 12)
                        Text(PrivacyCopy.privateBalances)
                    }
                    Spacer()
                    Text(PrivacyCopy.retry)
                }
                .brambleText(BrambleTypeScale.label)
                .foregroundStyle(skin.muted)
                .padding(.horizontal, BrambleSpace.sm)
                .frame(minHeight: BrambleControl.hit)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(PrivacyCopy.privateBalances), \(PrivacyCopy.retry)")
        }
    }
}

/// Receive's `privacyPoolNotice`: only on a settled unregistered reading. The register variant
/// opens the journey (which ends at the Unsupported blocker); deploy-first shows its text with
/// the deploy action suppressed; fund-first is static.
struct PoolNoticeView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin

    var body: some View {
        if let copy = store.poolNotice.copy {
            if copy.action == nil {
                notice(copy.body, action: nil)
            } else {
                NavigationLink(value: WalletShell.Flow.privacy) { notice(copy.body, action: copy.action) }
                    .buttonStyle(.plain)
            }
        }
    }

    private func notice(_ body: String, action: String?) -> some View {
        HStack(spacing: BrambleSpace.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(PrivacyCopy.noticeTitle).fontWeight(.semibold).foregroundStyle(skin.text)
                Text(body)
            }
            Spacer(minLength: 0)
            if let action { Text(action).fontWeight(.semibold).foregroundStyle(skin.text) }
        }
        .brambleText(BrambleTypeScale.caption)
        .foregroundStyle(skin.muted)
        .padding(.vertical, BrambleSpace.sm)
        .padding(.horizontal, BrambleSpace.md)
        .background(skin.panel, in: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
