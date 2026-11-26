// The Send journey's pure helpers, kept beside `SendFlowModel` so the model stays readable.
extension SendFlowModel {
    /// The flow header's title for each stage (`transferStageTitle`): authorizing, broadcasting
    /// and confirming all read "Sending".
    nonisolated static func title(_ stage: Stage) -> String {
        switch stage {
        case .recipient:
            SendCopy.titleRecipient

        case .details, .reviewing:
            SendCopy.titleDetails

        case .review:
            SendCopy.titleReview

        case .authorizing:
            SendCopy.titleAuthorizing

        case .broadcasting:
            SendCopy.titleBroadcasting

        case .confirming:
            SendCopy.titleConfirming

        case .pending:
            SendCopy.titlePending

        case .submitted:
            SendCopy.titleSubmitted

        case .failed:
            SendCopy.titleFailed
        }
    }

    /// Integer halving of a base-10 string (floor), as `raw / 2n`.
    nonisolated static func halve(_ decimal: String) -> String {
        var remainder = 0
        var digits = ""
        for character in decimal {
            guard let digit = character.wholeNumberValue else { return "0" }
            let current = remainder * SendFlowNumbers.decimalBase + digit
            digits.append(String(current / SendFlowNumbers.halvingDivisor))
            remainder = current % SendFlowNumbers.halvingDivisor
        }
        let trimmed = digits.drop { $0 == "0" }
        return trimmed.isEmpty ? "0" : String(trimmed)
    }
}
