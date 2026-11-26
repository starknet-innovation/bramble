import BrambleCore
import SwiftUI
import UIKit

/// The words of the Ledger connect and pick screens, shared by onboarding and Add account.
@MainActor
enum LedgerCopy {
    static let connectTitle = "Connect a Ledger"
    static let lede = "Unlock your Ledger and open the Starknet app."
    static let optionDetail = "Connect a Ledger and pick its accounts."
    static let readyTitle = "Ready Ledger account"
    static let readyDetail = "Bring over a Ledger account created in Ready (Argent X)."

    /// The screen's heading (`pickerCopy` once the list shows).
    static func title(_ model: LedgerConnectModel?) -> String {
        guard let model, model.stage == .picking else { return connectTitle }
        return model.route == .ready ? "Select Ready accounts" : "Select accounts"
    }

    /// The lede under the heading.
    static func lede(_ model: LedgerConnectModel?) -> String {
        guard let model, model.stage == .picking else { return lede }
        return model.route == .ready
            ? "Accounts with activity are preselected. Yours may be a few pages in."
            : "Accounts with activity are preselected."
    }

    /// "N accounts detected", as Find your accounts says it; nil for none.
    static func detected(_ count: Int) -> String? {
        count > 0 ? "\(count) \(count == 1 ? "account" : "accounts") detected" : nil
    }

    /// What the screen says while Bluetooth is not ready.
    static func bluetooth(_ state: LedgerBluetooth) -> String? {
        switch state {
        case .off:
            "Turn on Bluetooth to find your Ledger."

        case .unauthorized:
            "Bramble can't use Bluetooth. Allow it in Settings."

        case .unsupported:
            "This device doesn't support Bluetooth."

        case .unknown:
            "Checking Bluetooth…"

        case .ready:
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

/// `ledgerAccountPicker`: the route's groups (Bramble and Argent or Ready accounts, each a
/// disclosure that opens once it has an active account), or Ready's one list, then "Show more".
private struct LedgerAccountList: View {
    let model: LedgerConnectModel
    @State private var opened: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
            ForEach(model.groups, id: \.title) { group in
                if model.route == .ready {
                    StatusLine(text: [group.title, LedgerCopy.detected(group.detected)].compactMap(\.self)
                        .joined(separator: " · "))
                    rows(group)
                } else {
                    disclosure(group)
                }
            }
            PillButton("Show more", kind: .secondary, busy: model.loadingMore) {
                Task { await model.more() }
            }
        }
    }

    private func disclosure(_ group: LedgerGroup) -> some View {
        let isOpen = Binding(
            get: { opened.contains(group.title) },
            set: { if $0 { opened.insert(group.title) } else { opened.remove(group.title) } }
        )
        return Disclosure(title: group.title, summary: LedgerCopy.detected(group.detected), isOpen: isOpen) {
            rows(group)
        }
        .onChange(of: group.detected, initial: true) { _, count in
            if count > 0 { opened.insert(group.title) }
        }
    }

    private func rows(_ group: LedgerGroup) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            ForEach(group.rows) { LedgerRowView(model: model, row: $0, namingPath: group.namingPath) }
        }
    }
}

/// `.select-row`: a checkbox, the title, the 6…4 address in mono and the row's status; a row that
/// cannot be picked is dimmed.
private struct LedgerRowView: View {
    @Environment(\.skin) private var skin
    let model: LedgerConnectModel
    let row: LedgerRow
    let namingPath: Bool

    private enum Layout {
        static let checkBoxTop: CGFloat = 2
        static let copyGap: CGFloat = 2
        static let unselectableOpacity = 0.5
    }

    var body: some View {
        let checked = model.selected.contains(row.id) && row.selectable
        let title = row.title(namingPath: namingPath)
        let address = accountLabel(address: row.candidate.address)
        Button { model.toggle(row) } label: {
            HStack(alignment: .top, spacing: BrambleSpace.sm) {
                CheckBox(isOn: checked).padding(.top, Layout.checkBoxTop)
                VStack(alignment: .leading, spacing: Layout.copyGap) {
                    Text(title).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    Text(address).brambleText(BrambleTypeScale.caption, mono: true).foregroundStyle(skin.muted)
                    Text(row.status).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, BrambleSpace.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!row.selectable)
        .opacity(row.selectable ? 1 : Layout.unselectableOpacity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(address)")
        .accessibilityValue(row.status)
        .accessibilityAddTraits(checked ? [.isButton, .isSelected] : .isButton)
    }
}

extension LedgerConnectModel {
    /// The live model for `route`: CoreBluetooth, a new link and driver per connection, accounts
    /// placed on `network`, and each address checked through `rpc` (deployed, and the network's
    /// known tokens, as the extension's `readLedgerAccountState`).
    static func live(
        route: LedgerRoute,
        network: NetworkInfo,
        rpc: RpcClient,
        existing: Set<String>
    ) -> LedgerConnectModel {
        LedgerConnectModel(
            route: route,
            scanner: LedgerBleScanner(),
            connect: { id in
                let link = LedgerBleLink()
                try await link.connect(id)
                return LedgerBleDriver(link: link)
            },
            place: { keys, family in
                try ledgerAccountCandidates(network: network.network, family: family, keys: keys)
            },
            describe: { address in await rpc.ledgerActivity(of: address, on: network) },
            existing: existing
        )
    }
}

extension RpcClient {
    /// `readLedgerAccountState`: deployed, and whether any of the network's known tokens is held.
    /// Each half is nil when its read failed; never throws.
    func ledgerActivity(of address: String, on network: NetworkInfo) async -> LedgerActivity {
        async let deployment = deploymentState(of: address, on: network)
        async let held = try? balances(of: address, on: network)
        let deployed: LedgerFact
        switch await deployment {
        case .deployed:
            deployed = .present

        case .undeployed:
            deployed = .absent

        case .unknown:
            deployed = .unknown
        }
        let funded: LedgerFact = await held.map { balances in
            balances.values.contains { $0.contains { $0 != "0" } } ? .present : .absent
        } ?? .unknown
        return LedgerActivity(deployed: deployed, funded: funded)
    }
}
