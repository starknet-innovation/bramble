import BrambleCore
import SwiftUI

/// The lock glyph beside private-balance labels, smaller than the standard icon.
private let privacyLockIconSize: CGFloat = 12

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
            HStack(spacing: BrambleMetrics.Hero.gap) {
                BrambleIcon(.lock, size: privacyLockIconSize)
                Text(PrivacyCopy.heroShielded).brambleText(BrambleTypeScale.caption)
            }
            .foregroundStyle(skin.muted)
            .frame(maxWidth: .infinity)
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
                        BrambleIcon(.lock, size: privacyLockIconSize)
                        Text(PrivacyCopy.privateBalances)
                    }
                    Spacer()
                    Text(PrivacyCopy.retry)
                }
                .brambleText(BrambleTypeScale.label)
                .foregroundStyle(skin.muted)
                .padding(BrambleMetrics.TokenRow.padding)
                .frame(minHeight: BrambleControl.hit)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(PrivacyCopy.privateBalances), \(PrivacyCopy.retry)")
        }
    }
}

/// Receive's `privacyPoolNotice`: only on a settled unregistered reading, as design-mobile's
/// `Callout`. The register variant opens the journey (which ends at the Unsupported blocker);
/// deploy-first shows its text with the deploy action suppressed; fund-first is static.
struct PoolNoticeView: View {
    @Environment(WalletStore.self) private var store

    var body: some View {
        if let copy = store.poolNotice.copy {
            if let action = copy.action {
                NavigationLink(value: WalletShell.Flow.privacy) {
                    Callout(icon: .shield, title: PrivacyCopy.noticeTitle, message: "\(copy.body) \(action)")
                }
                .buttonStyle(.plain)
            } else {
                Callout(icon: .shield, title: PrivacyCopy.noticeTitle, message: copy.body)
            }
        }
    }
}
