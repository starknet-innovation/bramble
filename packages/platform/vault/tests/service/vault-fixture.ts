/**
 * Vaults of realistic size for the capacity suites: derived accounts shaped as
 * the service stores them, and the largest count the vault validators accept.
 */
import { isJson } from "@bramble/core/json";
import { emptyVault, type Vault } from "@bramble/vault/schema";

// Full-width felts, as real addresses and keys are; 63 hex digits keep them
// canonical and below both the field prime and the curve order.
export const felt = (index: number, salt: bigint): string =>
  `0x7${((BigInt(index) + 1n) * 0x9e3779b97f4a7c15n * salt).toString(16).padStart(62, "0").slice(-62)}`;

// Derived accounts shaped as the service stores them, each with its signing key.
export const vaultWith = (count: number): Vault => {
  const accounts = Array.from({ length: count }, (_, index) => ({
    accountContractType: "openzeppelin" as const,
    address: felt(index, 3n),
    classHash: "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f",
    derivation: { accountIndex: index, addressIndex: 0, kind: "starknet-bip44" as const },
    id: `SN_MAIN:${felt(index, 3n)}`,
    networkId: "SN_MAIN" as const,
    publicKeyX: felt(index, 5n),
    publicKeyY: felt(index, 7n),
  }));
  return {
    ...emptyVault(),
    accounts,
    activeAccountId: accounts[0]?.id ?? null,
    mnemonic: "habit hope tip crystal because grunt nation idea electric witness alert like",
    signingKeys: accounts.map((account, index) => ({
      accountId: account.id,
      privateKey: felt(index, 11n),
    })),
  };
};

// The largest account count the vault validators accept.
export const capacity = (): number => {
  let low = 1;
  let high = 2_000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (isJson(vaultWith(middle))) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};
