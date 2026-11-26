import BrambleCore
import SwiftUI
import UIKit

/// The words of the Ledger connect and pick screens, shared by onboarding and Add account.
enum LedgerCopy {
    static let connectTitle = "Connect a Ledger"
    static let pickTitle = "Select accounts"
    static let lede = "Unlock your Ledger and open the Starknet app."
    static let optionDetail = "Connect a Ledger and pick its accounts."

    /// The screen's heading for `stage`.
    static func title(_ stage: LedgerConnectModel.Stage) -> String {
        stage == .picking ? pickTitle : connectTitle
    }

    /// The lede under the heading; the picker needs none.
    static func lede(_ stage: LedgerConnectModel.Stage) -> String {
        stage == .picking ? "" : lede
    }

    /// Why nothing is listed while Bluetooth is not on; nil while its state is unknown.
    static func bluetooth(_ state: LedgerBluetooth) -> String? {
        switch state {
        case .off:
            "Turn on Bluetooth to find your Ledger."

        case .unauthorized:
            "Bramble can't use Bluetooth. Allow it in Settings."

        case .unsupported:
            "This device doesn't support Bluetooth."

        case .unknown, .ready:
            nil
        }
    }
}

/// The stage's content: Bluetooth's state, the Ledgers found, progress, a failure with Try again,
/// or the account list with "Show more".
struct LedgerConnectContent: View {
    let model: LedgerConnectModel

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
            switch model.stage {
            case let .bluetooth(state):
                StatusLine(text: LedgerCopy.bluetooth(state), tone: state == .unknown ? .muted : .danger)
                if state == .unauthorized {
                    PillButton("Open Settings", kind: .secondary) {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                }

            case .scanning:
                devices

            case let .connecting(device):
                StatusLine(text: "Connecting to \(device.name)…")
                StatusLine(text: "If asked, confirm the pairing code on both devices.")

            case .reading:
                StatusLine(text: "Reading accounts…")

            case let .failed(message):
                ErrorPanel(message: message, retryHint: "Look for your Ledger again") { model.retry() }

            case .picking:
                LedgerAccountList(model: model)
            }
        }
    }

    private var devices: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            Eyebrow(text: "Ledgers nearby")
            if model.devices.isEmpty {
                StatusLine(text: "Searching…")
            } else {
                MenuGroup {
                    ForEach(model.devices) { device in
                        MenuRow(icon: .shield, title: device.name) {
                            Task { await model.choose(device) }
                        }
                        .accessibilityIdentifier("ledger-device")
                    }
                }
            }
        }
    }
}

/// The CTA: the confirm button while picking (`title`, enabled with a pick), nothing otherwise.
struct LedgerConnectAction: View {
    let model: LedgerConnectModel
    let title: String
    var busy = false
    let confirm: ([LedgerAccountRequest]) -> Void

    var body: some View {
        if model.stage == .picking {
            PillButton(title, busy: busy) { confirm(model.chosen) }
                .disabled(model.chosen.isEmpty || model.loadingMore)
        }
    }
}

/// `ledgerAccountPicker`: Bramble accounts read off the device, each a checkbox; one already in
/// the wallet is shown but cannot be picked.
private struct LedgerAccountList: View {
    @Environment(\.skin) private var skin
    let model: LedgerConnectModel

    private enum Layout {
        static let checkBoxTop: CGFloat = 2
        static let copyGap: CGFloat = 2
        static let unselectableOpacity = 0.5
    }

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            ForEach(model.candidates, id: \.address) { row($0) }
            PillButton("Show more", kind: .secondary, busy: model.loadingMore) {
                Task { await model.more() }
            }
        }
    }

    private func row(_ candidate: LedgerCandidate) -> some View {
        let existing = model.isExisting(candidate)
        let checked = model.selected.contains(candidate.address)
        let title = "Account \(candidate.request.accountIndex)"
        let address = accountLabel(address: candidate.address)
        return Button { model.toggle(candidate) } label: {
            HStack(alignment: .top, spacing: BrambleSpace.sm) {
                CheckBox(isOn: checked).padding(.top, Layout.checkBoxTop)
                VStack(alignment: .leading, spacing: Layout.copyGap) {
                    Text(title).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    Text(address).brambleText(BrambleTypeScale.caption, mono: true).foregroundStyle(skin.muted)
                    if existing {
                        Text("Already in this wallet").brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, BrambleSpace.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(existing)
        .opacity(existing ? Layout.unselectableOpacity : 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(address)")
        .accessibilityValue(existing ? "Already in this wallet" : "")
        .accessibilityAddTraits(checked ? [.isButton, .isSelected] : .isButton)
    }
}

extension LedgerConnectModel {
    /// The live model: CoreBluetooth, a new link and driver per connection, and Bramble
    /// (OpenZeppelin) accounts placed on `network`.
    static func live(network: NetworkId, existing: Set<String>) -> LedgerConnectModel {
        LedgerConnectModel(
            scanner: LedgerBleScanner(),
            connect: { id in
                let link = LedgerBleLink()
                try await link.connect(id)
                return LedgerBleDriver(link: link)
            },
            place: { keys in try ledgerAccountCandidates(network: network, family: .openZeppelin, keys: keys) },
            existing: existing
        )
    }
}
