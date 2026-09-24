import BrambleCore
import Observation
import SwiftUI

/// Which screen the privacy journey shows (`privacy-views.ts` `preparing` / `blocked`).
enum PrivacyJourneyScreen: Equatable {
    case preparing
    case blocked(PrivacyBlocker, hint: String?)
}

/// `startJourney` / `continueJourney`, decided by the core's `privacyEntry`: the host only reads
/// what an answer asks for (the deployment, or a fresh private-balance read) and asks again.
/// Registration and shielding are not built on mobile (docs/privacy.md §1, §9): where the extension
/// would start them, the core answers `unsupported`.
@MainActor
@Observable
final class PrivacyJourney {
    private(set) var screen: PrivacyJourneyScreen = .preparing

    func start(_ store: WalletStore) async {
        screen = .preparing
        var deployment = store.deployment
        var afterRead = false
        guard let account = store.account else { return }
        while true {
            let entry = privacyEntry(
                network: store.network,
                deployment: deployment,
                reading: store.privacy.reading,
                afterRead: afterRead
            )
            switch entry {
            case let .blocked(blocker):
                screen = .blocked(blocker, hint: Self.hint(blocker))
                return

            case .checkDeployment:
                deployment = await store.rpc.deploymentState(of: account.address, on: store.networkInfo)
                if deployment == .unknown {
                    screen = .blocked(.service, hint: PrivacyCopy.deploymentUnchecked)
                    return
                }

            case .discovering:
                if afterRead {
                    screen = .blocked(.service, hint: PrivacyCopy.blockedServiceTitle)
                    return
                }
                await store.refreshPrivacy()
                afterRead = true
            }
        }
    }

    /// The reason line under a blocker. Service text is never shown, so a failed read carries the
    /// extension's fallback, "Private balances unavailable".
    private static func hint(_ blocker: PrivacyBlocker) -> String? {
        switch blocker {
        case .deploy:
            PrivacyCopy.deployRequired

        case .service:
            PrivacyCopy.blockedServiceTitle

        default:
            nil
        }
    }
}

/// The privacy flow screen: the preparing wait, or one blocker with its next step.
struct PrivacyJourneyView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var journey = PrivacyJourney()
    let chooseNetwork: () -> Void

    private enum Layout {
        /// Readable measure for the centred title's body copy.
        static let titleBodyMaxWidth: CGFloat = 320
    }

    private static let preparingTasks = [
        PrivacyCopy.preparingTask1,
        PrivacyCopy.preparingTask2,
        PrivacyCopy.preparingTask3,
        PrivacyCopy.preparingTask4
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: BrambleMetrics.Screen.gap) {
                FlowHeader(
                    title: PrivacyCopy.headerJourney,
                    subtitle: "STRK",
                    network: store.networkLabel
                ) { dismiss() }
                switch journey.screen {
                case .preparing:
                    preparing

                case let .blocked(blocker, hint):
                    blocked(blocker, hint: hint)
                }
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .task { await journey.start(store) }
    }

    private var preparing: some View {
        VStack(spacing: BrambleSpace.lg) {
            ProgressView().controlSize(.large)
            title(PrivacyCopy.preparingTitle, body: PrivacyCopy.preparingBody)
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                ForEach(Array(Self.preparingTasks.enumerated()), id: \.offset) { index, task in
                    HStack(spacing: BrambleSpace.md) {
                        Circle()
                            .fill(index == 0 ? skin.text : skin.elevated)
                            .frame(width: BrambleSpace.md, height: BrambleSpace.md)
                        Text(task)
                            .fontWeight(index == 0 ? .medium : .regular)
                            .foregroundStyle(index == 0 ? skin.text : skin.muted)
                    }
                    .brambleText(BrambleTypeScale.body)
                    .frame(minHeight: BrambleControl.hit)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(PrivacyCopy.preparingHint).brambleText(BrambleTypeScale.label).foregroundStyle(skin.muted)
            PillButton(PrivacyCopy.backToWallet, kind: .secondary) { dismiss() }
        }
        .accessibilityElement(children: .contain)
    }

    private func blocked(_ blocker: PrivacyBlocker, hint: String?) -> some View {
        let copy = blocker.copy
        return VStack(spacing: BrambleSpace.lg) {
            Medallion(icon: .shield)
            title(copy.title, body: copy.body)
            if let hint {
                Text(hint)
                    .brambleText(BrambleTypeScale.label)
                    .foregroundStyle(skin.muted)
                    .multilineTextAlignment(.center)
            }
            switch blocker {
            case .network:
                PillButton(copy.action, icon: .globe) { chooseNetwork() }

            case .service:
                PillButton(copy.action, icon: .refresh) { Task { await journey.start(store) } }

            default:
                // Deploy, fund, pending and unsupported offer no action on mobile (§2.5).
                EmptyView()
            }
            PillButton(PrivacyCopy.backToWallet, kind: .secondary) { dismiss() }
        }
    }

    private func title(_ title: String, body: String) -> some View {
        VStack(spacing: BrambleSpace.sm) {
            Text(title)
                .brambleText(
                    BrambleTypeScale.title.sized(BrambleMetrics.H2.size),
                    weight: BrambleMetrics.H2.weight,
                    tracking: BrambleMetrics.H2.tracking
                )
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(body)
                .brambleText(BrambleTypeScale.body)
                .foregroundStyle(skin.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: Layout.titleBodyMaxWidth)
        }
    }
}

/// Token detail's privacy section (`tokenDetailFlow` summary + `privacyActions`, §2.3), shown on
/// the portfolio's token-detail screen (`TokenDetailView`).
struct TokenPrivacySection: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let tokenAddress: String
    let receive: () -> Void
    let journey: () -> Void

    private static let lockIconSize: CGFloat = 12

    var body: some View {
        let detail = store.tokenDetailPrivacyFor(tokenAddress)
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            summary(detail.summary)
            switch detail.action {
            case .none:
                EmptyView()

            case .fundWithStrk:
                PillButton(PrivacyCopy.tileFundLabel, icon: .qrCode, action: receive)

            case .deployAndEnable:
                PillButton(PrivacyCopy.tileDeployLabel, icon: .shield, action: journey)

            case .goPrivate:
                PillButton(PrivacyCopy.detailGoPrivate, icon: .shield, action: journey)

            case .shieldUnshield:
                HStack(spacing: BrambleSpace.sm) {
                    PillButton(PrivacyCopy.detailShield, icon: .shield) {
                        // No action: shielding is not built on mobile, so the capability keeps this disabled.
                    }
                    .disabled(!privacyCapabilities().canShield)
                    PillButton(PrivacyCopy.detailUnshield, kind: .secondary) {
                        // No action: unshielding is not built on mobile, so the capability keeps this disabled.
                    }
                    .disabled(!privacyCapabilities().canUnshield)
                }
                Text(PrivacyCopy.unsupportedTitle).brambleText(BrambleTypeScale.label).foregroundStyle(skin.muted)
            }
        }
    }

    @ViewBuilder
    private func summary(_ summary: DetailSummary) -> some View {
        switch summary {
        case .none:
            EmptyView()

        case .retry:
            Button {
                Task { await store.refreshPrivacy() }
            } label: {
                line(PrivacyCopy.retry, muted: true)
            }
            .buttonStyle(.plain)

        case .registerToStart:
            line(PrivacyCopy.registerToStart, muted: true)

        case let .amount(text):
            line(text, muted: false)
        }
    }

    private func line(_ value: String, muted: Bool) -> some View {
        HStack {
            HStack(spacing: BrambleSpace.xs) {
                BrambleIcon(.lock, size: Self.lockIconSize)
                Text(PrivacyCopy.privateBalance)
            }
            .foregroundStyle(skin.muted)
            Spacer()
            Text(value).fontWeight(muted ? .regular : .bold).foregroundStyle(muted ? skin.muted : skin.text)
        }
        .brambleText(BrambleTypeScale.body)
        .accessibilityElement(children: .combine)
    }
}
