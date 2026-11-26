import BrambleCore
import SwiftUI

/// The typed-data sign card (the extension's `approval-cards.ts` sign card): the site and its
/// warnings, what it asks, the account that signs, the risks, the exact document, then Deny before
/// Sign. The core reviewed it for `sign.accountId` and re-checks everything at approval. A card
/// paying or approving a lookalike, or from a blocked site, can only be denied. Leave site denies
/// and closes the browser, so a site that keeps asking cannot hold the person on its card.
struct SignSheet: View {
    // ponytail: the extension has no tap delay; 500 ms against a page timing a tap onto Sign.
    private static let armDelayMs = 500

    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var armed = false
    let card: DappRequestSink.Card
    let sign: DappRequestSink.SignRequest
    /// True for Sign, false for Deny.
    let decide: (Bool) -> Void
    let leave: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
                Eyebrow(text: DappCopy.signTitle)
                Text(card.origin)
                    .brambleText(BrambleTypeScale.mono, weight: BrambleWeight.semibold, mono: true)
                    .accessibilityAddTraits(.isHeader)
                ForEach(card.warnings, id: \.self) { warning in
                    StatusLine(text: warning, tone: card.blocked ? .danger : .muted)
                }
                StatusLine(text: DappCopy.signHint)
                Text(sign.summary)
                    .brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                account
                StatusLine(text: DappCopy.signOutcome)
                ForEach(sign.calls, id: \.self) { StatusLine(text: $0) }
                ForEach(risks, id: \.self) { StatusLine(text: $0, tone: .danger) }
                Text(DappCopy.signRaw)
                    .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                    .foregroundStyle(skin.muted)
                Text(sign.document)
                    .brambleText(BrambleTypeScale.mono, mono: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(BrambleSpace.sm)
                    .background(skin.panel, in: FieldShape())
                StatusLine(text: DappCopy.signConstraints)
                decisions
                PillButton(DappCopy.leaveSite, kind: .ghost, action: leave)
            }
            .padding(BrambleMetrics.Screen.shellPadding)
        }
        .background(skin.bg.ignoresSafeArea())
        .task(id: card.id) {
            armed = false
            try? await Task.sleep(for: .milliseconds(Self.armDelayMs))
            armed = true
        }
    }

    /// The review's flags, then the outside-execution warning when it authorizes later calls.
    private var risks: [String] {
        sign.risks + (sign.outsideExecution ? [DappCopy.signOutsideExecution] : [])
    }

    private var account: some View {
        let record = store.records.first { $0.id == sign.accountId }
        return VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            Text(DappCopy.connectAccount)
                .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                .foregroundStyle(skin.muted)
            if let record {
                Text(record.displayName).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
            }
            Text(shortAddress(sign.address))
                .brambleText(BrambleTypeScale.mono, mono: true)
                .foregroundStyle(skin.muted)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var decisions: some View {
        if sign.poisoned {
            StatusLine(text: DappCopy.signWontSend, tone: .danger)
            PillButton(DappCopy.signDeny, kind: .secondary) { decide(false) }
        } else {
            HStack(spacing: BrambleSpace.sm) {
                PillButton(DappCopy.signDeny, kind: .secondary) { decide(false) }
                PillButton(DappCopy.signAction, icon: .check) { decide(true) }
                    .disabled(!armed || card.blocked || store.busy)
            }
        }
    }
}

/// Shown in place of a page the blocklist refused to load: the site and why, and Leave site.
struct BlockedSitePanel: View {
    let origin: String
    let leave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Text(origin)
                .brambleText(BrambleTypeScale.mono, weight: BrambleWeight.semibold, mono: true)
            StatusLine(text: DappCopy.siteInsightBlocklisted, tone: .danger)
            PillButton(DappCopy.leaveSite, kind: .secondary, action: leave)
        }
        .accessibilityIdentifier("browser-blocked")
    }
}
