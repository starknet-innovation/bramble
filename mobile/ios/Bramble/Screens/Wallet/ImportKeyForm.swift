import SwiftUI

/// `importAccountChooser`: the second stage of "Import an existing account". Mobile imports a
/// private key; another recovery phrase is shown as coming, as onboarding shows what it lacks.
/// "Find my other accounts" and "Ready Ledger account" are left out, as Ledger is on Add account.
struct ImportAccountChooser: View {
    let back: () -> Void
    let importKey: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Drawer.gap) {
            FlowHeader(title: "Import an existing account", back: back)
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
                OptionCard(icon: .book, title: "Recovery phrase", detail: "Coming to Bramble mobile.") {
                    // No action: another wallet's phrase is not offered yet, and the card is disabled.
                }
                    .disabled(true)
                OptionCard(
                    icon: .link,
                    title: "Private key",
                    detail: "Import a single account from its raw Starknet key.",
                    action: importKey
                )
            }
            Spacer(minLength: 0)
        }
    }
}

/// `importKeyFlow` (Bramble account only: the core imports no Ready key and takes no salt; the
/// extension's hint on how the vault stores the key is left out, per `COPY_STYLE.md` rules 4 and
/// 5). The key goes into `KeyTextView`: no correction, prediction or AutoFill, an ASCII keyboard
/// (third-party keyboards are blocked app-wide), no copy, cut, share or drag-out, blurred while the
/// screen is captured, and the clipboard emptied after a paste. A refused key stays for the user to
/// correct; the key leaves view state on success and when the form leaves the screen, and a lock
/// removes the wallet's screens with it.
struct ImportKeyForm: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let back: () -> Void
    let imported: () -> Void
    @State private var key = ""
    @State private var result: String?
    @State private var captured = false
    /// Set before the import's `Task` starts, so a second tap cannot pass while `store.busy` is
    /// still false and send the same key twice.
    @State private var submitting = false

    private static let fieldLabel = "Raw Starknet private key"
    /// Gap between the label and the field, as `BrambleTextArea`.
    private static let stackSpacing: CGFloat = 6

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
            FlowHeader(
                title: "Import private key",
                subtitle: "Add a standalone account on \(store.networkInfo.name)",
                back: back
            )
            Text("Anyone with this key controls the account.")
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.danger)
            Text("Your recovery phrase won’t restore this account. Keep a copy of this key.")
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.danger)
            VStack(alignment: .leading, spacing: Self.stackSpacing) {
                Text(Self.fieldLabel)
                    .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                    .foregroundStyle(skin.muted)
                    .accessibilityHidden(true)
                ZStack(alignment: .topLeading) {
                    if key.isEmpty {
                        Text("0x…")
                            .brambleText(BrambleTypeScale.mono, mono: true)
                            .foregroundStyle(skin.muted)
                            .accessibilityHidden(true)
                    }
                    KeyTextView(text: keyBinding, label: Self.fieldLabel, color: UIColor(skin.text))
                }
                .frame(minHeight: BrambleMetrics.Field.height, alignment: .topLeading)
                .padding(BrambleMetrics.Field.padding)
                .padding(.vertical, BrambleSpace.md)
                .background(skin.elevated, in: FieldShape())
            }
            .blur(radius: captured ? maskedWordBlur : 0)
            .privacySensitive()
            PillButton("Import account", icon: .wallet, busy: store.busy || submitting, action: submit)
            StatusLine(text: result, tone: .danger)
            Spacer(minLength: 0)
        }
        .trackingScreenCapture($captured)
        .onDisappear { key = "" }
    }

    /// A jump of more than one character is a paste: empty the clipboard (a write, never a read)
    /// so the key does not linger for other apps or Universal Clipboard.
    private var keyBinding: Binding<String> {
        Binding {
            key
        } set: { value in
            if value.count > key.count + 1 {
                UIPasteboard.general.items = []
                store.notify(BrambleCopy.clipboardCleared)
            }
            key = value
        }
    }

    private func submit() {
        guard !store.busy, !submitting else { return }
        let privateKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !privateKey.isEmpty else {
            result = "Enter a private key to import"
            return
        }
        result = nil
        submitting = true
        Task {
            defer { submitting = false }
            do {
                try await store.importPrivateKey(privateKey)
                key = ""
                imported()
            } catch {
                result = describe(error)
                store.toast = describe(error)
            }
        }
    }
}

/// The key's input. SwiftUI's `TextField` cannot refuse copy, so this is a UIKit text view that
/// offers only paste, select and select all, cannot drag its text out, and lets no correction,
/// prediction, smart punctuation or AutoFill see what is typed.
private struct KeyTextView: UIViewRepresentable {
    @Binding var text: String
    let label: String
    let color: UIColor

    func makeUIView(context: Context) -> PasteOnlyTextView {
        let view = PasteOnlyTextView()
        view.delegate = context.coordinator
        view.accessibilityLabel = label
        view.autocorrectionType = .no
        view.spellCheckingType = .no
        view.autocapitalizationType = .none
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.smartInsertDeleteType = .no
        view.inlinePredictionType = .no
        view.keyboardType = .asciiCapable
        view.textContentType = nil
        view.textDragInteraction?.isEnabled = false
        view.backgroundColor = .clear
        view.isScrollEnabled = false
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.font = UIFontMetrics.default.scaledFont(
            for: BrambleTypography.uiFont(size: BrambleTypeScale.mono.size, weight: BrambleWeight.regular, mono: true)
        )
        return view
    }

    func updateUIView(_ view: PasteOnlyTextView, context: Context) {
        context.coordinator.text = $text
        if view.text != text { view.text = text }
        view.textColor = color
    }

    /// Wraps the key to the width SwiftUI offers and grows with it, rather than scrolling one line.
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: PasteOnlyTextView, context _: Context) -> CGSize? {
        let width = proposal.width ?? uiView.bounds.width
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: fitted.height)
    }

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var text: Binding<String>

        init(text: Binding<String>) { self.text = text }

        func textViewDidChange(_ textView: UITextView) { text.wrappedValue = textView.text }
    }
}

/// A text view whose edit menu holds only paste, select and select all: copy, cut, share, look up
/// and translate would each hand the key to the pasteboard or another process. Writing Tools
/// (iOS 18) reaches selected text by its own path, not the edit menu, so it is switched off too.
final class PasteOnlyTextView: UITextView {
    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        if #available(iOS 18.0, *) { writingToolsBehavior = UIWritingToolsBehavior.none }
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) { nil }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        let allowed = [#selector(paste(_:)), #selector(select(_:)), #selector(selectAll(_:))]
        return allowed.contains(action) && super.canPerformAction(action, withSender: sender)
    }
}
