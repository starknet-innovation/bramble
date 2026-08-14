/**
 * KrustyStarknetSigner adapter behind krustyAccount: the public key is surfaced
 * unchanged, a raw hash is normalized to 0x form before signing, a decimal hash
 * is converted to hex, and a hash outside the Stark field is rejected before the
 * vault signer is ever consulted.
 */
import { describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
} from "@mc-wallet/starknet/account-contracts";
import { argentQueryAccount, krustyAccount } from "@mc-wallet/starknet/provider";
import type { DerivedAccountRef } from "@mc-wallet/wallet-model/accounts";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import { EDataAvailabilityMode, ETransactionVersion3, RpcProvider, type Signature } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const account: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const provider = new RpcProvider({ nodeUrl: "https://rpc.invalid" });

// Records the hash the account asked the vault to sign so hash normalization is
// observable, and returns a fixed signature.
const recordingSignHash = () => {
  const signed: string[] = [];
  const signHash = async (messageHash: string): Promise<StarkSignature> => {
    signed.push(messageHash);
    return { publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" };
  };
  return { signHash, signed };
};

// signRaw is protected on the starknet.js Signer base; the wallet only ever
// reaches it through the account's signing flows, so the test calls it directly
// with the exact final message hash to exercise the normalization branch.
type RawSigner = { signRaw(messageHash: string): Promise<Signature> };

describe("krustyAccount signer", () => {
  test("exposes the account public key through getPubKey", async () => {
    const { signHash } = recordingSignHash();
    const starknetAccount = krustyAccount(provider, account, signHash);
    await expect(starknetAccount.signer.getPubKey()).resolves.toBe(PUBLIC_KEY);
  });

  test("signs an already-0x hash and returns [r, s]", async () => {
    const { signHash, signed } = recordingSignHash();
    const signer = krustyAccount(provider, account, signHash).signer as unknown as RawSigner;

    const signature = await signer.signRaw("0xabc");

    expect(signed).toEqual(["0xabc"]);
    expect(signature).toEqual(["0x1", "0x2"]);
  });

  test("normalizes a decimal hash to 0x form before signing", async () => {
    const { signHash, signed } = recordingSignHash();
    const signer = krustyAccount(provider, account, signHash).signer as unknown as RawSigner;

    await signer.signRaw("255");

    expect(signed).toEqual(["0xff"]);
  });

  test("rejects a hash outside the Stark field without calling the vault signer", async () => {
    const { signHash, signed } = recordingSignHash();
    const signer = krustyAccount(provider, account, signHash).signer as unknown as RawSigner;
    const overPrime = "0x800000000000011000000000000000000000000000000000000000000000002";

    await expect(signer.signRaw(overPrime)).rejects.toThrow("Invalid transaction hash");
    expect(signed).toEqual([]);
  });

  test("emits the standard Argent Account signature shape", async () => {
    const argentAccount = {
      ...account,
      accountContractType: "argent",
      classHash: ARGENT_ACCOUNT_CONTRACT.classHash,
      deploymentSalt: PUBLIC_KEY,
    } as const;
    const { signHash } = recordingSignHash();
    const signer = krustyAccount(provider, argentAccount, signHash).signer as unknown as RawSigner;

    await expect(signer.signRaw("0xabc")).resolves.toEqual(["1", "0", PUBLIC_KEY, "0x1", "0x2"]);
  });

  test("rejects an ordinary Argent discriminator with another class", () => {
    expect(() =>
      krustyAccount(
        provider,
        {
          ...account,
          accountContractType: "argent",
          deploymentSalt: PUBLIC_KEY,
        },
        recordingSignHash().signHash,
      ),
    ).toThrow("class hash does not match");
  });

  test("emits exact GUID-sorted Argent multisig aggregates", async () => {
    const multisig = {
      accountContractType: "argent-multisig" as const,
      address: account.address,
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      networkId: account.networkId,
    };
    const config = { signerPublicKeys: ["0x456", "0x123"], threshold: 2 } as const;
    const signer = krustyAccount(
      provider,
      multisig,
      async () => [
        { publicKey: "0x456", r: "0x3", s: "0x4" },
        { publicKey: "0x123", r: "0x1", s: "0x2" },
      ],
      { multisig: config },
    ).signer as unknown as RawSigner;

    await expect(signer.signRaw("0xabc")).resolves.toEqual([
      "2",
      "0",
      "0x123",
      "0x1",
      "0x2",
      "0",
      "0x456",
      "0x3",
      "0x4",
    ]);
  });

  test("rejects an Argent multisig discriminator with another class", () => {
    expect(() =>
      krustyAccount(
        provider,
        {
          accountContractType: "argent-multisig",
          address: account.address,
          classHash: account.classHash,
          networkId: account.networkId,
        },
        async () => ({ publicKey: "0x123", r: "0x1", s: "0x2" }),
        { multisig: { signerPublicKeys: ["0x123"], threshold: 1 } },
      ),
    ).toThrow("class hash does not match");
  });

  test("builds threshold-shaped query signatures without calling Krusty", async () => {
    const multisig = {
      accountContractType: "argent-multisig" as const,
      address: account.address,
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      networkId: account.networkId,
    };
    const signer = argentQueryAccount(provider, multisig, {
      multisig: { signerPublicKeys: ["0x456", "0x123"], threshold: 2 },
    }).signer as unknown as RawSigner;

    await expect(signer.signRaw("0xabc")).resolves.toEqual([
      "2",
      "0",
      "0x123",
      "0x1",
      "0x1",
      "0",
      "0x456",
      "0x1",
      "0x1",
    ]);
  });

  test("builds a standard ordinary Argent query signature without Krusty", async () => {
    const signer = argentQueryAccount(provider, {
      ...account,
      accountContractType: "argent",
      classHash: ARGENT_ACCOUNT_CONTRACT.classHash,
      deploymentSalt: PUBLIC_KEY,
    }).signer as unknown as RawSigner;

    await expect(signer.signRaw("0xabc")).resolves.toEqual(["1", "0", PUBLIC_KEY, "0x1", "0x1"]);
  });

  test("uses exactly one configured member signature for multisig deployment", async () => {
    const multisig = {
      accountContractType: "argent-multisig" as const,
      address: account.address,
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      networkId: account.networkId,
    };
    const starknetAccount = krustyAccount(
      provider,
      multisig,
      async () => ({ publicKey: "0x456", r: "0x3", s: "0x4" }),
      { multisig: { signerPublicKeys: ["0x456", "0x123"], threshold: 2 } },
    );

    await expect(
      starknetAccount.signer.signDeployAccountTransaction({
        accountDeploymentData: [],
        addressSalt: "0x0",
        chainId: "0x534e5f4d41494e",
        classHash: account.classHash,
        constructorCalldata: [],
        contractAddress: account.address,
        feeDataAvailabilityMode: EDataAvailabilityMode.L1,
        nonce: "0x0",
        nonceDataAvailabilityMode: EDataAvailabilityMode.L1,
        paymasterData: [],
        resourceBounds: {
          l1_data_gas: { max_amount: 1n, max_price_per_unit: 1n },
          l1_gas: { max_amount: 1n, max_price_per_unit: 1n },
          l2_gas: { max_amount: 1n, max_price_per_unit: 1n },
        },
        tip: "0x0",
        version: ETransactionVersion3.V3,
      }),
    ).resolves.toEqual(["1", "0", "0x456", "0x3", "0x4"]);
  });
});
