import Foundation

/// The extension's `friendlyError` (`sidepanel/runtime/friendly-error.ts`), ported step for step
/// over its generated tables and patterns (`FriendlyErrorCopy`, `FriendlyErrorRules`): the same
/// checks in the same order, with the same fallback. A raw error or refusal from the core goes
/// through here before it is shown. Approval, review and signing sentences (`RiskFlag`, review
/// summaries) never do: they are shown exactly as the core wrote them.
enum FriendlyError {
    /// The sentence `raw` earns. `context` is the calling screen's own line for a failure that
    /// says nothing a reader needs (the extension's `context`); nil reads the generic fallback.
    static func message(_ raw: String, context: String? = nil) -> String {
        let fallback = context ?? FriendlyErrorRules.unexpectedFallback
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return fallback }
        let normalized = trimmed.lowercased()
        if let mapped = FriendlyErrorCopy.table[normalized] { return mapped }
        if let ledger = FriendlyErrorRules.ledgerMessages[trimmed] { return ledger }
        if FriendlyPattern.validationRequest.test(normalized) { return FriendlyErrorRules.genericValidation }
        if isReviewedPlumbing(normalized) { return fallback }
        if FriendlyPattern.strk20.test(normalized) { return strk20Message(trimmed, normalized: normalized) }
        return unlisted(trimmed, fallback: fallback)
    }

    /// The tail of `friendlyError`, for a message no table names: the transport and service
    /// classifiers, then the lowercase backstop, else the message as written.
    private static func unlisted(_ trimmed: String, fallback: String) -> String {
        if FriendlyPattern.rateLimit.test(trimmed) { return FriendlyErrorRules.rateLimited }
        if FriendlyPattern.rawRpc.test(trimmed) || FriendlyPattern.rawRpcResponse.test(trimmed) {
            return FriendlyErrorRules.rpcRejected
        }
        if let network = networkError(trimmed) { return network }
        if rawServiceDiagnostic(trimmed) { return FriendlyErrorRules.serviceRejected }
        if FriendlyPattern.developerVoice.test(trimmed), !FriendlyPattern.factTerms.test(trimmed) { return fallback }
        return trimmed
    }

    /// `isReviewedPlumbing`, over the already lowercased message.
    private static func isReviewedPlumbing(_ normalized: String) -> Bool {
        FriendlyErrorRules.reviewedPlumbing.contains(normalized) || FriendlyPattern.kmsTemplatePlumbing.test(normalized)
    }

    /// `friendlyNetworkError`.
    private static func networkError(_ raw: String) -> String? {
        let normalized = raw.lowercased()
        return FriendlyErrorRules.networkMarkers.contains { normalized.contains($0) }
            ? FriendlyErrorRules.networkError : nil
    }

    /// `rawServiceDiagnostic`; the length is JavaScript's, in UTF-16 units.
    private static func rawServiceDiagnostic(_ value: String) -> Bool {
        value.utf16.count > FriendlyErrorRules.rawServiceMaxLength
            || FriendlyPattern.lineBreak.test(value)
            || FriendlyPattern.rawHttp.test(value)
            || FriendlyPattern.rawJson.test(value)
    }

    /// `withDetail`: the sentence with the sanitised detail kept beside it.
    private static func withDetail(_ sentence: String, _ detail: String?) -> String {
        guard let detail, !detail.isEmpty else { return sentence }
        return "\(sentence) (\(detail))"
    }

    /// `strk20Message`.
    private static func strk20Message(_ trimmed: String, normalized: String) -> String {
        if FriendlyPattern.strk20PrivacyLeak.test(normalized) { return FriendlyErrorRules.privacyLeak }
        if normalized == FriendlyErrorRules.strk20RateLimited { return FriendlyErrorRules.rateLimited }
        let servicesDown = FriendlyErrorCopy.table[FriendlyErrorRules.strk20ServicesDown] ?? trimmed
        if FriendlyPattern.strk20ServiceDown.test(normalized) { return servicesDown }
        let staged = FriendlyPattern.strk20Stage.groups(trimmed)
        if let stage = staged.first, let category = staged.dropFirst().first, let detail = staged.last {
            return stageMessage(trimmed, stage: stage ?? "", category: category ?? "", detail: detail)
        }
        guard let first = FriendlyPattern.strk20Protocol.groups(trimmed).first, let cause = first, !cause.isEmpty
        else { return trimmed }
        if FriendlyPattern.rateLimit.test(cause) { return withDetail(FriendlyErrorRules.rateLimited, cause) }
        if networkError(cause) != nil { return withDetail(FriendlyErrorRules.networkError, cause) }
        if FriendlyPattern.strk20OutageCause.test(cause) { return withDetail(servicesDown, cause) }
        return trimmed
    }

    /// The `STRK20_STAGE` branch of `strk20Message`.
    private static func stageMessage(
        _ trimmed: String,
        stage: String,
        category: String,
        detail raw: String?
    ) -> String {
        let detail = raw?.isEmpty == false ? raw : nil
        switch category {
        case "rate-limited":
            return withDetail(FriendlyErrorRules.rateLimited, detail)

        case "transport":
            return withDetail(FriendlyErrorRules.networkError, detail)

        case "service-unavailable":
            return trimmed

        default:
            if let reviewed = FriendlyErrorRules.strk20Stages[category] {
                guard let detail else { return reviewed.bare }
                return reviewed.detailed.replacingOccurrences(of: FriendlyErrorRules.detail, with: detail)
            }
            return "strk20 \(stage)/\(category)" + (detail.map { ": \($0)" } ?? "")
        }
    }
}

/// One generated pattern, compiled once. A pattern that does not compile matches nothing, and
/// the unit tests compile every one.
struct FriendlyPattern: Sendable {
    let regex: NSRegularExpression?

    init(_ source: String) {
        regex = try? NSRegularExpression(pattern: source)
    }

    /// JavaScript's `test`: a match anywhere.
    func test(_ value: String) -> Bool {
        regex?.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    /// JavaScript's `exec` capture groups (1…n), empty for no match; an unmatched group is nil.
    func groups(_ value: String) -> [String?] {
        guard let regex, let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value))
        else { return [] }
        return (1..<match.numberOfRanges).map { index in
            Range(match.range(at: index), in: value).map { String(value[$0]) }
        }
    }

    static let developerVoice = Self(FriendlyErrorRules.developerVoice)
    static let factTerms = Self(FriendlyErrorRules.factTerms)
    static let kmsTemplatePlumbing = Self(FriendlyErrorRules.kmsTemplatePlumbing)
    static let lineBreak = Self(FriendlyErrorRules.lineBreak)
    static let rateLimit = Self(FriendlyErrorRules.rateLimit)
    static let rawHttp = Self(FriendlyErrorRules.rawHttp)
    static let rawJson = Self(FriendlyErrorRules.rawJson)
    static let rawRpc = Self(FriendlyErrorRules.rawRpc)
    static let rawRpcResponse = Self(FriendlyErrorRules.rawRpcResponse)
    static let strk20 = Self(FriendlyErrorRules.strk20)
    static let strk20OutageCause = Self(FriendlyErrorRules.strk20OutageCause)
    static let strk20PrivacyLeak = Self(FriendlyErrorRules.strk20PrivacyLeak)
    static let strk20Protocol = Self(FriendlyErrorRules.strk20Protocol)
    static let strk20ServiceDown = Self(FriendlyErrorRules.strk20ServiceDown)
    static let strk20Stage = Self(FriendlyErrorRules.strk20Stage)
    static let validationRequest = Self(FriendlyErrorRules.validationRequest)

    /// Every pattern, for the test that each compiles.
    static let all: [Self] = [
        developerVoice, factTerms, kmsTemplatePlumbing, lineBreak, rateLimit, rawHttp, rawJson, rawRpc,
        rawRpcResponse, strk20, strk20OutageCause, strk20PrivacyLeak, strk20Protocol, strk20ServiceDown,
        strk20Stage, validationRequest
    ]
}
