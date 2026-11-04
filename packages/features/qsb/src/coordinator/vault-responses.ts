/**
 * Strict parsers for the coordinator's vault records: one vault as
 * `publicVaultSchema` defines it (qsb-app `src/lib/model.ts`), the vault
 * list, a deposit submission's answer and a deposit's funding status.
 *
 * Trust boundary: every coordinator answer is untrusted. Each parser accepts
 * only the exact keys the server writes, each in its grammar and bounds, and
 * returns null for anything else; it never coerces, truncates or echoes.
 * Hex is accepted in either case, as the server's schema allows, and
 * returned lowercase, so one byte string has one spelling here.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { QsbSubmission } from "@bramble/wallet-model/qsb-vaults";
import { QSB_COORDINATOR_NETWORK } from "./origin";
import {
  isQsbUuid,
  type QsbOutpoint,
  readHex,
  readList,
  readOutpoint,
  readSats,
  readTxid,
} from "./response-grammar";

/** Where a vault's one deposit stands on the coordinator. */
export type QsbVaultStatus = "confirmed" | "spent" | "submitted" | "unfunded";

/** A vault as the coordinator records it: public data only. */
export type QsbPublicVault = {
  readonly configuration: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly funding: QsbOutpoint | null;
  readonly id: string;
  readonly name: string;
  readonly paymentAddress: string;
  readonly publicStateJson: string;
  readonly scriptHash: string;
  readonly scriptHex: string;
  readonly status: QsbVaultStatus;
};

/** The owner's vaults, and which of them take no deposit (by server id). */
export type QsbVaultList = {
  readonly noDeposit: readonly string[];
  readonly vaults: readonly QsbPublicVault[];
};

/** The coordinator's answer to a deposit submission or a resend. */
export type QsbSubmitAnswer = {
  readonly submission: QsbSubmission;
  readonly vault: QsbPublicVault;
};

/** A funded vault's deposit as the chain (or, until mined, the coordinator) has it. */
export type QsbFundingStatus = {
  readonly confirmations: number;
  readonly confirmed: boolean;
  readonly previousTxHex: string;
  readonly vault: QsbPublicVault;
};

// Bounds from publicVaultSchema; the list bound is Bramble's.
const MAX_SCRIPT_HEX = 20_000;
const MAX_PUBLIC_STATE = 60_000;
const MAX_VAULTS = 256;
const MAX_TRANSACTION_HEX = 8_000_000;
const CONFIGURATION_KEYS = [
  "config",
  "generatorCommit",
  "network",
  "protocol",
  "publicStateHash",
  "scriptBytesHash",
  "scriptHash",
] as const;
const VAULT_KEYS = [
  "config",
  "configuration",
  "createdAt",
  "funding",
  "id",
  "name",
  "network",
  "paymentAddress",
  "publicStateJson",
  "scriptHash",
  "scriptHex",
  "status",
] as const;
const STATUSES: readonly string[] = ["confirmed", "spent", "submitted", "unfunded"];
const SUBMISSIONS: readonly string[] = ["rejected", "submitted", "uncertain"];
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const isBoundedString = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;

const readConfiguration = (value: unknown): Readonly<Record<string, string>> | null => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, CONFIGURATION_KEYS)) return null;
  const hashes = ["publicStateHash", "scriptBytesHash", "scriptHash"].map((key) =>
    readTxid(value[key]),
  );
  const strings = ["config", "generatorCommit", "network", "protocol"].map((key) => value[key]);
  if (hashes.some((hash) => hash === null) || !strings.every((text) => typeof text === "string")) {
    return null;
  }
  return Object.fromEntries(
    CONFIGURATION_KEYS.map((key) => [key, readTxid(value[key]) ?? (value[key] as string)]),
  );
};

// Every field but the optional `funding`, present and in its grammar.
const hasVaultFields = (value: Record<string, unknown>): boolean =>
  hasOnlyKnownKeys(value, VAULT_KEYS) &&
  isQsbUuid(value["id"]) &&
  isBoundedString(value["name"], 1, 60) &&
  typeof value["createdAt"] === "string" &&
  DATETIME.test(value["createdAt"]) &&
  value["network"] === QSB_COORDINATOR_NETWORK &&
  value["config"] === "A" &&
  isBoundedString(value["paymentAddress"], 14, 100) &&
  isBoundedString(value["publicStateJson"], 0, MAX_PUBLIC_STATE) &&
  typeof value["status"] === "string" &&
  STATUSES.includes(value["status"]);

/** Parses one vault record, or null. */
export const readQsbPublicVault = (value: unknown): QsbPublicVault | null => {
  if (!isRecord(value) || !hasVaultFields(value)) return null;
  const scriptHex = readHex(value["scriptHex"], 1, MAX_SCRIPT_HEX / 2);
  const scriptHash = readTxid(value["scriptHash"]);
  const configuration = readConfiguration(value["configuration"]);
  const funding = value["funding"] === undefined ? null : readOutpoint(value["funding"]);
  if (!scriptHex || !scriptHash || !configuration || funding === undefined) return null;
  if (value["funding"] !== undefined && funding === null) return null;
  return {
    configuration,
    createdAt: value["createdAt"] as string,
    funding,
    id: (value["id"] as string).toLowerCase(),
    name: value["name"] as string,
    paymentAddress: value["paymentAddress"] as string,
    publicStateJson: value["publicStateJson"] as string,
    scriptHash,
    scriptHex,
    status: value["status"] as QsbVaultStatus,
  };
};

const STRAY_OUTPUT_KEYS = ["firstSeenAt", "txid", "value", "vout"] as const;
const isStrayPayments = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["count", "outputs", "sats", "vaultId"]) &&
  isQsbUuid(value["vaultId"]) &&
  Number.isSafeInteger(value["count"]) &&
  (value["count"] as number) >= 1 &&
  readSats(value["sats"]) !== null &&
  readList(value["outputs"], 20, (output) =>
    isRecord(output) &&
    hasOnlyKnownKeys(output, STRAY_OUTPUT_KEYS) &&
    typeof output["firstSeenAt"] === "string" &&
    DATETIME.test(output["firstSeenAt"]) &&
    readOutpoint({ txid: output["txid"], value: output["value"], vout: output["vout"] }) !== null
      ? true
      : null,
  ) !== null;

/**
 * Parses `GET /v1/vaults`: `vaults`, `resendable`, `noDeposit` and
 * `strayPayments`, all four present. Server ids are matched to Bramble's
 * vaults by script hash, never kept.
 */
export const readQsbVaultList = (value: unknown): QsbVaultList | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["noDeposit", "resendable", "strayPayments", "vaults"])
  ) {
    return null;
  }
  const vaults = readList(value["vaults"], MAX_VAULTS, readQsbPublicVault);
  const uuid = (id: unknown): string | null => (isQsbUuid(id) ? id.toLowerCase() : null);
  const noDeposit = readList(value["noDeposit"], MAX_VAULTS, uuid);
  const resendable = readList(value["resendable"], MAX_VAULTS, uuid);
  const stray = readList(value["strayPayments"], MAX_VAULTS, (entry) =>
    isStrayPayments(entry) ? true : null,
  );
  if (!vaults || !noDeposit || !resendable || !stray) return null;
  return new Set(vaults.map((vault) => vault.id)).size === vaults.length
    ? { noDeposit, vaults }
    : null;
};

/** Parses a `fund/submit` or `fund/resubmit` answer: `{ vault, submission, reason? }`. */
export const readQsbSubmitAnswer = (value: unknown): QsbSubmitAnswer | null => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["reason", "submission", "vault"])) return null;
  const vault = readQsbPublicVault(value["vault"]);
  const submission = value["submission"];
  const reason = value["reason"];
  return vault &&
    typeof submission === "string" &&
    SUBMISSIONS.includes(submission) &&
    (reason === undefined || isBoundedString(reason, 0, 2_000))
    ? { submission: submission as QsbSubmission, vault }
    : null;
};

const readChainStatus = (
  value: unknown,
): { readonly confirmations: number; readonly confirmed: boolean } | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["blockHash", "blockHeight", "confirmations", "confirmed"]) ||
    typeof value["confirmed"] !== "boolean" ||
    !Number.isSafeInteger(value["confirmations"]) ||
    (value["confirmations"] as number) < 0 ||
    (value["blockHash"] !== undefined && readTxid(value["blockHash"]) === null) ||
    (value["blockHeight"] !== undefined &&
      !(Number.isSafeInteger(value["blockHeight"]) && (value["blockHeight"] as number) >= 0))
  ) {
    return null;
  }
  const confirmations = value["confirmations"] as number;
  // A confirmed deposit has at least one confirmation; an unconfirmed one none.
  return (value["confirmed"] === true) === confirmations > 0
    ? { confirmations, confirmed: value["confirmed"] }
    : null;
};

/** Parses `GET /v1/vaults/:id/funding`. */
export const readQsbFundingStatus = (value: unknown): QsbFundingStatus | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["previousTxHex", "status", "strayPayments", "submission", "vault"])
  ) {
    return null;
  }
  const vault = readQsbPublicVault(value["vault"]);
  const status = readChainStatus(value["status"]);
  const previousTxHex = readHex(value["previousTxHex"], 1, MAX_TRANSACTION_HEX / 2);
  const stray = value["strayPayments"];
  const submission = value["submission"];
  return vault &&
    status &&
    previousTxHex &&
    (stray === null || stray === undefined || isStrayPayments(stray)) &&
    (submission === undefined ||
      (typeof submission === "string" && SUBMISSIONS.includes(submission)))
    ? { ...status, previousTxHex, vault }
    : null;
};
