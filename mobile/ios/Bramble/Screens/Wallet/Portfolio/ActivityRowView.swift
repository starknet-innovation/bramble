import BrambleCore
import SwiftUI

/// `transactionRow` (`home-tabs.ts`): a disclosure. The summary is the kind glyph, the heading that
/// joins the verb and the amount ("Received 1.5 STRK"), the status word for a row that is not
/// accepted, the token mark, and the truncated hash (linked to the explorer when the network has
/// one) with its copy control. Opening it lists the counterparty (or a detail line), the network and
/// the token's contract (`activityRecordFacts` in `activity-detail.ts`), when it was submitted, and
/// the provisional-status hint. No fiat figure: a value computed from today's price is not what the
/// transaction was worth. Every value is the core's: `ActivityRow`, and for the network and the
/// token contract the stored `ActivityEntry` the row was built from.
struct ActivityRowView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let row: ActivityRow
    /// The stored record `row` was built from.
    let entry: ActivityEntry
    @State private var open = false

    private enum Layout {
        /// Size of the kind glyph beside the heading.
        static let glyphSize: CGFloat = 16
        /// Opacity of a settled row's glyph tint over its muted backing glyph.
        static let settledGlyphOpacity: Double = 0.27
        /// Opacity of the glyph while the transaction is preconfirmed.
        static let preconfirmedOpacity: Double = 0.68
        /// Gap between a truncated value and its copy control.
        static let copyGap: CGFloat = 2
        /// The disclosure mark turns to point down while the row is open.
        static let openMarkDegrees: Double = 90
    }

    /// The expansion's fact labels (`request-detail`); no generated table carries them.
    private enum FactLabel {
        static let detail = "Detail"
        static let network = "Network"
        static let tokenContract = "Token contract"
        static let copyTokenContract = "Copy token contract address"
        static let submitted = "Submitted"
        static let status = "Status"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            summary
            hashRow.padding(.leading, Layout.glyphSize + BrambleSpace.sm)
            if open {
                facts.padding(.leading, Layout.glyphSize + BrambleSpace.sm)
            }
        }
        .padding(.vertical, BrambleSpace.sm)
        .padding(.horizontal, BrambleSpace.lg)
        .help(row.timing)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity-row-\(row.hash)")
    }

    private var tone: Color {
        switch row.tone {
        case .settled:
            skin.muted

        case .pending:
            skin.warning

        case .preconfirmed:
            skin.positive

        case .failed:
            skin.danger
        }
    }

    /// The disclosure's summary line: one control that opens and closes the row.
    private var summary: some View {
        Button(action: toggle) {
            HStack(spacing: BrambleSpace.sm) {
                glyph
                Text(row.heading)
                    .brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium)
                    .foregroundStyle(skin.text)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let word = row.statusWord {
                    Text(word)
                        .brambleText(
                            BrambleTypeScale.caption,
                            weight: BrambleWeight.medium,
                            tracking: BrambleTracking.caption
                        )
                        .foregroundStyle(tone)
                        .lineLimit(1)
                }
                TokenGlyphView(glyph: row.avatar, size: BrambleSize.avatar)
                BrambleIcon(.chevronRight)
                    .foregroundStyle(skin.muted)
                    .rotationEffect(.degrees(open ? Layout.openMarkDegrees : 0))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.accessibilityLabel)
        .accessibilityValue(open ? "Expanded" : "Collapsed")
        .accessibilityAddTraits(.isButton)
    }

    /// The kind glyph, hidden from assistive tech; its tooltip is the core's `glyphTitle`.
    private var glyph: some View {
        BrambleIcon(BrambleIconName(rawValue: "Icons/\(row.icon)") ?? .layoutGrid, size: Layout.glyphSize)
            .foregroundStyle(row.tone == .settled ? skin.text.opacity(Layout.settledGlyphOpacity) : tone)
            .background {
                if row.tone == .settled {
                    BrambleIcon(BrambleIconName(rawValue: "Icons/\(row.icon)") ?? .layoutGrid, size: Layout.glyphSize)
                        .foregroundStyle(skin.muted)
                }
            }
            .opacity(row.tone == .preconfirmed ? Layout.preconfirmedOpacity : 1)
            .help(row.glyphTitle)
            .accessibilityHidden(true)
    }

    /// `.tx-hash-row`: the truncated hash, linked to the explorer when there is one (opened in the
    /// system browser), and the control that copies it in full.
    private var hashRow: some View {
        HStack(spacing: Layout.copyGap) {
            if let link = row.explorerUrl.flatMap(URL.init(string:)) {
                Link(destination: link) { hashText }
                    .accessibilityLabel(SendCopy.explorerLinkLabel)
                    .accessibilityValue(link.absoluteString)
                    .accessibilityIdentifier("activity-link-\(row.hash)")
            } else {
                hashText.accessibilityValue(row.hash)
            }
            // The one clipboard path: local-only, expiring, "Copied" through `store.notify`.
            CopyButton(value: row.hash, label: row.hashCopyLabel)
        }
    }

    private var hashText: some View {
        Text(row.hashLabel)
            .brambleText(BrambleTypeScale.caption, mono: true)
            .foregroundStyle(skin.muted)
            .lineLimit(1)
    }

    /// The expansion (`.request-detail`): the counterparty or the detail line, the record's
    /// network and token contract, the submission time, and the provisional hint, each only when
    /// recorded.
    private var facts: some View {
        let network = store.networkName(of: entry.network)
        return VStack(spacing: 0) {
            if let counterparty = row.counterparty {
                fact(counterparty.role) {
                    identifier(counterparty.addressLabel, copies: counterparty.address, label: counterparty.copyLabel)
                }
            } else if let detail = row.detail {
                fact(FactLabel.detail) { factText(detail) }
            }
            if !network.isEmpty {
                fact(FactLabel.network) { factText(network) }
            }
            if let contract = entry.tokenAddress {
                fact(FactLabel.tokenContract) {
                    identifier(contract, copies: contract, label: FactLabel.copyTokenContract)
                }
            }
            if let submitted = row.submitted {
                fact(FactLabel.submitted) { factText(submitted) }
            }
            if let hint = row.statusHint {
                fact(FactLabel.status) { factText(hint) }
            }
        }
    }

    private func fact<Value: View>(_ label: String, @ViewBuilder value: () -> Value) -> some View {
        HStack(alignment: .center, spacing: BrambleSpace.md) {
            Text(label)
                .brambleText(BrambleTypeScale.label)
                .foregroundStyle(skin.muted)
            Spacer(minLength: 0)
            value()
        }
        .frame(minHeight: BrambleControl.hit)
        .accessibilityElement(children: .contain)
    }

    /// A whole address with the control that copies it (`identifier` in `activity-detail.ts`).
    /// The one clipboard path: a public address only, local-only and expiring.
    private func identifier(_ shown: String, copies value: String, label: String) -> some View {
        HStack(spacing: Layout.copyGap) {
            Text(shown)
                .brambleText(BrambleTypeScale.caption, mono: true)
                .foregroundStyle(skin.text)
                .accessibilityValue(value)
            CopyButton(value: value, label: label)
        }
    }

    private func factText(_ text: String) -> some View {
        Text(text)
            .brambleText(BrambleTypeScale.label)
            .foregroundStyle(skin.text)
            .multilineTextAlignment(.trailing)
    }

    private func toggle() {
        let motion = BrambleMotionPolicy.animation(
            BrambleEase.out.animation(ms: BrambleMotion.tabMs),
            reduceMotion: reduceMotion
        )
        withAnimation(motion) { open.toggle() }
    }
}
