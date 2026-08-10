/**
 * Panel-facing validators for the privileged Ledger responses: the pending
 * device-sign list, the bare ok acknowledgement, and the derived account-picker
 * list. Each parses an untrusted background reply at the boundary into a precise
 * type, so a malformed hash, path, account id, or a non-Ledger account can never
 * reach the device flow. Split from responses.ts to stay within the size budget.
 * No secret material crosses: a Ledger reply carries only public keys, indices,
 * paths, and a public `(r, s)` pair.
 */
import { hasOnlyKnownKeys, hasUniqueStrings, isJson, isRecord } from "../shared/json";
import { isLedgerSignIntent, type LedgerSignIntent } from "../starknet/ledger-intent";
import { isLedgerAccountPath } from "../starknet/ledger-path";
import { isStarkFieldElement } from "../starknet/networks";
import { isAccountId, isAccountRef, type LedgerAccountRef } from "../storage/vault-schema";

/**
 * A pending device-sign the side panel that owns the Ledger transport must
 * fulfil: the background queue id, the account it belongs to, what the signature
 * authorizes, the host-computed hash to blind-sign, the exact stored derivation
 * path to hand the device, and the account's stored public x-coordinate so the
 * panel can reject a wrong device before the on-device confirm. Carries no
 * secret material — the private key never leaves the device and `publicKeyX` is
 * public.
 *
 * `intent` is background-chosen, never dapp-supplied; the validator below
 * rejects an unknown one so the prompt cannot render an unlabelled hash.
 */
export type LedgerSignRequestSummary = {
  readonly accountId: string;
  readonly id: string;
  readonly intent: LedgerSignIntent;
  readonly messageHash: string;
  readonly path: string;
  readonly publicKeyX: string;
};

/**
 * Pending device-sign requests accepted from the background boundary.
 */
export type LedgerSignPendingResponse = {
  readonly ok: true;
  readonly pending: readonly LedgerSignRequestSummary[];
};

/**
 * A bare acknowledgement response with no payload, returned by fire-and-forget
 * privileged operations such as completing a device sign.
 */
export type OkResponse = {
  readonly ok: true;
};

/**
 * Derived Ledger account-picker candidates accepted from the background
 * boundary. Every entry is a keyless {@link LedgerAccountRef}.
 */
export type LedgerAccountsResponse = {
  readonly accounts: readonly LedgerAccountRef[];
  readonly ok: true;
};

/**
 * One Ledger candidate's best-effort on-chain state accepted from the background
 * boundary: whether the account is deployed and its balance display string. Both
 * fields are nullable — a degraded RPC yields `null` so the picker shows
 * "checking"/"unavailable" rather than blocking or fabricating a value.
 */
export type LedgerAccountStatusResponse = {
  readonly balance: string | null;
  readonly deployed: boolean | null;
  readonly ok: true;
};

const isLedgerSignRequestSummary = (value: unknown): value is LedgerSignRequestSummary =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "id", "intent", "messageHash", "path", "publicKeyX"]) &&
  typeof value["id"] === "string" &&
  value["id"].length > 0 &&
  isAccountId(value["accountId"]) &&
  isLedgerSignIntent(value["intent"]) &&
  typeof value["messageHash"] === "string" &&
  isStarkFieldElement(value["messageHash"]) &&
  typeof value["publicKeyX"] === "string" &&
  isStarkFieldElement(value["publicKeyX"]) &&
  isLedgerAccountPath(value["path"]);

/**
 * Checks pending device-sign responses before the panel drives the device, so a
 * malformed hash or path can never reach `signHash`.
 */
export const isLedgerSignPendingResponse = (value: unknown): value is LedgerSignPendingResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "pending"]) &&
  value["ok"] === true &&
  Array.isArray(value["pending"]) &&
  value["pending"].every(isLedgerSignRequestSummary);

/**
 * Checks bare acknowledgement responses before treating an operation as done.
 */
export const isOkResponse = (value: unknown): value is OkResponse =>
  isRecord(value) && hasOnlyKnownKeys(value, ["ok"]) && value["ok"] === true;

/**
 * Checks per-candidate on-chain status responses before the picker renders a
 * deployed badge or balance, so a malformed reply degrades to unavailable rather
 * than showing a fabricated status.
 */
export const isLedgerAccountStatusResponse = (
  value: unknown,
): value is LedgerAccountStatusResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["balance", "deployed", "ok"]) &&
  value["ok"] === true &&
  (value["balance"] === null || typeof value["balance"] === "string") &&
  (value["deployed"] === null || typeof value["deployed"] === "boolean");

/**
 * Checks derived Ledger account responses before rendering the account picker.
 * Every candidate must be a keyless Ledger account.
 */
export const isLedgerAccountsResponse = (value: unknown): value is LedgerAccountsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["accounts", "ok"]) &&
  value["ok"] === true &&
  Array.isArray(value["accounts"]) &&
  value["accounts"].every(
    (account) => isAccountRef(account) && account.derivation.kind === "ledger",
  ) &&
  hasUniqueStrings(value["accounts"].map((account) => account.id));
