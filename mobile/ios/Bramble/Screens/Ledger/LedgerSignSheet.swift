import BrambleCore
import SwiftUI

/// The words of the Ledger signing sheet: the extension's `ledgerSign.*` signing text
/// (`review-sign.ts`), with the browser's connect steps in Bluetooth wording. Approval and signing
/// sentences: edit them as a reviewed group, against "did we lose a fact?".
enum LedgerSignCopy {
    static let hashLabel = "Hash shown on your Ledger"
    static let hashHelp = "Approve only if this matches your device, character for character."
    static let confirmingBody = "Approve the request on your Ledger."
    static let verifyingBody = "Checking this is the right Ledger."
    static let notSigned = "The transaction has not been signed or broadcast."
    static let cancel = "Cancel transaction"
    static let tryAgain = "Try again"
    static let copyHash = "Copy transaction hash"
    static let signingWith = "Signing with"
    static let copyAddress = "Copy signing account address"
    /// Under the connect stages: nothing has been signed or sent while the Ledger is found.
    static let paused = "The transaction is safely paused."
    /// Hex digits per group, as the extension renders the hash for comparison.
    static let hashGroup = 4

    /// `ledgerSign.account`: the account's index on the Ledger.
    static func account(_ index: UInt32) -> String { "Account \(index)" }

    /// The signer line as one sentence (its accessibility label): "Signing with 0x1234…abcd ·
    /// Account 0"; the index only for a Ledger record.
    static func signer(_ account: AccountRecord) -> String {
        let index = account.ledger ? " · " + Self.account(account.accountIndex) : ""
        return "\(signingWith) \(account.shortAddress)\(index)"
    }

    /// The line under the connect stages; nil once a Ledger is connecting.
    static func connectNote(_ stage: LedgerSigner.Stage) -> String? {
        switch stage {
        case .bluetooth, .scanning:
            paused

        default:
            nil
        }
    }

    static func title(_ stage: LedgerSigner.Stage) -> String {
        switch stage {
        case .idle, .bluetooth, .scanning:
            "Ledger connection needed"

        case .connecting:
            "Connecting securely"

        case .deviceCheck:
            "Checking your Ledger"

        case .checking:
            "Verifying the right account"

        case .confirming:
            "Approve on your Ledger"

        case .refused:
            "Ledger needs attention"
        }
    }

    /// `0x` and the 64 digits in groups of four; the copied value stays unbroken.
    static func grouped(_ hash: String) -> String {
        let digits = Array(hash.dropFirst("0x".count))
        let groups = stride(from: 0, to: digits.count, by: hashGroup).map { start in
            String(digits[start ..< min(start + hashGroup, digits.count)])
        }
        return "0x " + groups.joined(separator: " ")
    }
}

/// "Confirm on your Ledger": the sheet every Ledger signature passes through, driven by
/// `LedgerSigner`. It cannot be swiped away; Cancel transaction closes the plan.
struct LedgerSignSheet: View {
    @Environment(\.skin) private var skin
    let signer: LedgerSigner

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleMetrics.Drawer.gap) {
                Text(LedgerSignCopy.title(signer.stage))
                    .brambleText(BrambleTypeScale.title, weight: BrambleWeight.semibold)
                    .accessibilityAddTraits(.isHeader)
                if let account = signer.account { signerLine(account) }
                content
                actions
            }
            .padding(BrambleMetrics.Drawer.padding)
        }
        .background(skin.bg.ignoresSafeArea())
        .interactiveDismissDisabled()
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private var content: some View {
        switch signer.stage {
        case .idle:
            EmptyView()

        case let .bluetooth(state):
            StatusLine(text: LedgerCopy.bluetooth(state), tone: state == .unknown ? .muted : .danger)
            StatusLine(text: LedgerSignCopy.connectNote(signer.stage))

        case .scanning:
            StatusLine(text: LedgerCopy.lede)
            LedgerDeviceList(devices: signer.devices) { signer.choose($0) }
            StatusLine(text: LedgerSignCopy.connectNote(signer.stage))

        case let .connecting(device):
            StatusLine(text: "Connecting to \(device.name)…")
            StatusLine(text: "If asked, confirm the pairing code on both devices.")

        case let .deviceCheck(phase):
            StatusLine(text: LedgerCopy.checking(phase))

        case .checking:
            StatusLine(text: LedgerSignCopy.verifyingBody)

        case let .confirming(hash):
            StatusLine(text: LedgerSignCopy.confirmingBody)
            hashCheck(hash)

        case let .refused(message):
            StatusLine(text: message, tone: .danger)
                .accessibilityAddTraits(.isStaticText)
            StatusLine(text: LedgerSignCopy.notSigned)
        }
    }

    /// `signerLine`: "Signing with", the account's 6…4 address with its copy control, and its
    /// index on the Ledger.
    private func signerLine(_ account: AccountRecord) -> some View {
        HStack(spacing: BrambleSpace.xs) {
            Text(LedgerSignCopy.signingWith).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            Text(account.shortAddress)
                .brambleText(BrambleTypeScale.caption, mono: true)
                .accessibilityLabel(LedgerSignCopy.signer(account))
                .accessibilityIdentifier("ledger-sign-account")
            CopyButton(value: account.address, label: LedgerSignCopy.copyAddress)
            if account.ledger {
                Text(LedgerSignCopy.account(account.accountIndex))
                    .brambleText(BrambleTypeScale.caption)
                    .foregroundStyle(skin.muted)
            }
            Spacer(minLength: 0)
        }
    }

    private func hashCheck(_ hash: String) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            HStack {
                Eyebrow(text: LedgerSignCopy.hashLabel)
                Spacer(minLength: 0)
                CopyButton(value: hash, label: LedgerSignCopy.copyHash)
            }
            Text(LedgerSignCopy.grouped(hash))
                .brambleText(BrambleTypeScale.mono, mono: true)
                .textSelection(.enabled)
                .accessibilityIdentifier("ledger-sign-hash")
            StatusLine(text: LedgerSignCopy.hashHelp)
        }
    }

    @ViewBuilder private var actions: some View {
        if case .refused = signer.stage {
            PillButton(LedgerSignCopy.tryAgain, kind: .secondary) { signer.retry() }
        }
        PillButton(LedgerSignCopy.cancel, kind: .secondary) { signer.cancel() }
            .accessibilityIdentifier("ledger-sign-cancel")
    }
}

extension View {
    /// Presents the Ledger signing sheet whenever a plan waits on the device. Applied by every
    /// screen that hosts a signing flow, including one inside a sheet of its own.
    func ledgerSigning(_ signer: LedgerSigner = .shared) -> some View {
        modifier(LedgerSigningPresenter(signer: signer))
    }
}

private struct LedgerSigningPresenter: ViewModifier {
    @Environment(WalletStore.self) private var store
    let signer: LedgerSigner

    func body(content: Content) -> some View {
        content.sheet(isPresented: Binding(get: { signer.active }, set: { if !$0 { signer.cancel() } })) {
            SkinProvider { LedgerSignSheet(signer: signer) }
                .environment(store)
        }
    }
}
