import BrambleCore

/// The allowance manager's words and row lines, as the extension's `allowance-views.ts` and the
/// `portfolio.allowance.*` catalog. Pure over the core's `AllowanceView`: every amount, source and
/// flag is the core's; this only picks the line. Review, risk and refusal sentences are not here:
/// those are the core's own (`RevokeFlowModel`).
enum AllowanceCopy {
    static let title = "Allowances"
    static let settingsSection = "Access & permissions"
    static let settingsRow = "Token allowances"
    static let lede = "Revoking sets a spender's allowance to zero after you confirm its network fee."
    static let refresh = "Refresh allowances"
    static let loading = "Loading allowances…"
    static let noAccount = "Unlock an account on this network to manage allowances."
    static let noneFound = "No allowances on tokens you track."
    static let notLoaded = "Not loaded"
    static let unavailable = "Allowances could not be loaded. Refresh to try again."
    static let outstanding = "{count} outstanding"
    static let scopeTitle = "What this list includes"
    static let scopeBody = "It includes approvals granted here and approvals discovered on-chain for tracked ERC-20 "
        + "tokens. 'At least' means the wallet can only prove a lower bound. NFT approvals and untracked tokens "
        + "are outside this scan; unconfirmed contracts keep no revoke control because an ERC-20 revoke call "
        + "could grant an NFT instead."
    static let copySpender = "Copy spender address"
    static let copyTokenContract = "Copy token contract address"
    static let revoke = "Revoke"
    static let revoking = "Revoke sent. It stays listed until the network confirms it."
    static let submitted = "Revoke submitted"
    static let unconfirmedToken = "This wallet cannot confirm this contract is a token, so the value may be an NFT "
        + "item id rather than an amount. Revoke it from the site that asked for it."
    static let unlimited = "Unlimited"
    static let unknownAmount = "an unknown amount"
    static let atLeast = "at least {amount}"
    static let baseUnits = "{amount} base units"
    static let ofContract = "of"
    static let sourceChain = "on-chain"
    static let sourceMultisig = "granted by a multisig you sign for"
    static let sourceWallet = "this wallet"
    static let multisigUnread = "A watched multisig could not be read, so approvals it granted may be missing."
    static let retentionFull = "This wallet keeps {count} approvals per account and drops the smallest first, "
        + "so some may be missing."
    static let scanIncomplete = "This list may be incomplete. Some older approvals on your tokens could not be checked."
    static let spenderRow = "Spender"
    static let tokenRow = "Token"
    static let amountRow = "Allowance"

    /// `ALLOWANCE_LIMITS.entriesPerScope` (the core's `ALLOWANCE_POLICY.entries_per_scope`). The
    /// core does not export it in v0.7.0, so the notice's number is the extension's, held here.
    static let entriesPerScope = 50

    /// 2^128 - 1: `isUnlimitedAllowance`'s cut-off (`UINT128_LIMIT - 1`). The core does not export
    /// the judge in v0.7.0; `AllowanceCopyTests` holds this to the fixture's `unlimited` block.
    private static let unlimitedFloor = "340282366920938463463374607431768211455"

    /// `isUnlimitedAllowance`: a plain base-10 amount at or above 2^128 - 1.
    static func isUnlimited(_ amount: String) -> Bool {
        guard !amount.isEmpty, amount.allSatisfy(\.isASCII), amount.allSatisfy(\.isNumber) else { return false }
        let digits = String(amount.drop { $0 == "0" })
        return digits.count != unlimitedFloor.count ? digits.count > unlimitedFloor.count : digits >= unlimitedFloor
    }

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
        if isUnlimited(view.amount) { return unlimited }
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

    /// `noticeCopy`.
    static func notice(_ notice: AllowanceNotice) -> String {
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
