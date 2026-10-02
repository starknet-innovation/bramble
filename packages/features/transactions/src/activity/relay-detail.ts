/**
 * Detail carried by a local "signed for relay" activity row: the SNIP-9
 * `OutsideExecution` this wallet signed, and what a later scan found the
 * relayer execute. Kept in its own module so the core activity store stays
 * within the file-size gate.
 *
 * Trust boundary: a `kind === "relay-signed"` row is written only when this
 * wallet signed an OutsideExecution, and its `messageHash` is the exact SNIP-12
 * hash that signing committed to. A discovered execution row
 * (`origin === "relay"`) comes from chain history and never counts as a payment
 * this wallet made. Every field is revalidated on load so a planted row cannot
 * smuggle an unreadable shape into the feed.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isStarkFieldElement } from "@bramble/wallet-model/networks";

/**
 * The parts of a signed OutsideExecution the feed keeps. `revision`
 * distinguishes the two SNIP-9 message layouts; `messageHash` is the canonical
 * SNIP-12 hash and is present only on the locally signed row.
 */
export type Snip9RelayDetail = {
  readonly callCount: number;
  readonly caller: string;
  readonly dappOrigin?: string;
  readonly messageHash?: string;
  readonly nonce: string;
  readonly revision: "1" | "2";
};

const isRevision = (value: unknown): value is Snip9RelayDetail["revision"] =>
  value === "1" || value === "2";

const isBoundedText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

/**
 * Validates a stored SNIP-9 detail: the felt fields must be canonical field
 * elements, `callCount` a small non-negative integer, and the optional
 * `messageHash` and `dappOrigin` are checked when present.
 */
export const isSnip9RelayDetail = (value: unknown): value is Snip9RelayDetail =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, [
    "callCount",
    "caller",
    "dappOrigin",
    "messageHash",
    "nonce",
    "revision",
  ]) &&
  isRevision(value["revision"]) &&
  typeof value["nonce"] === "string" &&
  isStarkFieldElement(value["nonce"]) &&
  typeof value["caller"] === "string" &&
  isStarkFieldElement(value["caller"]) &&
  typeof value["callCount"] === "number" &&
  Number.isSafeInteger(value["callCount"]) &&
  value["callCount"] >= 0 &&
  (value["messageHash"] === undefined ||
    (typeof value["messageHash"] === "string" && isStarkFieldElement(value["messageHash"]))) &&
  (value["dappOrigin"] === undefined || isBoundedText(value["dappOrigin"]));

/**
 * Enforces the presence rule the feed relies on: the locally signed
 * `"relay-signed"` row must carry a `messageHash`, and a discovered
 * execution row must not, so a chain row can never masquerade as a message this
 * wallet signed.
 */
export const isSnip9DetailForKind = (detail: unknown, kind: unknown): boolean => {
  const relaySignature = kind === "relay-signed";
  if (detail === undefined) {
    return !relaySignature;
  }
  return isSnip9RelayDetail(detail) && (detail.messageHash !== undefined) === relaySignature;
};
