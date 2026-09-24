import BrambleCore
import SwiftUI

// `.recovery-grid`: three numbered columns of word cells. The entry grid flags unknown words and
// offers BIP-39 completions (core `recovery_word_suggestions`, five at most, as the extension);
// the display grid blurs its words until revealed.

/// Three columns of cells. Not lazy: focus must be able to move to any cell, rendered or not,
/// and a phrase grid is at most 24 cells.
private struct ThreeColumnGrid<Cell: View>: View {
    let count: Int
    @ViewBuilder let cell: (Int) -> Cell

    var body: some View {
        Grid(horizontalSpacing: BrambleMetrics.Recovery.gridGap, verticalSpacing: BrambleMetrics.Recovery.gridGap) {
            ForEach(Array(stride(from: 0, to: count, by: 3)), id: \.self) { row in
                GridRow {
                    ForEach(row..<min(row + 3, count), id: \.self) { index in cell(index) }
                }
            }
        }
    }
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
        let m = BrambleMetrics.Recovery.self
        HStack(spacing: m.cellGap) {
            Text("\(number)")
                .brambleText(BrambleTypeScale.mono.sized(m.numberSize), weight: BrambleWeight.semibold, mono: true)
                .monospacedDigit()
                .foregroundStyle(skin.muted)
                .frame(minWidth: m.numberSize * 1.2, alignment: .trailing)
                .accessibilityHidden(true)
            content()
                .brambleText(BrambleTypeScale.mono.sized(m.wordSize), mono: true)
                .multilineTextAlignment(.center)
                .foregroundStyle(invalid ? skin.danger : skin.text)
                .padding(m.wordPadding)
                .frame(maxWidth: .infinity, minHeight: BrambleMetrics.Field.height)
                .background(invalid ? skin.recoveryWordInvalid : skin.elevated, in: FieldShape())
                .overlay(alignment: .bottom) { FieldEdge(color: invalid ? skin.danger : skin.border) }
                .blur(radius: masked ? 6 : 0)
        }
    }
}

struct RecoveryEntryGrid: View {
    @Environment(\.skin) private var skin
    @Binding var words: [String]
    @FocusState private var focused: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            ThreeColumnGrid(count: words.count) { index in
                    let word = words[index].trimmingCharacters(in: .whitespaces)
                    WordCell(number: index + 1, invalid: !word.isEmpty && focused != index && !isRecoveryWord(word: word)) {
                        TextField("", text: binding(index))
                            .focused($focused, equals: index)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.asciiCapable)
                            .submitLabel(index == words.count - 1 ? .done : .next)
                            .onSubmit { focused = index + 1 < words.count ? index + 1 : nil }
                            .accessibilityLabel("Word \(index + 1)")
                    }
                    .privacySensitive()
            }
            if let index = focused, index < words.count {
                suggestions(for: index)
            }
        }
    }

    /// A space finishes the word and moves on; several words (a paste) spread from this cell,
    /// switching to the 24-word grid when the pasted phrase needs it.
    private func binding(_ index: Int) -> Binding<String> {
        Binding {
            words[index]
        } set: { value in
            let parts = value.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
            if parts.count > 1 {
                if index + parts.count > 12 && words.count == 12 { words += Array(repeating: "", count: 12) }
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
            let m = BrambleMetrics.Recovery.self
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: m.suggestionsGap) {
                    ForEach(options, id: \.self) { option in
                        Button {
                            words[index] = option
                            focused = index + 1 < words.count ? index + 1 : nil
                        } label: {
                            Text(option)
                                .brambleText(BrambleTypeScale.mono.sized(m.wordSize), mono: true)
                                .foregroundStyle(skin.text)
                                .padding(m.suggestionPadding)
                                .frame(minHeight: m.suggestionHeight)
                        }
                        .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.elevated, shape: RoundedRectangle(cornerRadius: m.suggestionRadius, style: .continuous), scale: 1, hit: CGSize(width: BrambleHit.minimum, height: m.suggestionHeight)))
                        .accessibilityHint("Fills word \(index + 1)")
                    }
                }
                .padding(m.suggestionsPadding)
            }
            .fixedSize(horizontal: false, vertical: true)
            .background(skin.panel, in: RoundedRectangle(cornerRadius: m.suggestionsRadius, style: .continuous))
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
