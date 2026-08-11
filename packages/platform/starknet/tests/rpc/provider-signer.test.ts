/**
 * KrustyStarknetSigner adapter behind krustyAccount: the public key is surfaced
 * unchanged, a raw hash is normalized to 0x form before signing, a decimal hash
 * is converted to hex, and a hash outside the Stark field is rejected before the
 * vault signer is ever consulted.
 */
import { describe, expect, test } from "bun:test";
import { krustyAccount } from "@mc-wallet/starknet/provider";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import { RpcProvider, type Signature } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const account: AccountRef = {
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
});
