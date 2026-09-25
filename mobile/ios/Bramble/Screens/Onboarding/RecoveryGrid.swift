import BrambleCore
import SwiftUI

// `.recovery-grid`: three numbered columns of word cells. The entry grid flags unknown words and
// offers BIP-39 completions (core `recovery_word_suggestions`, five at most, as the extension);
// the display grid blurs its words until revealed.

/// The two recovery phrase lengths the wallet accepts, as the extension's BIP-39 grids.
enum RecoveryPhraseWordCount {
    static let standard = 12
    static let extended = 24
}

/// Blur applied to a word field while it is masked or the screen is being captured.
private let maskedWordBlur: CGFloat = 6

/// Three columns of cells. Not lazy: focus must be able to move to any cell, rendered or not,
/// and a phrase grid is at most 24 cells.
private struct ThreeColumnGrid<Cell: View>: View {
    let count: Int
    @ViewBuilder let cell: (Int) -> Cell

    var body: some View {
        Grid(horizontalSpacing: BrambleMetrics.Recovery.gridGap, verticalSpacing: BrambleMetrics.Recovery.gridGap) {
            ForEach(Array(stride(from: 0, to: count, by: ThreeColumnGridLayout.columns)), id: \.self) { row in
                GridRow {
                    ForEach(row..<min(row + ThreeColumnGridLayout.columns, count), id: \.self) { index in cell(index) }
                }
            }
        }
    }
}

private enum ThreeColumnGridLayout {
    static let columns = 3
}

/// `.recovery-word-cell`: a mono position marker (`min-width: 2ch`) and the word field. A masked
/// cell blurs the whole field, as `.recovery-grid.is-masked .recovery-word` does.
private struct WordCell<Content: View>: View {
    @Environment(\.skin) private var skin
    let number: Int
    var invalid = false
    var masked = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        let metrics = BrambleMetrics.Recovery.self
        HStack(spacing: metrics.cellGap) {
            Text("\(number)")
                .brambleText(
                    BrambleTypeScale.mono.sized(metrics.numberSize),
                    weight: BrambleWeight.semibold,
                    mono: true
                )
                .monospacedDigit()
                .foregroundStyle(skin.muted)
                .frame(minWidth: metrics.numberSize * WordCellLayout.numberWidthRatio, alignment: .trailing)
                .accessibilityHidden(true)
            content()
                .brambleText(BrambleTypeScale.mono.sized(metrics.wordSize), mono: true)
                .multilineTextAlignment(.center)
                .foregroundStyle(invalid ? skin.danger : skin.text)
                .padding(metrics.wordPadding)
                .frame(maxWidth: .infinity, minHeight: BrambleMetrics.Field.height)
                // Flat like every field: an unknown word shows the danger fill and ink, no edge.
                .background(invalid ? skin.dangerSoft : skin.elevated, in: FieldShape())
                .blur(radius: masked ? maskedWordBlur : 0)
        }
    }
}

private enum WordCellLayout {
    /// The position marker's `min-width: 2ch`, as a multiple of the mono number size.
    static let numberWidthRatio: CGFloat = 1.2
}

struct RecoveryEntryGrid: View {
    @Environment(\.skin) private var skin
    @Environment(WalletStore.self) private var store
    @Binding var words: [String]
    @FocusState private var focused: Int?
    @State private var captured = false

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            ThreeColumnGrid(count: words.count) { index in
                let word = words[index].trimmingCharacters(in: .whitespaces)
                let unknown = !word.isEmpty && focused != index && !isRecoveryWord(word: word)
                WordCell(number: index + 1, invalid: unknown) {
                    TextField("", text: binding(index))
                        .focused($focused, equals: index)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .textContentType(nil)
                        .blur(radius: captured ? maskedWordBlur : 0)
                        .submitLabel(index == words.count - 1 ? .done : .next)
                        .onSubmit { focused = index + 1 < words.count ? index + 1 : nil }
                        .accessibilityLabel("Word \(index + 1)")
                }
                .privacySensitive()
            }
            if let index = focused, index < words.count, !captured {
                suggestions(for: index)
            }
        }
        .trackingScreenCapture($captured)
    }

    /// A multi-word value can only arrive by paste: clear the clipboard (a write, never a read) so
    /// the phrase does not linger for other apps or Universal Clipboard.
    private func clearClipboardAfterPaste() {
        UIPasteboard.general.items = []
        store.notify(BrambleCopy.clipboardCleared)
    }

    /// A space finishes the word and moves on; several words (a paste) spread from this cell,
    /// switching to the 24-word grid when the pasted phrase needs it.
    private func binding(_ index: Int) -> Binding<String> {
        Binding {
            words[index]
        } set: { value in
            let parts = value.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
            if parts.count > 1 {
                clearClipboardAfterPaste()
                let standard = RecoveryPhraseWordCount.standard
                if index + parts.count > standard, words.count == standard {
                    words += Array(repeating: "", count: RecoveryPhraseWordCount.extended - standard)
                }
                for (offset, word) in parts.enumerated() where index + offset < words.count {
                    words[index + offset] = word
                }
                let next = index + parts.count
                focused = next < words.count && value.last?.isWhitespace == true ? next : nil
            } else {
                words[index] = parts.first ?? ""
                if value.last?.isWhitespace == true, !(parts.first ?? "").isEmpty {
                    focused = index + 1 < words.count ? index + 1 : nil
                }
            }
        }
    }

    @ViewBuilder
    private func suggestions(for index: Int) -> some View {
        let typed = words[index]
        let options = recoveryWordSuggestions(prefix: typed).filter { $0 != typed }
        if !options.isEmpty {
            // `.recovery-suggestions`: the panel popover with md elevation. On a phone it is one row
            // under the grid, above the keyboard, rather than a floating vertical list.
            let metrics = BrambleMetrics.Recovery.self
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: metrics.suggestionsGap) {
                    ForEach(options, id: \.self) { option in
                        Button {
                            words[index] = option
                            focused = index + 1 < words.count ? index + 1 : nil
                        } label: {
                            Text(option)
                                .brambleText(BrambleTypeScale.mono.sized(metrics.wordSize), mono: true)
                                .foregroundStyle(skin.text)
                                .padding(metrics.suggestionPadding)
                                .frame(minHeight: metrics.suggestionHeight)
                        }
                        .buttonStyle(
                            FillPressStyle(
                                fill: .clear,
                                pressed: skin.elevated,
                                shape: RoundedRectangle(cornerRadius: metrics.suggestionRadius, style: .continuous),
                                scale: 1,
                                hit: CGSize(width: BrambleHit.minimum, height: metrics.suggestionHeight)
                            )
                        )
                        .accessibilityHint("Fills word \(index + 1)")
                    }
                }
                .padding(metrics.suggestionsPadding)
            }
            .fixedSize(horizontal: false, vertical: true)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: metrics.suggestionsRadius, style: .continuous))
            .elevation(BrambleElevation.recoverySuggestions)
        }
    }
}

struct RecoveryWordGrid: View {
    @Environment(\.skin) private var skin
    let words: [String]
    let masked: Bool

    var body: some View {
        ThreeColumnGrid(count: words.count) { index in
            let word = words[index]
            WordCell(number: index + 1, masked: masked) {
                // While masked the word is not rendered at all — the blurred field is empty — so it
                // is in neither the view nor the accessibility tree.
                if masked {
                    Text(verbatim: " ").accessibilityHidden(true)
                } else {
                    Text(word).accessibilityIdentifier("recovery-word-\(index + 1)")
                }
            }
            .privacySensitive()
            .accessibilityHidden(masked)
            .animation(BrambleEase.out.animation(ms: BrambleMotion.enterMs), value: masked)
        }
        // While masked, VoiceOver meets one element that says so, never a word.
        .accessibilityElement(children: masked ? .ignore : .contain)
        .accessibilityLabel(masked ? "Recovery phrase hidden" : "Recovery phrase")
        .accessibilityIdentifier("recovery-grid")
    }
}
