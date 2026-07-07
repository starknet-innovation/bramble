/**
 * SNIP-12 typed-data checks: envelope validation, hashing, provider bridge
 * mapping, and the origin-gated background signing path.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import type { RuntimeSender } from "../src/background/senders";
import { createUnlockSession } from "../src/background/session";
import {
  readProviderRequestArguments,
  toProviderPayload,
  toRuntimeMessage,
} from "../src/provider/bridge";
import { isTypedDataShape, typedDataHash } from "../src/starknet/typed-data";
import type { AccountRef, Vault } from "../src/storage/vault-schema";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const typedData = {
  domain: { chainId: "SN_MAIN", name: "MC Test", version: "1" },
  message: { content: "hello" },
  primaryType: "Message",
  types: {
    Message: [{ name: "content", type: "felt" }],
    StarkNetDomain: [
      { name: "name", type: "felt" },
      { name: "chainId", type: "felt" },
      { name: "version", type: "felt" },
    ],
  },
};

describe("typed data hashing", () => {
  test("validates the SNIP-12 envelope", () => {
    expect(isTypedDataShape(typedData)).toBe(true);
    expect(isTypedDataShape({ ...typedData, extra: 1 })).toBe(false);
    expect(isTypedDataShape({ primaryType: "Message" })).toBe(false);
    expect(isTypedDataShape("hello")).toBe(false);
  });

  test("hashes valid typed data deterministically", () => {
    const first = typedDataHash(typedData, account.address);
    const second = typedDataHash(typedData, account.address);
    expect(first).toMatch(/^0x[0-9a-f]+$/);
    expect(first).toBe(second);
  });

  test("rejects unhashable typed data", () => {
    expect(() => typedDataHash({ ...typedData, types: {} }, account.address)).toThrow();
    expect(() => typedDataHash(null, account.address)).toThrow("Invalid typed data");
  });
});

describe("provider bridge typed data", () => {
  test("accepts wallet_signTypedData requests with params", () => {
    const args = readProviderRequestArguments({
      method: "wallet_signTypedData",
      params: typedData,
    });
    expect(args?.method).toBe("wallet_signTypedData");

    const runtimeMessage = toRuntimeMessage(
      {
        id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
        method: "wallet_signTypedData",
        params: typedData,
      },
      "https://dapp.example",
    );
    expect(runtimeMessage).toMatchObject({
      origin: "https://dapp.example",
      type: "wallet.signTypedData",
    });
  });

  test("maps signature responses to a [r, s] felt array", () => {
    expect(
      toProviderPayload(
        { ok: true, signature: { publicKey: "0x3", r: "0x1a", s: "0x2b" } },
        "wallet_signTypedData",
      ),
    ).toEqual({ result: ["0x1a", "0x2b"] });
    expect(toProviderPayload({ ok: true, signature: {} }, "wallet_signTypedData")).toEqual({
      error: "invalid provider response",
    });
  });
});

describe("wallet.signTypedData handler", () => {
  const contentSender: RuntimeSender = { id: "extension-id", url: "https://dapp.example/swap" };
  const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
  const signedHashes: string[] = [];

  const handler = (() => {
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");
    return createMessageHandler(
      {
        async createAccount() {
          return account;
        },
        async ensureNetworkAccount() {
          return account;
        },
        async getGrantedAccounts(origin: string) {
          return origin === "https://dapp.example" ? [account] : [];
        },
        async generateMnemonic() {
          return "habit hope tip crystal because grunt nation idea electric witness alert like";
        },
        async grantOrigin() {
          return [account];
        },
        async readVault() {
          return vault;
        },
        async setActiveAccount() {
          return account;
        },
        async signHash(input: { messageHash: string }) {
          signedHashes.push(input.messageHash);
          return { publicKey: account.publicKeyX, r: "0x1a", s: "0x2b" };
        },
        async status() {
          return {
            accountCount: 1,
            activeAccountId: account.id,
            hasVault: true,
            locked: false,
            ready: true,
          };
        },
      },
      "extension-id",
      session,
    );
  })();

  test("signs the SNIP-12 hash for a connected origin", async () => {
    const response = await handler(
      { origin: "https://dapp.example", type: "wallet.signTypedData", typedData },
      contentSender,
    );
    expect(response).toEqual({
      ok: true,
      signature: { publicKey: account.publicKeyX, r: "0x1a", s: "0x2b" },
    });
    expect(signedHashes[0]).toBe(typedDataHash(typedData, account.address));
  });

  test("rejects unconnected origins and malformed data", async () => {
    const strangerSender: RuntimeSender = { id: "extension-id", url: "https://other.example/" };
    expect(
      await handler(
        { origin: "https://other.example", type: "wallet.signTypedData", typedData },
        strangerSender,
      ),
    ).toEqual({ error: "origin not connected" });
    expect(
      await handler(
        { origin: "https://dapp.example", type: "wallet.signTypedData", typedData: { nope: 1 } },
        contentSender,
      ),
    ).toEqual({ error: "invalid typed data" });
  });
});
