/**
 * Strict parsers for the coordinator's non-vault answers: the deployment's
 * configuration, MARA's rates, the sign-in challenge and session, the owner's
 * confirmed outputs, one payment input, and the body of a refusal (qsb-app
 * `server/app.ts` and `server/chain.ts` at the pinned commit).
 *
 * Trust boundary: each answer is untrusted and parsed into exactly the fields
 * Bramble acts on, each in its grammar; null otherwise. The configuration is
 * the one answer whose other fields (release checks, region, billing) are
 * informational and ignored, since the deployment adds them freely; every
 * field a deposit gate reads is checked.
 */
import { isRecord } from "@bramble/core/json";
import {
  hasExactKeys,
  isQsbUuid,
  type QsbOutpoint,
  readHex,
  readList,
  readOutpoint,
} from "./response-grammar";

/** An outpoint as the coordinator names one, re-exported from its grammar. */
export type { QsbOutpoint } from "./response-grammar";

/** The deployment switches a QSB request is gated on. */
export type QsbConfig = {
  readonly exactSubmitEnabled: boolean;
  readonly network: string;
  readonly operationsEnabled: boolean;
  /** Null when the deployment's owner limits are misconfigured. */
  readonly ownerLimits: { readonly allowlisted: boolean | null } | null;
  /** The solver release a withdrawal job must pin, or null when none is served. */
  readonly solverReleaseId: string | null;
};

/** MARA Slipstream's two floor inputs, in sat/vB. */
export type QsbRates = {
  readonly marketRate: number;
  readonly submitFeeRate: number;
};

/** One sign-in challenge: its id and the exact message to check and sign. */
export type QsbChallenge = {
  readonly id: string;
  readonly message: string;
};

/** A payment input's full previous transaction, lowercase hex. */
export type QsbPaymentInput = {
  readonly previousTxHex: string;
};

/** A refusal's machine-readable code, when the coordinator sent one. */
export type QsbRefusalBody = {
  readonly code: string | null;
};

const RATE_KEYS = [
  "discounted_multiplier",
  "effective_rate",
  "market_rate",
  "multiplier",
  "multiplier_discount_percent",
  "slipstream_rate",
  "submit_fee_rate",
] as const;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SOLVER_RELEASE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_CHALLENGE_LENGTH = 1_000;
// The owner's confirmed outputs Bramble will consider; an address with more
// is refused rather than truncated, which would misstate its funds.
const MAX_PAYMENT_UTXOS = 1_000;
const MAX_TRANSACTION_HEX = 8_000_000;

const isRate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const readOwnerLimits = (value: unknown): QsbConfig["ownerLimits"] | undefined => {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const allowlisted = value["allowlisted"];
  return allowlisted === null || typeof allowlisted === "boolean" ? { allowlisted } : undefined;
};

/**
 * Parses `GET /v1/config`, reading the gate fields only. A solver release id
 * outside its grammar reads as none served, which a withdrawal refuses.
 */
export const readQsbConfig = (value: unknown): QsbConfig | null => {
  if (!isRecord(value)) return null;
  const ownerLimits = readOwnerLimits(value["ownerLimits"]);
  const { exactSubmitEnabled, network, operationsEnabled, solverReleaseId } = value;
  return ownerLimits !== undefined &&
    typeof exactSubmitEnabled === "boolean" &&
    typeof network === "string" &&
    typeof operationsEnabled === "boolean"
    ? {
        exactSubmitEnabled,
        network,
        operationsEnabled,
        ownerLimits,
        solverReleaseId:
          typeof solverReleaseId === "string" && SOLVER_RELEASE.test(solverReleaseId)
            ? solverReleaseId
            : null,
      }
    : null;
};

/** Parses `GET /v1/rates`: exactly Slipstream's seven non-negative rates. */
export const readQsbRates = (value: unknown): QsbRates | null =>
  hasExactKeys(value, RATE_KEYS) && RATE_KEYS.every((key) => isRate(value[key]))
    ? {
        marketRate: value["market_rate"] as number,
        submitFeeRate: value["submit_fee_rate"] as number,
      }
    : null;

/** Parses `POST /v1/auth/challenge`: `{ id, message }`. */
export const readQsbChallenge = (value: unknown): QsbChallenge | null =>
  hasExactKeys(value, ["id", "message"]) &&
  isQsbUuid(value["id"]) &&
  typeof value["message"] === "string" &&
  value["message"].length <= MAX_CHALLENGE_LENGTH
    ? { id: value["id"], message: value["message"] }
    : null;

/** Parses `POST /v1/auth/verify`: `{ token }`, 43 base64url characters. */
export const readQsbSessionToken = (value: unknown): string | null =>
  hasExactKeys(value, ["token"]) &&
  typeof value["token"] === "string" &&
  SESSION_TOKEN.test(value["token"])
    ? value["token"]
    : null;

/**
 * Parses `GET /v1/payment-utxos`: the owner's confirmed outputs, refusing a
 * list that names one outpoint twice.
 */
export const readQsbPaymentUtxos = (value: unknown): readonly QsbOutpoint[] | null => {
  if (!hasExactKeys(value, ["utxos"])) return null;
  const utxos = readList(value["utxos"], MAX_PAYMENT_UTXOS, readOutpoint);
  return utxos && new Set(utxos.map((utxo) => `${utxo.txid}:${utxo.vout}`)).size === utxos.length
    ? utxos
    : null;
};

/** Parses `POST /v1/payment-input`: a confirmed output's previous transaction. */
export const readQsbPaymentInput = (value: unknown): QsbPaymentInput | null => {
  if (!hasExactKeys(value, ["confirmations", "previousTxHex"])) return null;
  const previousTxHex = readHex(value["previousTxHex"], 1, MAX_TRANSACTION_HEX / 2);
  const confirmations = value["confirmations"];
  return previousTxHex && Number.isSafeInteger(confirmations) && (confirmations as number) >= 1
    ? { previousTxHex }
    : null;
};

/** Reads a refusal body `{ error, code?, ... }` for its code; never its message. */
export const readQsbRefusalBody = (value: unknown): QsbRefusalBody => {
  const code = isRecord(value) ? value["code"] : undefined;
  return { code: typeof code === "string" && ERROR_CODE.test(code) ? code : null };
};
