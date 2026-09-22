/**
 * This wallet imports Braavos accounts but never deploys one. Braavos deploys
 * with the public key as salt and sole constructor argument — the same inputs
 * as OpenZeppelin's imported-key rule — so reaching that rule would pass the
 * address check and deploy an account this wallet cannot sign for.
 */
import { expect, test } from "bun:test";
import { familyAccountAddress } from "@bramble/starknet/account-contracts";
import { isCompatibleAccountDeployed } from "@bramble/starknet/deployment";
import { accountDeployment } from "@bramble/starknet/rpc";
import { accountClassEntry, BRAAVOS_BASE_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { CallData, hash, type RpcProvider } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

test("never deploys a Braavos account, even at an address the OZ rule reproduces", () => {
  const base = accountClassEntry(BRAAVOS_BASE_CLASS_HASH);
  if (!base) throw new Error("Braavos base class missing from the class table");
  const address = familyAccountAddress(base, PUBLIC_KEY);
  const braavos: DerivedAccountRef = {
    accountContractType: "braavos",
    address,
    classHash: BRAAVOS_BASE_CLASS_HASH,
    deploymentSalt: PUBLIC_KEY,
    derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: PUBLIC_KEY,
    publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  };

  // The hazard is real: OZ's imported-key inputs reproduce this address.
  expect(
    hash.calculateContractAddressFromHash(
      PUBLIC_KEY,
      BRAAVOS_BASE_CLASS_HASH,
      CallData.compile([PUBLIC_KEY]),
      0,
    ),
  ).toBe(address);
  expect(() => accountDeployment(braavos)).toThrow("does not deploy Braavos accounts");
});

test("refuses a Braavos account before asking whether it is deployed", async () => {
  let lookups = 0;
  const provider = {
    getClassHashAt: async () => {
      lookups += 1;
      return BRAAVOS_BASE_CLASS_HASH;
    },
  } as unknown as RpcProvider;
  const base = accountClassEntry(BRAAVOS_BASE_CLASS_HASH);
  if (!base) throw new Error("Braavos base class missing from the class table");
  const address = familyAccountAddress(base, PUBLIC_KEY);
  const braavos: DerivedAccountRef = {
    accountContractType: "braavos",
    address,
    classHash: BRAAVOS_BASE_CLASS_HASH,
    deploymentSalt: PUBLIC_KEY,
    derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: PUBLIC_KEY,
    publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  };

  await expect(isCompatibleAccountDeployed(provider, braavos)).rejects.toThrow(
    "cannot yet authorize transactions",
  );
  expect(lookups).toBe(0);
});
