/**
 * Shared identifier validators for extension-generated ids.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * Checks extension-generated UUID values.
 */
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

/**
 * Checks the `sha256:<64 lowercase hex>` tag `digestApprovalPayload` emits — the
 * form every frozen preparation id and every approval payload digest takes.
 *
 * This is the one shared spelling. It is what binds a reviewed payload to the
 * execute message that spends it, so the background readers, the approval-queue
 * reader, and the panel clients must all accept exactly the same strings: a
 * boundary with a private copy could admit an id the producer never issues, or
 * refuse one it did. Do not re-derive the pattern locally (seven copies once
 * existed). A non-string is rejected rather than coerced.
 */
export const isSha256Digest = (value: unknown): value is string =>
  typeof value === "string" && SHA256_DIGEST_PATTERN.test(value);

const STRK20_JOB_ID_PATTERN = /^strk20job-[0-9a-z]{1,12}-[0-9]{1,9}$/;

/**
 * Checks the id of a tracked STRK20 background job: the worker-boot stamp and
 * per-boot counter the background mints, e.g. `strk20job-1a2b3c-7`. One shared
 * spelling for the background reader and the panel poll, so neither can drift
 * into accepting an id the other never issues. A non-string is rejected.
 */
export const isStrk20JobId = (value: unknown): value is string =>
  typeof value === "string" && STRK20_JOB_ID_PATTERN.test(value);
