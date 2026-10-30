/** Deterministic public account refs for recovery-discovery tests. */
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  type DerivedAccountRef,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import {
  defaultRuntimeRpc,
  type RuntimeRpc,
} from "../../apps/extension/src/background/runtime/runtime-rpc";

/**
 * Stands in for the vault's `previewAccount`: one distinct address per index
 * and family (odd for OpenZeppelin, even for Argent), never real key material.
 */
export const recoveryAccountFor = (input: AccountDerivationInput): DerivedAccountRef => {
  const accountIndex = input.accountIndex ?? 0;
  const ordinal = accountIndex * 2 + (input.accountContractType === "argent" ? 2 : 1);
  const address = `0x${ordinal.toString(16)}`;
  const account = {
    address,
    classHash:
      canonicalFelt(
        input.accountContractType === "argent"
          ? ARGENT_ACCOUNT_CLASS_HASH
          : OPENZEPPELIN_ACCOUNT_CLASS_HASH,
      ) ?? "",
    derivation: { accountIndex, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: `0x${(ordinal + 100).toString(16)}`,
    publicKeyY: `0x${(ordinal + 200).toString(16)}`,
  } as const;
  return input.accountContractType === "argent"
    ? { ...account, accountContractType: "argent", deploymentSalt: "0x0" }
    : { ...account, accountContractType: "openzeppelin" };
};

/**
 * Production RPC wiring with the privacy-pool read answered offline as "not
 * registered", so a discovery test never reaches a live pool.
 */
export const offlineDiscoveryRpc: RuntimeRpc = {
  ...defaultRuntimeRpc,
  getStrk20PublicKey: async () => "0x0",
};
