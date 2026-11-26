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
    /// Hex digits per group, as the extension renders the hash for comparison.
    static let hashGroup = 4

    static func title(_ stage: LedgerSigner.Stage) -> String {
        switch stage {
        case .idle, .bluetooth, .scanning:
            "Ledger connection needed"

        case .connecting:
            "Connecting securely"

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

        case .scanning:
            StatusLine(text: LedgerCopy.lede)
            LedgerDeviceList(devices: signer.devices) { signer.choose($0) }

        case let .connecting(device):
            StatusLine(text: "Connecting to \(device.name)…")
            StatusLine(text: "If asked, confirm the pairing code on both devices.")

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
