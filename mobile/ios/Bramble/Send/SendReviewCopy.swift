import BrambleCore

/// What Send's confirm face reads, in the extension's order and words (`transfer-review-markup.ts`
/// `reviewSummaryHtml` / `reviewRisksHtml`, `review-render.ts` `reviewFeeSection`): the From / To /
/// Amount facts, the Cost box, and the risks, which are shown only when there is something to say.
/// Pure: every figure is the core's review; this only picks the lines.
enum SendReviewCopy {
    /// One `.send-review-facts` row: its label, the value in strong, the line under it.
    struct Fact: Equatable {
        enum Kind: Equatable { case sender, recipient, amount }

        let kind: Kind
        let label: String
        let value: String
        let detail: String
        /// The full value the row's copy control copies; nil when the row has none.
        let copy: String?
    }

    /// The Cost box (`reviewFeeSection`): the fee lines, total first, or the failed estimate with
    /// its retry, and the shortfall warning when the STRK balance falls short.
    struct Cost: Equatable {
        let lines: [String]
        /// `feeFailed` / `feesFailed`: shown with the Retry fee estimate control.
        let failure: String?
        let shortfall: Bool

        /// Everything the box reads, heading first, as the extension renders it.
        var texts: [String] {
            [SendCopy.cost] + lines + (failure.map { [$0, SendCopy.retryFee] } ?? [])
                + (shortfall ? [SendCopy.shortfall] : [])
        }
    }

    /// Base units per STRK (`FRI`), and the fraction digits `formatFri` keeps.
    private static let friDecimals: UInt8 = 18
    private static let friFractionDigits: UInt8 = 6

    /// Who it leaves, who it reaches, how much. The recipient reads under the name of the row it
    /// was picked from, else as its truncated address, with a control that copies it in full.
    static func facts(
        sender: (name: String, address: String),
        recipient: (label: String?, address: String),
        amount: String,
        symbol: String
    ) -> [Fact] {
        let senderShort = shortAddress(sender.address)
        let recipientShort = shortAddress(recipient.address)
        return [
            Fact(
                kind: .sender,
                label: SendCopy.fromRowLabel,
                value: sender.name.isEmpty ? senderShort : sender.name,
                detail: senderShort,
                copy: nil
            ),
            Fact(
                kind: .recipient,
                label: SendCopy.toRowLabel,
                value: recipient.label ?? recipientShort,
                detail: recipientShort,
                copy: recipient.address
            ),
            // Mobile has no fiat estimate in Send, so the amount always says so.
            Fact(
                kind: .amount,
                label: SendCopy.amountRowLabel,
                value: "\(amount) \(symbol)",
                detail: SendCopy.fiatUnavailable,
                copy: nil
            )
        ]
    }

    /// The first matching fee state. A first send also deploys the account, and the user pays for
    /// both: one combined figure leads and the deployment's share is named under it. A total that
    /// cannot be formed (unlike units) fails closed, as the extension's does.
    static func cost(_ review: TransferReview) -> Cost {
        let short = review.affordability == .insufficient
        if review.requiresDeployment {
            guard let fee = review.fee, let deployment = review.deploymentFee,
                  let total = total(fee, deployment) else {
                return Cost(lines: [], failure: SendCopy.feesFailed, shortfall: false)
            }
            let share = SendCopy.deploymentSharePrefix + deployment.display + SendCopy.deploymentShareSuffix
            return Cost(lines: [SendCopy.feePrefix + total, share], failure: nil, shortfall: short)
        }
        guard let fee = review.fee else {
            return Cost(lines: [], failure: SendCopy.feeFailed, shortfall: false)
        }
        return Cost(lines: [SendCopy.feePrefix + fee.display], failure: nil, shortfall: short)
    }

    /// `reviewRisksHtml`: the risk flags, then the note that a first send also deploys the
    /// account. Empty when there is nothing to warn about, and then no panel is shown.
    static func risks(_ review: TransferReview) -> [String] {
        let flags = review.flags.map { flag in
            flag == .selfTransfer ? SendCopy.selfTransfer : SendCopy.poisonedRecipient
        }
        return flags + (review.requiresDeployment ? [SendCopy.deployNote] : [])
    }

    /// `sumFeeEstimates` then `formatFeeEstimate`: like units only; FRI reads as STRK.
    static func total(_ fee: FeeAmount, _ deployment: FeeAmount) -> String? {
        guard fee.unit == deployment.unit, let sum = addDecimal(fee.maxSpend, deployment.maxSpend) else {
            return nil
        }
        switch fee.unit {
        case .fri:
            return (try? formatTokenAmount(raw: sum, decimals: friDecimals, maxFraction: friFractionDigits))
                .map { "\($0) STRK" }

        case .wei:
            return "\(sum) WEI"
        }
    }

    /// The sum of two base-10 integer strings, digit by digit (base units exceed `UInt64`); nil
    /// when either is not a plain decimal.
    static func addDecimal(_ left: String, _ right: String) -> String? {
        guard !left.isEmpty, !right.isEmpty, (left + right).allSatisfy(\.isASCII) else { return nil }
        let lhs = left.reversed().compactMap(\.wholeNumberValue)
        let rhs = right.reversed().compactMap(\.wholeNumberValue)
        guard lhs.count == left.count, rhs.count == right.count else { return nil }
        var digits: [Int] = []
        var carry = 0
        for index in 0..<max(lhs.count, rhs.count) {
            let sum = (index < lhs.count ? lhs[index] : 0) + (index < rhs.count ? rhs[index] : 0) + carry
            digits.append(sum % DecimalBase.radix)
            carry = sum / DecimalBase.radix
        }
        if carry > 0 { digits.append(carry) }
        let text = digits.reversed().map(String.init).joined().drop { $0 == "0" }
        return text.isEmpty ? "0" : String(text)
    }

    private enum DecimalBase {
        static let radix = 10
    }
}
