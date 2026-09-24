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
        Grid(horizontalSpacing: BrambleSpace.sm, verticalSpacing: BrambleSpace.sm) {
            ForEach(Array(stride(from: 0, to: count, by: 3)), id: \.self) { row in
                GridRow {
                    ForEach(row..<min(row + 3, count), id: \.self) { index in cell(index) }
                }
            }
        }
    }
}

private struct WordCell<Content: View>: View {
    @Environment(\.skin) private var skin
    let number: Int
    var invalid = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: 6) {
            Text("\(number)")
                .brambleText(BrambleTypeScale.mono, weight: BrambleWeight.semibold, mono: true)
                .foregroundStyle(skin.muted)
                .frame(width: 18, alignment: .trailing)
            content()
                .brambleText(BrambleTypeScale.body)
                .padding(.horizontal, BrambleSpace.sm)
                .frame(maxWidth: .infinity, minHeight: BrambleSize.control)
                .background(skin.elevated, in: FieldShape())
                .overlay(alignment: .bottom) { FieldEdge(color: invalid ? skin.danger : skin.border) }
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
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: BrambleSpace.xs) {
                    ForEach(options, id: \.self) { option in
                        Button(option) {
                            words[index] = option
                            focused = index + 1 < words.count ? index + 1 : nil
                        }
                        .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                        .foregroundStyle(skin.text)
                        .padding(.horizontal, BrambleSpace.md)
                        .frame(height: 32)
                        .background(skin.elevated, in: Capsule())
                    }
                }
            }
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
                WordCell(number: index + 1) {
                    Text(word)
                        .accessibilityIdentifier("recovery-word-\(index + 1)")
                        .foregroundStyle(skin.text)
                        .blur(radius: masked ? 6 : 0)
                        .animation(BrambleEase.out.animation(ms: BrambleMotion.enterMs), value: masked)
                }
                .privacySensitive()
                .accessibilityHidden(masked)
        }
    }
}
