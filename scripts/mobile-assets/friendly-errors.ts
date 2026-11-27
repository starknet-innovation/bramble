/**
 * The extension's friendly-error tables and classifier rules (`friendly-error*.ts`), rendered for
 * Swift and Kotlin so the mobile apps map a raw core refusal to the same sentence the side panel
 * shows. Only data is rendered: the copy table, the reviewed plumbing, the Ledger catalog (in its
 * Bluetooth wording, `ledger-copy.ts`), the
 * transport markers, every pattern `friendlyError` tests (as `source` + flags) and the STRK20
 * category sentences. The matching order is ported by hand in `FriendlyError.swift` /
 * `FriendlyError.kt` and pinned by their unit tests; a table or pattern change here changes the
 * generated files and fails `tests/conformance/mobile-generated.test.ts`.
 *
 * Approval, review and signing sentences never go through this lookup on mobile.
 */
import { readFileSync } from "node:fs";
import { NETWORK_ERROR_MESSAGE, NETWORK_FAILURE_MARKERS } from "@bramble/core/network-error";
import {
  FRIENDLY_ERROR_RULES,
  friendlyError,
} from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error";
import {
  ERROR_COPY,
  GENERIC_VALIDATION,
  RATE_LIMITED,
  RPC_REJECTED,
  SERVICE_REJECTED,
  UNEXPECTED_FALLBACK,
} from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-copy";
import {
  FACT_TERMS,
  KMS_TEMPLATE_PLUMBING,
  REVIEWED_PLUMBING,
} from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-internal";
import { PRIVACY_LEAK } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error-shared";
import { MOBILE_LEDGER_MESSAGES } from "./ledger-copy";
import { HEADER } from "./shared";

/** Repository-relative paths of the generated copy table and rules. */
const FRIENDLY_ERROR_PATHS = {
  kotlinCopy:
    "mobile/android/app/src/main/java/org/bramble/wallet/errors/FriendlyErrorCopy.generated.kt",
  kotlinRules:
    "mobile/android/app/src/main/java/org/bramble/wallet/errors/FriendlyErrorRules.generated.kt",
  swiftCopy: "mobile/ios/Bramble/Errors/FriendlyErrorCopy.generated.swift",
  swiftRules: "mobile/ios/Bramble/Errors/FriendlyErrorRules.generated.swift",
} as const;

/** Stands for the sanitised detail in a STRK20 category sentence. */
const DETAIL = "{detail}";

/**
 * A JavaScript pattern as an ICU / java.util.regex source. Only the `i` flag is portable. Both
 * engines read `[` inside a character class as a nested set (`[[{]` is a union there, a literal
 * `[` in JavaScript), so a bare `[` inside a class is escaped; `&&` would be an intersection, so
 * it is refused.
 */
const portable = (pattern: RegExp): string => {
  if (!/^i?$/.test(pattern.flags)) {
    throw new Error(`friendly-error pattern ${pattern} has flags mobile cannot express`);
  }
  let out = "";
  let inClass = false;
  const source = pattern.source;
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === "\\") {
      out += char + source.charAt(index + 1);
      index += 1;
    } else if (inClass && char === "[") {
      out += "\\[";
    } else if (inClass && char === "&" && source.charAt(index + 1) === "&") {
      throw new Error(`friendly-error pattern ${pattern} has && inside a class`);
    } else {
      if (char === "[") inClass = true;
      if (char === "]" && inClass) inClass = false;
      out += char;
    }
  }
  return `${pattern.flags === "i" ? "(?i)" : ""}${out}`;
};

/**
 * `rawServiceDiagnostic` keeps its length limit and two patterns inline, and the extension is not
 * restructured to export them, so they are read from its source: the limit after
 * `value.length >`, and the two regex literals tested against `value`, in order (line breaks,
 * then a JSON body). Anything else in that body fails generation loudly rather than drifting.
 */
const RAW_SERVICE = (() => {
  const source = readFileSync(
    new URL(
      "../../packages/presentation/wallet-ui/src/sidepanel/runtime/friendly-error.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const body = /\nconst rawServiceDiagnostic = \(value: string\): boolean =>\n([\s\S]*?);\n/.exec(
    source,
  )?.[1];
  const limit = body === undefined ? undefined : /value\.length > (\d+) \|\|/.exec(body)?.[1];
  const literals = [...(body ?? "").matchAll(/\/((?:\\.|[^/\n])+)\/([a-z]*)\.test\(value\)/g)];
  const [lineBreak, rawJson] = literals.map(
    ([, pattern = "", flags]) => new RegExp(pattern, flags),
  );
  if (limit === undefined || literals.length !== 2 || !lineBreak || !rawJson) {
    throw new Error("friendly-error.ts rawServiceDiagnostic no longer has the shape this reads");
  }
  return { lineBreak, maxLength: Number(limit), rawJson };
})();

const RULES = FRIENDLY_ERROR_RULES;

const PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["developerVoice", RULES.developerVoice],
  ["lineBreak", RAW_SERVICE.lineBreak],
  ["rateLimit", RULES.rateLimit],
  ["rawHttp", RULES.rawHttp],
  ["rawJson", RAW_SERVICE.rawJson],
  ["rawRpc", RULES.rawRpc],
  ["rawRpcResponse", RULES.rawRpcResponse],
  ["strk20", RULES.strk20],
  ["strk20OutageCause", RULES.strk20OutageCause],
  ["strk20PrivacyLeak", RULES.strk20PrivacyLeak],
  ["strk20Protocol", RULES.strk20Protocol],
  ["strk20ServiceDown", RULES.strk20ServiceDown],
  ["strk20Stage", RULES.strk20Stage],
  ["validationRequest", RULES.validationRequest],
  ["factTerms", FACT_TERMS],
  ["kmsTemplatePlumbing", KMS_TEMPLATE_PLUMBING],
];

const MESSAGES: Readonly<Record<string, string>> = {
  genericValidation: GENERIC_VALIDATION,
  networkError: NETWORK_ERROR_MESSAGE,
  privacyLeak: PRIVACY_LEAK,
  rateLimited: RATE_LIMITED,
  rpcRejected: RPC_REJECTED,
  serviceRejected: SERVICE_REJECTED,
  strk20RateLimited: RULES.strk20RateLimited,
  strk20ServicesDown: RULES.strk20ServicesDown,
  unexpectedFallback: UNEXPECTED_FALLBACK,
};

/** Each STRK20 category's sentence without a detail, and with `{detail}` in its place. */
const STAGES = [...RULES.strk20StageCopy].map(
  ([category, sentence]) => [category, sentence(undefined), sentence(DETAIL)] as const,
);

const byKey = <T>(entries: Iterable<readonly [string, T]>): (readonly [string, T])[] =>
  [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const swift = (value: string): string => JSON.stringify(value);
const kotlin = (value: string): string => JSON.stringify(value).replaceAll("$", () => "\\$");
// A Swift raw literal keeps a pattern's backslashes as written.
const swiftRaw = (value: string): string => `#"${value}"#`;

const swiftCopy = (): string =>
  [
    `// ${HEADER}`,
    "",
    "/// The extension's `ERROR_COPY` (friendly-error-copy.ts and the tables it merges), keyed by",
    "/// the lowercased raw message. Read by `FriendlyError`.",
    "enum FriendlyErrorCopy {",
    "    static let table: [String: String] = [",
    ...byKey(ERROR_COPY).map(([key, value]) => `        ${swift(key)}: ${swift(value)},`),
    "    ]",
    "}",
    "",
  ].join("\n");

const kotlinCopy = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.errors",
    "",
    "/**",
    " * The extension's `ERROR_COPY` (friendly-error-copy.ts and the tables it merges), keyed by",
    " * the lowercased raw message. Read by [friendlyError].",
    " */",
    "object FriendlyErrorCopy {",
    "    val table: Map<String, String> =",
    "        mapOf(",
    ...byKey(ERROR_COPY).map(([key, value]) => `            ${kotlin(key)} to ${kotlin(value)},`),
    "        )",
    "}",
    "",
  ].join("\n");

const swiftRules = (): string =>
  [
    `// ${HEADER}`,
    "",
    "/// The rules of the extension's `friendlyError`, as data: its messages, patterns (ICU sources),",
    "/// reviewed plumbing, Ledger catalog, transport markers and STRK20 category sentences.",
    "enum FriendlyErrorRules {",
    ...Object.entries(MESSAGES).map(([key, value]) => `    static let ${key} = ${swift(value)}`),
    `    static let rawServiceMaxLength = ${RAW_SERVICE.maxLength}`,
    `    static let detail = ${swift(DETAIL)}`,
    ...PATTERNS.map(([key, value]) => `    static let ${key} = ${swiftRaw(portable(value))}`),
    "    static let networkMarkers: [String] = [",
    ...NETWORK_FAILURE_MARKERS.map((marker) => `        ${swift(marker)},`),
    "    ]",
    "    static let ledgerMessages: [String: String] = [",
    ...byKey(Object.entries(MOBILE_LEDGER_MESSAGES)).map(
      ([key, value]) => `        ${swift(key)}: ${swift(value)},`,
    ),
    "    ]",
    "    /// Category → (sentence without a detail, sentence with `{detail}`).",
    "    static let strk20Stages: [String: (bare: String, detailed: String)] = [",
    ...STAGES.map(
      ([key, bare, detailed]) => `        ${swift(key)}: (${swift(bare)}, ${swift(detailed)}),`,
    ),
    "    ]",
    "    static let reviewedPlumbing: Set<String> = [",
    ...byKey(REVIEWED_PLUMBING).map(([key]) => `        ${swift(key)},`),
    "    ]",
    "}",
    "",
  ].join("\n");

const kotlinRules = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.errors",
    "",
    "/**",
    " * The rules of the extension's `friendlyError`, as data: its messages, patterns (java.util.regex",
    " * sources), reviewed plumbing, Ledger catalog, transport markers and STRK20 category sentences.",
    " */",
    "object FriendlyErrorRules {",
    ...Object.entries(MESSAGES).map(([key, value]) => `    const val ${key} = ${kotlin(value)}`),
    `    const val rawServiceMaxLength = ${RAW_SERVICE.maxLength}`,
    `    const val detail = ${kotlin(DETAIL)}`,
    ...PATTERNS.map(([key, value]) => `    const val ${key} = ${kotlin(portable(value))}`),
    "    val networkMarkers: List<String> =",
    "        listOf(",
    ...NETWORK_FAILURE_MARKERS.map((marker) => `            ${kotlin(marker)},`),
    "        )",
    "    val ledgerMessages: Map<String, String> =",
    "        mapOf(",
    ...byKey(Object.entries(MOBILE_LEDGER_MESSAGES)).map(
      ([key, value]) => `            ${kotlin(key)} to ${kotlin(value)},`,
    ),
    "        )",
    "",
    "    /** Category → (sentence without a detail, sentence with `{detail}`). */",
    "    val strk20Stages: Map<String, Pair<String, String>> =",
    "        mapOf(",
    ...STAGES.map(
      ([key, bare, detailed]) =>
        `            ${kotlin(key)} to (${kotlin(bare)} to ${kotlin(detailed)}),`,
    ),
    "        )",
    "    val reviewedPlumbing: Set<String> =",
    "        setOf(",
    ...byKey(REVIEWED_PLUMBING).map(([key]) => `            ${kotlin(key)},`),
    "        )",
    "}",
    "",
  ].join("\n");

/** Repository-relative paths of the generated parity vectors the native unit tests read. */
const FRIENDLY_ERROR_VECTOR_PATHS = {
  kotlin:
    "mobile/android/app/src/test/java/org/bramble/wallet/errors/FriendlyErrorVectors.generated.kt",
  swift: "mobile/ios/BrambleTests/FriendlyErrorVectors.generated.swift",
} as const;

/**
 * Raw strings the core and the services actually produce, plus one per branch of
 * `friendlyError`. Each is rendered with what the extension's own `friendlyError` answers today,
 * so the native ports are checked against the extension rather than against a retyped answer.
 */
const VECTOR_INPUTS: readonly string[] = [
  // wallet-core v0.7.0 `SwapRefusal`, `BuildPolicyError` and `SwapError`.
  "swaps are not available on this network",
  "invalid swap quote request",
  "token unavailable on this network",
  "pick two different tokens",
  "enter an amount to swap",
  "swap quote failed",
  "no swap route available for this pair",
  "invalid swap quote",
  "swap quote does not match the requested pair",
  "invalid swap preparation request",
  "swap quote is not reviewable — request a fresh price",
  "swap build failed",
  "invalid swap build response",
  "invalid swap call",
  "swap preparation changed",
  "swap preparation not found",
  "swap build returned too many calls",
  "swap build touched an unexpected token approval",
  "swap build approved an unexpected spender",
  "swap build called a contract that is not the avnu router",
  "swap build routed the proceeds to another account",
  "swap build accepted less than the minimum you reviewed",
  "swap build returned a route the wallet could not decode",
  "swap build charged an aggregator fee beyond the wallet's cap",
  "wallet is locked",
  "unknown account",
  "a wallet file could not be read",
  // `RevokeError` and the invoke refusals a revoke can carry.
  "invalid revoke request",
  "switch to the account that granted this allowance",
  "allowance not found",
  "this contract is an NFT collection, not a token; revoke it from the dapp",
  "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an NFT instead; revoke it from the dapp",
  "invalid call",
  "too many calls",
  "calldata too long",
  "No calls to submit",
  // Argent multisig refusals.
  "Invalid Argent multisig intent package",
  "Invalid Argent multisig calls",
  "Invalid Argent multisig deployment",
  "Argent multisig intent invalid",
  "Argent multisig intent conflict",
  "Argent multisig intent is not ready",
  "Argent multisig intent was already submitted",
  "Argent multisig intent nonce is no longer current",
  "Argent multisig intent is stale after a configuration change",
  "Argent multisig signature is not from a configured signer",
  "Argent multisig signatures must use distinct signers",
  "Argent multisig threshold is not satisfied",
  "Argent multisig signer configuration changed on-chain",
  "Argent multisig not found",
  "Argent multisig submission claim exists",
  "Argent multisig batches cannot contain account self-calls",
  // One per branch of `friendlyError`.
  "",
  "   ",
  "device-locked",
  "invalid widget request",
  "invalid ledger account index",
  "krusty kms export missing: sign_hash",
  "strk20 privacy leak: linked address",
  "strk20 services unavailable (rate limited; retry shortly)",
  "strk20 services unavailable",
  "strk20 services unavailable: no rpc endpoint is configured",
  "strk20 services unavailable (submit/execution-reverted): out of gas",
  "strk20 services unavailable (submit/execution-reverted)",
  "strk20 services unavailable (submit/invalid-nonce): nonce 5",
  "strk20 services unavailable (submit/rate-limited): 429",
  "strk20 services unavailable (prove/transport): fetch failed",
  "strk20 services unavailable (prove/service-unavailable): busy",
  "strk20 services unavailable (prove/odd-category): detail",
  "strk20 services unavailable: Indexer API /notes failed (503): busy",
  "strk20 services unavailable: Too Many Requests",
  "strk20 services unavailable: socket hang up",
  "strk20 services unavailable: something else",
  "strk20 submission status unknown",
  "HTTP 429 from the gateway",
  "RPC: starknet_call with params {}",
  "41: Transaction execution error",
  "Contract not found",
  "Failed to fetch",
  "socket hang up",
  "x".repeat(241),
  "Line one\nline two",
  '{"error":"boom"}',
  "Gateway said HTTP 503",
  "add token failed",
  "nonce changed while signing",
  "Already a sentence.",
];

/** The parity vectors for both unit-test suites. */
const renderFriendlyErrorVectors = (): readonly (readonly [string, string])[] => {
  const pairs = VECTOR_INPUTS.map((raw) => [raw, friendlyError(raw).message] as const);
  return [
    [
      FRIENDLY_ERROR_VECTOR_PATHS.swift,
      [
        `// ${HEADER}`,
        "",
        "/// Raw message → what the extension's `friendlyError` shows for it today.",
        "enum FriendlyErrorVectors {",
        "    static let cases: [(raw: String, shown: String)] = [",
        ...pairs.map(([raw, shown]) => `        (${swift(raw)}, ${swift(shown)}),`),
        "    ]",
        "}",
        "",
      ].join("\n"),
    ],
    [
      FRIENDLY_ERROR_VECTOR_PATHS.kotlin,
      [
        `// ${HEADER}`,
        "package org.bramble.wallet.errors",
        "",
        "/** Raw message → what the extension's `friendlyError` shows for it today. */",
        "object FriendlyErrorVectors {",
        "    val cases: List<Pair<String, String>> =",
        "        listOf(",
        ...pairs.map(([raw, shown]) => `            ${kotlin(raw)} to ${kotlin(shown)},`),
        "        )",
        "}",
        "",
      ].join("\n"),
    ],
  ];
};

/** Every generated friendly-error source keyed by repository-relative path. */
export const renderFriendlyErrors = (): readonly (readonly [string, string])[] => [
  [FRIENDLY_ERROR_PATHS.swiftCopy, swiftCopy()],
  [FRIENDLY_ERROR_PATHS.swiftRules, swiftRules()],
  [FRIENDLY_ERROR_PATHS.kotlinCopy, kotlinCopy()],
  [FRIENDLY_ERROR_PATHS.kotlinRules, kotlinRules()],
  ...renderFriendlyErrorVectors(),
];
