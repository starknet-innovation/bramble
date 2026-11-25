package org.bramble.wallet.errors

/**
 * The extension's `friendlyError` (`sidepanel/runtime/friendly-error.ts`), twin of the iOS
 * `FriendlyError`, ported step for step over its generated tables and patterns
 * ([FriendlyErrorCopy], [FriendlyErrorRules]): the same checks in the same order, with the same
 * fallback. A raw error or refusal from the core goes through here before it is shown. Approval,
 * review and signing sentences (`RiskFlag`, review summaries) never do. [context] is the calling
 * screen's own line for a failure that says nothing a reader needs; null reads the generic one.
 */
fun friendlyError(
    raw: String,
    context: String? = null,
): String {
    val fallback = context ?: FriendlyErrorRules.unexpectedFallback
    val trimmed = raw.trim()
    val normalized = trimmed.lowercase()
    return when {
        trimmed.isEmpty() -> fallback
        normalized in FriendlyErrorCopy.table -> FriendlyErrorCopy.table.getValue(normalized)
        trimmed in FriendlyErrorRules.ledgerMessages -> FriendlyErrorRules.ledgerMessages.getValue(trimmed)
        FriendlyPatterns.validationRequest.containsMatchIn(normalized) -> FriendlyErrorRules.genericValidation
        isReviewedPlumbing(normalized) -> fallback
        FriendlyPatterns.strk20.containsMatchIn(normalized) -> strk20Message(trimmed, normalized)
        FriendlyPatterns.rateLimit.containsMatchIn(trimmed) -> FriendlyErrorRules.rateLimited
        isRawRpc(trimmed) -> FriendlyErrorRules.rpcRejected
        networkError(trimmed) != null -> FriendlyErrorRules.networkError
        rawServiceDiagnostic(trimmed) -> FriendlyErrorRules.serviceRejected
        isDeveloperVoice(trimmed) -> fallback
        else -> trimmed
    }
}

/** `isReviewedPlumbing`, over the already lowercased message. */
private fun isReviewedPlumbing(normalized: String): Boolean =
    normalized in FriendlyErrorRules.reviewedPlumbing ||
        FriendlyPatterns.kmsTemplatePlumbing.containsMatchIn(normalized)

private fun isRawRpc(value: String): Boolean =
    FriendlyPatterns.rawRpc.containsMatchIn(value) || FriendlyPatterns.rawRpcResponse.containsMatchIn(value)

/** The lowercase backstop: a developer's diagnostic that names no security, privacy or funds fact. */
private fun isDeveloperVoice(value: String): Boolean =
    FriendlyPatterns.developerVoice.containsMatchIn(value) && !FriendlyPatterns.factTerms.containsMatchIn(value)

/** `friendlyNetworkError`. */
private fun networkError(raw: String): String? {
    val normalized = raw.lowercase()
    return FriendlyErrorRules.networkError.takeIf { FriendlyErrorRules.networkMarkers.any { it in normalized } }
}

/** `rawServiceDiagnostic`; [String.length] is JavaScript's, in UTF-16 units. */
private fun rawServiceDiagnostic(value: String): Boolean =
    value.length > FriendlyErrorRules.rawServiceMaxLength ||
        FriendlyPatterns.lineBreak.containsMatchIn(value) ||
        FriendlyPatterns.rawHttp.containsMatchIn(value) ||
        FriendlyPatterns.rawJson.containsMatchIn(value)

/** `withDetail`: the sentence with the sanitised detail kept beside it. */
private fun withDetail(
    sentence: String,
    detail: String?,
): String = if (detail.isNullOrEmpty()) sentence else "$sentence ($detail)"

/** `strk20Message`. */
private fun strk20Message(
    trimmed: String,
    normalized: String,
): String {
    val servicesDown = FriendlyErrorCopy.table[FriendlyErrorRules.strk20ServicesDown] ?: trimmed
    val staged = FriendlyPatterns.strk20Stage.find(trimmed)
    val cause =
        FriendlyPatterns.strk20Protocol
            .find(trimmed)
            ?.groups
            ?.get(1)
            ?.value
            .orEmpty()
    return when {
        FriendlyPatterns.strk20PrivacyLeak.containsMatchIn(normalized) -> FriendlyErrorRules.privacyLeak
        normalized == FriendlyErrorRules.strk20RateLimited -> FriendlyErrorRules.rateLimited
        FriendlyPatterns.strk20ServiceDown.containsMatchIn(normalized) -> servicesDown
        staged != null -> stageMessage(trimmed, staged)
        cause.isEmpty() -> trimmed
        FriendlyPatterns.rateLimit.containsMatchIn(cause) -> withDetail(FriendlyErrorRules.rateLimited, cause)
        networkError(cause) != null -> withDetail(FriendlyErrorRules.networkError, cause)
        FriendlyPatterns.strk20OutageCause.containsMatchIn(cause) -> withDetail(servicesDown, cause)
        else -> trimmed
    }
}

/** `STRK20_STAGE`'s third group: the sanitised detail. */
private const val DETAIL_GROUP = 3

/** The `STRK20_STAGE` branch of `strk20Message`. */
private fun stageMessage(
    trimmed: String,
    staged: MatchResult,
): String {
    val stage = staged.groups[1]?.value.orEmpty()
    val category = staged.groups[2]?.value.orEmpty()
    val detail = staged.groups[DETAIL_GROUP]?.value?.takeIf { it.isNotEmpty() }
    val reviewed = FriendlyErrorRules.strk20Stages[category]
    return when {
        category == "rate-limited" -> withDetail(FriendlyErrorRules.rateLimited, detail)
        category == "transport" -> withDetail(FriendlyErrorRules.networkError, detail)
        category == "service-unavailable" -> trimmed
        reviewed != null -> detail?.let { reviewed.second.replace(FriendlyErrorRules.detail, it) } ?: reviewed.first
        else -> "strk20 $stage/$category" + (detail?.let { ": $it" } ?: "")
    }
}

/** The generated patterns, compiled once (the unit tests compile every one). */
internal object FriendlyPatterns {
    val developerVoice = Regex(FriendlyErrorRules.developerVoice)
    val factTerms = Regex(FriendlyErrorRules.factTerms)
    val kmsTemplatePlumbing = Regex(FriendlyErrorRules.kmsTemplatePlumbing)
    val lineBreak = Regex(FriendlyErrorRules.lineBreak)
    val rateLimit = Regex(FriendlyErrorRules.rateLimit)
    val rawHttp = Regex(FriendlyErrorRules.rawHttp)
    val rawJson = Regex(FriendlyErrorRules.rawJson)
    val rawRpc = Regex(FriendlyErrorRules.rawRpc)
    val rawRpcResponse = Regex(FriendlyErrorRules.rawRpcResponse)
    val strk20 = Regex(FriendlyErrorRules.strk20)
    val strk20OutageCause = Regex(FriendlyErrorRules.strk20OutageCause)
    val strk20PrivacyLeak = Regex(FriendlyErrorRules.strk20PrivacyLeak)
    val strk20Protocol = Regex(FriendlyErrorRules.strk20Protocol)
    val strk20ServiceDown = Regex(FriendlyErrorRules.strk20ServiceDown)
    val strk20Stage = Regex(FriendlyErrorRules.strk20Stage)
    val validationRequest = Regex(FriendlyErrorRules.validationRequest)
}
