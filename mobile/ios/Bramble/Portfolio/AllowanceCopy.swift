import BrambleCore

/// The allowance manager's row lines, as the extension's `allowance-views.ts`. The words are
/// generated from the extension (`AllowanceCopy.generated.swift`). Pure over the core's
/// `AllowanceView`: every amount, source, flag and limit is the core's; this only picks the line. Review,
/// risk and refusal sentences are not here: those are the core's own (`RevokeFlowModel`).
extension AllowanceCopy {
    /// `displayAmount`: the token's units when it is tracked, else raw base units, said so.
    static func display(_ amount: String, token: TokenConfig?) -> String {
        if let token, amount.allSatisfy(\.isNumber),
           let formatted = try? formatTokenAmount(raw: amount, decimals: token.decimals, maxFraction: token.decimals) {
            return "\(compactAmount(formatted: formatted, places: nil)) \(token.symbol)"
        }
        return baseUnits.replacingOccurrences(of: "{amount}", with: compactAmount(formatted: amount, places: nil))
    }

    /// `amountLabel`: unlimited wins; a lower bound says so, and a bound of zero is unknown.
    static func amount(_ view: AllowanceView, token: TokenConfig?) -> String {
        if view.unlimited { return unlimited }
        if !view.lowerBound { return display(view.amount, token: token) }
        if view.amount == "0" { return unknownAmount }
        return atLeast.replacingOccurrences(of: "{amount}", with: display(view.amount, token: token))
    }

    /// `sourceLabel`.
    static func source(_ source: AllowanceSource) -> String {
        switch source {
        case .external:
            sourceChain

        case .multisig:
            sourceMultisig

        case .wallet:
            sourceWallet
        }
    }

    /// The row's supporting line: amount, the contract when untracked, then where it came from.
    static func detail(_ view: AllowanceView, token: TokenConfig?) -> String {
        let contract = token == nil ? " \(ofContract) \(shortAddress(view.token))" : ""
        return "\(amount(view, token: token))\(contract) · \(source(view.source))"
    }

    /// `noticeCopy`; `entriesPerScope` is the core's retention cap (`allowanceEntriesPerScope()`).
    static func notice(_ notice: AllowanceNotice, entriesPerScope: UInt32 = allowanceEntriesPerScope()) -> String {
        switch notice {
        case .multisigUnread:
            multisigUnread

        case .retentionFull:
            retentionFull.replacingOccurrences(of: "{count}", with: String(entriesPerScope))

        case .scanIncomplete:
            scanIncomplete
        }
    }

    /// A multisig's grant takes its own intent; an unconfirmed contract would be granted, not
    /// revoked. Neither row gets the control.
    static func canRevoke(_ view: AllowanceView) -> Bool {
        view.source != .multisig && !view.unconfirmedToken
    }

    /// The tracked token at `address` on `tokens`, compared as canonical felts.
    static func token(_ address: String, in tokens: [TokenConfig]) -> TokenConfig? {
        guard let wanted = validateRecipient(input: address) else { return nil }
        return tokens.first { validateRecipient(input: $0.address) == wanted }
    }
}
