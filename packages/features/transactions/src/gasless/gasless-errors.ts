/**
 * Refusals from the gasless paymaster route. A stated gateway code is a
 * determinate refusal: nothing was accepted, and the caller must not retry
 * the same execution. `screening_unavailable` is the exception — screening
 * stopped before the relay was asked, so a later attempt is safe. A lost
 * execute reply is not one of these; that is an `IndeterminateRpcWriteError`.
 */

import { WalletError } from "@bramble/core/errors";

/**
 * Gateway `error` strings this client understands. On a quote, anything else
 * is still a determinate refusal, reported as `unrecognised`. On execute,
 * only the pre-forward allowlist is a refusal.
 */
export const GASLESS_GATEWAY_CODES = [
  "address_not_allowed",
  "gasless_disabled",
  "invalid_gasless_request",
  "invalid_screening_transaction",
  "screening_denied",
  "screening_pending",
  "screening_subject_unverifiable",
  "screening_unavailable",
  "upstream_rejected",
] as const;

/**
 * A code the gateway writes as `{"error":"<code>"}`, plus the local
 * `unrecognised` bucket for a code this client has not been told to branch on.
 */
export type GaslessGatewayCode = (typeof GASLESS_GATEWAY_CODES)[number] | "unrecognised";

/**
 * Local refusals that never reached the gateway: the route is not ready, the
 * quote could not be checked, or the account cannot sign SNIP-9 v2.
 */
export type GaslessLocalCode = "above_ceiling" | "unavailable" | "unverifiable" | "v2_unsupported";

/**
 * Every refusal the gasless client throws, other than a lost execute reply.
 */
export type GaslessRefusalCode = GaslessGatewayCode | GaslessLocalCode;

const GATEWAY_CODE_SET: ReadonlySet<string> = new Set(GASLESS_GATEWAY_CODES);

/**
 * Whether `value` is a gateway code this client names. Unknown strings are
 * not guessed into a known code.
 */
export const isGaslessGatewayCode = (
  value: string,
): value is (typeof GASLESS_GATEWAY_CODES)[number] => GATEWAY_CODE_SET.has(value);

const messageFor = (code: GaslessRefusalCode): string => {
  switch (code) {
    case "address_not_allowed":
    case "screening_denied":
      return "This account can't pay the network fee in another token.";
    case "screening_pending":
      return "The network fee check is still pending. Nothing was submitted.";
    case "screening_subject_unverifiable":
      return "Deploying on Mainnet needs STRK.";
    case "screening_unavailable":
      return "The network fee could not be checked. Nothing was submitted.";
    case "gasless_disabled":
    case "unavailable":
    case "v2_unsupported":
      return "Paying the network fee in another token is unavailable.";
    case "unverifiable":
      return "This token's network fee could not be checked.";
    case "above_ceiling":
    case "invalid_gasless_request":
    case "invalid_screening_transaction":
    case "unrecognised":
    case "upstream_rejected":
      return "This network fee quote was refused. Nothing was submitted.";
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
};

/**
 * A gasless refusal that did not leave a transaction in flight. `retryable`
 * is true only for `screening_unavailable` after the poster's own retries
 * are spent: the gateway had not asked the relay yet.
 */
export class GaslessRefusal extends WalletError {
  readonly code: GaslessRefusalCode;
  readonly retryable: boolean;

  /**
   * Builds a refusal whose message is the stable sentence for `code`.
   * `retryable` defaults to false so a caller cannot treat a block as a
   * transient error by forgetting the flag.
   */
  public constructor(code: GaslessRefusalCode, retryable = false) {
    super(messageFor(code));
    this.name = "GaslessRefusal";
    this.code = code;
    this.retryable = retryable;
  }
}
