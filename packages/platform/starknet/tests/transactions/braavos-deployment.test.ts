/**
 * This wallet imports Braavos accounts but never deploys one. Braavos deploys
 * with the public key as salt and sole constructor argument — the same inputs
 * as OpenZeppelin's imported-key rule — so reaching that rule would pass the
 * address check and deploy an account this wallet cannot sign for.
 */
import { expect, test } from "bun:test";
import { familyAccountAddress } from "@bramble/starknet/account-contracts";
import { isCompatibleAccountDeployed } from "@bramble/starknet/deployment";
import { krustyAccount } from "@bramble/starknet/provider";
import { accountDeployment } from "@bramble/starknet/rpc";
import {
  accountClassEntry,
  BRAAVOS_BASE_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
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

test("checks a deployed Braavos account's live signers instead of refusing by family", async () => {
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
  const providerFor = (signers: readonly string[]) =>
    ({
      getBlock: async () => ({ block_hash: "0xb", timestamp: 1 }),
      getBlockLatestAccepted: async () => ({ block_hash: "0xb", block_number: 1 }),
      // A deployed Braavos account runs an implementation, never its base.
      getClassHashAt: async () => BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
      callContract: async ({ entrypoint }: { readonly entrypoint: string }) => {
        if (entrypoint === "get_signers") return [...signers];
        if (entrypoint === "get_deferred_remove_signers") return ["0x0"];
        throw new Error(`unexpected read: ${entrypoint}`);
      },
    }) as unknown as RpcProvider;

  // Stark key as the only signer: compatible, signable.
  await expect(
    isCompatibleAccountDeployed(providerFor(["0x1", PUBLIC_KEY, "0x0", "0x0"]), braavos),
  ).resolves.toBe(true);
  // An active strong signer refuses before anything could be signed.
  await expect(
    isCompatibleAccountDeployed(providerFor(["0x1", PUBLIC_KEY, "0x1", "0xaa", "0x0"]), braavos),
  ).rejects.toThrow("active 2FA signer");
  // A stark list without the wallet's key refuses as a foreign account.
  await expect(
    isCompatibleAccountDeployed(providerFor(["0x1", "0xdead", "0x0", "0x0"]), braavos),
  ).rejects.toThrow("owner does not match");
});

test("deploys the modern Braavos class with the extended deploy signature", async () => {
  const modern = accountClassEntry(BRAAVOS_DEPLOYMENT_CLASS_HASH);
  if (!modern) throw new Error("Braavos deployment class missing from the class table");
  const address = familyAccountAddress(modern, PUBLIC_KEY);
  const braavos: DerivedAccountRef = {
    accountContractType: "braavos",
    address,
    classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
    deploymentSalt: PUBLIC_KEY,
    derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: PUBLIC_KEY,
    publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  };

  // The deploy payload reproduces the vendor's own inputs.
  const deployment = accountDeployment(braavos);
  expect(deployment.addressSalt).toBe(PUBLIC_KEY);
  expect([...deployment.constructorCalldata]).toEqual(CallData.compile([PUBLIC_KEY]));

  // The deploy signature carries the implementation out-of-band and a second
  // stark pair over poseidon(params), both from the account's own key.
  const signedHashes: string[] = [];
  const account = krustyAccount({} as unknown as RpcProvider, braavos, async (messageHash) => {
    signedHashes.push(messageHash);
    return {
      publicKey: PUBLIC_KEY,
      r: `0x${signedHashes.length}1`,
      s: `0x${signedHashes.length}2`,
    };
  });
  const signature = await account.signer.signDeployAccountTransaction({
    addressSalt: PUBLIC_KEY,
    chainId: "0x534e5f4d41494e",
    classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
    compiledCalldata: CallData.compile([PUBLIC_KEY]),
    constructorCalldata: [PUBLIC_KEY],
    contractAddress: address,
    nonce: 0,
    version: "0x3",
    resourceBounds: {
      l1_data_gas: { max_amount: 0n, max_price_per_unit: 0n },
      l1_gas: { max_amount: 0n, max_price_per_unit: 0n },
      l2_gas: { max_amount: 0n, max_price_per_unit: 0n },
    },
    tip: 0,
    paymasterData: [],
    accountDeploymentData: [],
    nonceDataAvailabilityMode: "L1",
    feeDataAvailabilityMode: "L1",
  } as never);

  const params = [
    BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
    "0x0",
    "0x0",
    "0x0",
    "0x0",
    "0x0",
    "0x0",
    "0x0",
    "0x0",
    "0x0",
    "0x534e5f4d41494e",
  ];
  expect([...(signature as string[])]).toEqual(["0x21", "0x22", ...params, "0x11", "0x12"]);
  // The parameters sign first and the deploy hash signs last: the submission
  // safety check treats the key's last signed hash as the one broadcastable
  // transaction, and only the deploy hash is broadcastable.
  expect(signedHashes).toHaveLength(2);
  expect(signedHashes[0]).toBe(hash.computePoseidonHashOnElements(params));
});
