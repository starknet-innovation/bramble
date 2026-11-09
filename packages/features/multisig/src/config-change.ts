/** Stable Argent Multisig 0.2 signer-management decoding and state transitions. */

import { WalletError } from "@bramble/core/errors";
import {
  ARGENT_MULTISIG_MAX_SIGNERS,
  normalizeArgentMultisigConfig,
} from "@bramble/starknet/account-contracts";
import { type ArgentMultisigCall, isArgentMultisigCalls } from "@bramble/starknet/multisig-invoke";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";

const CONFIG_ENTRYPOINTS = new Set([
  "add_signers",
  "change_threshold",
  "remove_signers",
  "replace_signer",
]);

/**
 * Reviewed stable-0.2 authority state. Invalid members or thresholds fail when
 * passed to a transition helper; the type itself contains no private material.
 */
export type ArgentMultisigPublicConfig = {
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
};

/**
 * Strict decoded operation from one supported self-call. Every signer value is
 * canonical Starknet-key material; malformed or non-Stark variants fail parse.
 */
export type ArgentMultisigConfigChange =
  | {
      readonly kind: "add_signers";
      readonly signerPublicKeys: readonly string[];
      readonly threshold: number;
    }
  | {
      readonly kind: "remove_signers";
      readonly signerPublicKeys: readonly string[];
      readonly threshold: number;
    }
  | { readonly kind: "change_threshold"; readonly threshold: number }
  | {
      readonly addSignerPublicKey: string;
      readonly kind: "replace_signer";
      readonly removeSignerPublicKey: string;
    };

/**
 * Structured authority review. Consumers render exact change fields and treat
 * the deterministic summary as display-only; invalid transitions throw first.
 */
export type ArgentMultisigConfigReview = {
  readonly change: ArgentMultisigConfigChange;
  readonly nextConfig: ArgentMultisigPublicConfig;
  readonly summary: string;
};

/**
 * Builds one canonical stable-0.2 signer-management self-call. The returned
 * call is parsed again through the same strict decoder used at the background
 * boundary, so UI conveniences cannot invent a second ABI interpretation.
 */
export const argentMultisigConfigChangeCall = (
  accountAddress: string,
  change: ArgentMultisigConfigChange,
): ArgentMultisigCall => {
  const signer = (publicKey: string): readonly string[] => ["0x0", canonicalSigner(publicKey)];
  const threshold = (value: number): string => `0x${BigInt(value).toString(16)}`;
  const call: ArgentMultisigCall =
    change.kind === "change_threshold"
      ? {
          calldata: [threshold(change.threshold)],
          contractAddress: accountAddress,
          entrypoint: "change_threshold",
        }
      : change.kind === "replace_signer"
        ? {
            calldata: [
              ...signer(change.removeSignerPublicKey),
              ...signer(change.addSignerPublicKey),
            ],
            contractAddress: accountAddress,
            entrypoint: "replace_signer",
          }
        : {
            calldata: [
              threshold(change.threshold),
              threshold(change.signerPublicKeys.length),
              ...change.signerPublicKeys.flatMap(signer),
            ],
            contractAddress: accountAddress,
            entrypoint: change.kind,
          };
  parseArgentMultisigConfigChange(accountAddress, call);
  return call;
};

const canonicalSigner = (value: string): string => {
  const canonical = canonicalFelt(value);
  if (canonical === null || !isNonZeroStarkFieldElement(canonical)) {
    throw new WalletError("Invalid Argent multisig signer public key");
  }
  return canonical;
};

const signerAt = (calldata: readonly string[], index: number): string => {
  if (calldata[index] !== "0x0") {
    throw new WalletError("Only Starknet signers are supported in Argent multisig management");
  }
  const publicKey = calldata[index + 1];
  if (publicKey === undefined) {
    throw new WalletError("Invalid Argent multisig management calldata");
  }
  return canonicalSigner(publicKey);
};

const thresholdAt = (calldata: readonly string[], index: number): number => {
  const value = calldata[index];
  if (value === undefined) {
    throw new WalletError("Invalid Argent multisig management calldata");
  }
  const threshold = Number(BigInt(value));
  if (
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    threshold > ARGENT_MULTISIG_MAX_SIGNERS
  ) {
    throw new WalletError("Invalid Argent multisig management threshold");
  }
  return threshold;
};

const signerArrayAt = (calldata: readonly string[], index: number): readonly string[] => {
  const countValue = calldata[index];
  if (countValue === undefined) {
    throw new WalletError("Invalid Argent multisig management calldata");
  }
  const count = Number(BigInt(countValue));
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > ARGENT_MULTISIG_MAX_SIGNERS ||
    calldata.length !== index + 1 + count * 2
  ) {
    throw new WalletError("Invalid Argent multisig management signer array");
  }
  return Array.from({ length: count }, (_, signerIndex) =>
    signerAt(calldata, index + 1 + signerIndex * 2),
  );
};

/**
 * Decodes one untrusted self-call against the exact stable-0.2 management ABI.
 * Non-self, unknown, trailing, non-Stark, or malformed inputs throw closed.
 */
export const parseArgentMultisigConfigChange = (
  accountAddress: string,
  call: ArgentMultisigCall,
): ArgentMultisigConfigChange => {
  if (!isArgentMultisigCalls([call]) || !sameFelt(call.contractAddress, accountAddress)) {
    throw new WalletError("Invalid Argent multisig management self-call");
  }
  if (!CONFIG_ENTRYPOINTS.has(call.entrypoint)) {
    throw new WalletError("Unsupported Argent multisig self-call");
  }
  const calldata = call.calldata;
  if (call.entrypoint === "change_threshold") {
    if (calldata.length !== 1) {
      throw new WalletError("Invalid Argent multisig management calldata");
    }
    return { kind: "change_threshold", threshold: thresholdAt(calldata, 0) };
  }
  if (call.entrypoint === "replace_signer") {
    if (calldata.length !== 4) {
      throw new WalletError("Invalid Argent multisig management calldata");
    }
    return {
      addSignerPublicKey: signerAt(calldata, 2),
      kind: "replace_signer",
      removeSignerPublicKey: signerAt(calldata, 0),
    };
  }
  if (call.entrypoint === "add_signers" || call.entrypoint === "remove_signers") {
    return {
      kind: call.entrypoint,
      signerPublicKeys: signerArrayAt(calldata, 1),
      threshold: thresholdAt(calldata, 0),
    };
  }
  throw new WalletError("Unsupported Argent multisig self-call");
};

const addPublicSigners = (
  current: ArgentMultisigPublicConfig,
  change: Extract<ArgentMultisigConfigChange, { readonly kind: "add_signers" }>,
): ArgentMultisigPublicConfig => {
  if (change.signerPublicKeys.some((signer) => current.signerPublicKeys.includes(signer))) {
    throw new WalletError("Argent multisig signer is already configured");
  }
  return normalizeArgentMultisigConfig({
    signerPublicKeys: [...current.signerPublicKeys, ...change.signerPublicKeys],
    threshold: change.threshold,
  });
};

const removePublicSigners = (
  current: ArgentMultisigPublicConfig,
  change: Extract<ArgentMultisigConfigChange, { readonly kind: "remove_signers" }>,
): ArgentMultisigPublicConfig => {
  if (new Set(change.signerPublicKeys).size !== change.signerPublicKeys.length) {
    throw new WalletError("Argent multisig removal signers must be unique");
  }
  if (change.signerPublicKeys.some((signer) => !current.signerPublicKeys.includes(signer))) {
    throw new WalletError("Argent multisig signer is not configured");
  }
  const removed = new Set(change.signerPublicKeys);
  return normalizeArgentMultisigConfig({
    signerPublicKeys: current.signerPublicKeys.filter((signer) => !removed.has(signer)),
    threshold: change.threshold,
  });
};

const replacePublicSigner = (
  current: ArgentMultisigPublicConfig,
  change: Extract<ArgentMultisigConfigChange, { readonly kind: "replace_signer" }>,
): ArgentMultisigPublicConfig => {
  const removeIndex = current.signerPublicKeys.indexOf(change.removeSignerPublicKey);
  if (removeIndex < 0) {
    throw new WalletError("Argent multisig signer is not configured");
  }
  if (current.signerPublicKeys.includes(change.addSignerPublicKey)) {
    throw new WalletError("Argent multisig signer is already configured");
  }
  const signers = [...current.signerPublicKeys];
  signers[removeIndex] = change.addSignerPublicKey;
  return normalizeArgentMultisigConfig({ signerPublicKeys: signers, threshold: current.threshold });
};

/**
 * Applies a decoded change to a trusted current snapshot. Semantic no-ops,
 * missing/existing members, and invalid resulting thresholds throw closed.
 */
export const nextArgentMultisigPublicConfig = (
  current: ArgentMultisigPublicConfig,
  change: ArgentMultisigConfigChange,
): ArgentMultisigPublicConfig => {
  const normalized = normalizeArgentMultisigConfig(current);
  if (change.kind === "change_threshold") {
    if (change.threshold === normalized.threshold) {
      throw new WalletError("Argent multisig threshold is unchanged");
    }
    return normalizeArgentMultisigConfig({
      signerPublicKeys: normalized.signerPublicKeys,
      threshold: change.threshold,
    });
  }
  if (change.kind === "add_signers") {
    return addPublicSigners(normalized, change);
  }
  return change.kind === "remove_signers"
    ? removePublicSigners(normalized, change)
    : replacePublicSigner(normalized, change);
};

const configChangeSummary = (change: ArgentMultisigConfigChange): string => {
  if (change.kind === "change_threshold") {
    return `Change Argent multisig threshold to ${change.threshold}`;
  }
  if (change.kind === "replace_signer") {
    return "Replace one Argent multisig signer";
  }
  const action = change.kind === "add_signers" ? "Add" : "Remove";
  return `${action} ${change.signerPublicKeys.length} Argent multisig signer(s) and set threshold to ${change.threshold}`;
};

/**
 * Produces a complete review from untrusted calldata and trusted current state.
 * Callers render exact change fields and ignore request-provided summary text.
 */
export const reviewArgentMultisigConfigChange = (
  accountAddress: string,
  current: ArgentMultisigPublicConfig,
  call: ArgentMultisigCall,
): ArgentMultisigConfigReview => {
  const change = parseArgentMultisigConfigChange(accountAddress, call);
  return {
    change,
    nextConfig: nextArgentMultisigPublicConfig(current, change),
    summary: configChangeSummary(change),
  };
};
