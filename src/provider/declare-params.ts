/**
 * Pure validation of dapp `wallet_addDeclareTransaction` params (DECLARE_TXN),
 * shared by the provider bridge and the background handler. The CONTRACT_CLASS
 * is large and carried opaquely; only the hashes are pattern-checked here.
 */
import { hasOnlyKnownKeys, isRecord, type Json } from "../shared/json";

/**
 * A declare transaction a dapp asks the wallet to submit, after bridge
 * validation. `contractClass` is the opaque CONTRACT_CLASS kept out of the UI.
 */
export type ProviderDeclare = {
  readonly classHash?: string;
  readonly compiledClassHash: string;
  readonly contractClass: Json;
};

const isFelt = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value);

/**
 * Parses a `{ declare_transaction: { compiled_class_hash, contract_class, ... } }`
 * payload, requiring the compiled class hash and a non-empty contract class.
 * Returns the internal camelCase declare, or null for any malformed payload.
 */
export const readProviderDeclare = (params: Json | undefined): ProviderDeclare | null => {
  if (
    !isRecord(params) ||
    !hasOnlyKnownKeys(params, ["declare_transaction"]) ||
    !isRecord(params["declare_transaction"])
  ) {
    return null;
  }
  const declare = params["declare_transaction"];
  if (
    !hasOnlyKnownKeys(declare, ["class_hash", "compiled_class_hash", "contract_class"]) ||
    !isFelt(declare["compiled_class_hash"]) ||
    (declare["class_hash"] !== undefined && !isFelt(declare["class_hash"])) ||
    !isRecord(declare["contract_class"]) ||
    Object.keys(declare["contract_class"]).length === 0
  ) {
    return null;
  }
  return {
    compiledClassHash: declare["compiled_class_hash"],
    contractClass: declare["contract_class"],
    ...(declare["class_hash"] === undefined ? {} : { classHash: declare["class_hash"] }),
  };
};

/**
 * Narrows an untrusted value to the internal camelCase `ProviderDeclare` shape,
 * used by the background handler to re-validate a declare crossed from the
 * bridge.
 */
export const isProviderDeclare = (value: unknown): value is ProviderDeclare =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["classHash", "compiledClassHash", "contractClass"]) &&
  isFelt(value["compiledClassHash"]) &&
  (value["classHash"] === undefined || isFelt(value["classHash"])) &&
  isRecord(value["contractClass"]) &&
  Object.keys(value["contractClass"]).length > 0;
