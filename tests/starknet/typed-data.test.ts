/**
 * SNIP-12 typed-data checks: envelope validation, hashing, provider bridge
 * mapping, and the origin-gated background signing path.
 */
import { describe, expect, test } from "bun:test";
import { isTypedDataShape, typedDataHash } from "@bramble/starknet/typed-data";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  readProviderRequestArguments,
  toProviderPayload,
  toRuntimeMessage,
} from "@bramble/wallet-protocol/bridge";
import { unknownError } from "@bramble/wallet-protocol/rpc-errors";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { flushHeld, waitForPendingApprovals } from "../support/held";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

// Revision 1, the modern SNIP-12 shape. Revision 0 is signable too — the
// MCW-V09-101 forgery is closed by the name grammar rather than by a revision
// ban — and is exercised in `typed-data-revisions.test.ts`.
const typedData = {
  domain: { chainId: "SN_MAIN", name: "Bramble Test", revision: "1", version: "1" },
  message: { content: "hello" },
  primaryType: "Message",
  types: {
    Message: [{ name: "content", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "revision", type: "shortstring" },
    ],
  },
};

describe("typed data hashing", () => {
  test("validates the SNIP-12 envelope", () => {
    expect(isTypedDataShape(typedData)).toBe(true);
    expect(isTypedDataShape({ ...typedData, extra: 1 })).toBe(false);
    expect(isTypedDataShape({ primaryType: "Message" })).toBe(false);
    expect(isTypedDataShape("hello")).toBe(false);
    expect(
      isTypedDataShape({
        ...typedData,
        message: { body: "x".repeat(64 * 1024 + 1) },
      }),
    ).toBe(false);
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

  test("maps strict OZ and Argent account signature arrays", () => {
    expect(
      toProviderPayload({ ok: true, signature: ["0x1a", "0x2b"] }, "wallet_signTypedData"),
    ).toEqual({ result: ["0x1a", "0x2b"] });
    expect(
      toProviderPayload(
        { ok: true, signature: ["1", "0", "0x3", "0x1a", "0x2b"] },
        "wallet_signTypedData",
      ),
    ).toEqual({ result: ["1", "0", "0x3", "0x1a", "0x2b"] });
    expect(
      toProviderPayload({ ok: true, signature: ["0", "0x1"] }, "wallet_signTypedData"),
    ).toEqual({
      error: unknownError(),
    });
    expect(
      toProviderPayload(
        { ok: true, signature: ["1", "0", "0x3", "0", "0x2b"] },
        "wallet_signTypedData",
      ),
    ).toEqual({ error: unknownError() });
    expect(
      toProviderPayload({ ok: true, signature: ["0x01a", "0x2b"] }, "wallet_signTypedData"),
    ).toEqual({ error: unknownError() });
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
        async addDerivedAccount() {
          return account;
        },
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
      { session },
    );
  })();

  test("holds the request, queues an approval, and signs only on approval", async () => {
    const pageSender: RuntimeSender = {
      id: "extension-id",
      url: "chrome-extension://extension-id/sidepanel.html",
    };
    let settled = false;
    const held = handler(
      { origin: "https://dapp.example", type: "wallet.signTypedData", typedData },
      contentSender,
    ).then((response) => {
      settled = true;
      return response;
    });
    // Never auto-signs: the request stays pending and nothing is signed yet.
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(signedHashes).toHaveLength(0);
    await flushHeld();

    const queued = await waitForPendingApprovals<{ id: string; kind: string }>(handler, pageSender);
    expect(queued[0]?.kind).toBe("sign-typed-data");

    await handler({ id: queued[0]?.id, type: "wallet.approveOrigin" }, pageSender);
    expect(await held).toEqual({
      ok: true,
      signature: ["0x1a", "0x2b"],
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
