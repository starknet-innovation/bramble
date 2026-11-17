/**
 * Provider chain/signing dispatch guard branches: handleChainOps rejects
 * malformed sign-typed-data / chain-id / switch-chain messages, a sender whose
 * origin does not match the claimed origin, an unsupported chain id, and a
 * locked wallet; executeSignApproval fails safely when locked, unconnected, or
 * handed invalid typed data.
 */

import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { typedDataHash } from "@bramble/starknet/typed-data";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import {
  createUnlockSession,
  type UnlockSession,
} from "../../../apps/extension/src/background/runtime/session";

import {
  type ChainOpsDeps,
  executeSignApproval,
  handleChainOps,
} from "../../../apps/extension/src/background/transactions/chain-ops";
import { testExtension } from "../../support/background-wallet-stub";

const ORIGIN = "https://dapp.example";
const PASSPHRASE = "correct horse battery staple";

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

// A content sender whose own URL origin equals the claimed dapp origin, so
// isClaimedSenderOrigin passes and the handler proceeds past the sender gate.
const matchingSender: RuntimeSender = { id: "extension-id", url: `${ORIGIN}/app` };
// A sender whose origin does not match the claimed origin.
const mismatchedSender: RuntimeSender = { id: "other", url: "https://evil.example/app" };

const walletStub = (granted: readonly AccountRef[]) =>
  ({
    async getGrantedAccounts(target: string) {
      return target === ORIGIN ? granted : [];
    },
    async signHash() {
      return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
    },
  }) as unknown as ChainOpsDeps["wallet"];

const deps = (session: UnlockSession, granted: readonly AccountRef[] = []): ChainOpsDeps =>
  ({
    activity: memoryActivityLog(),
    // A real queue: the sign handler probes queue admission before it reads the
    // session, so a stub without `canAdmit` would fail on the probe rather than
    // on the branch under test.
    approvals: createApprovalQueue(),
    extension: testExtension,
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    session,
    waiters: {} as ChainOpsDeps["waiters"],
    wallet: walletStub(granted),
  }) as ChainOpsDeps;

const unlocked = (): UnlockSession => {
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  return session;
};

// A well-formed SNIP-12 revision 1 envelope so typedDataHash succeeds where a
// test needs to reach past the shape check. `revision` is load-bearing: without
// it the payload declares no domain struct for either revision, so every test
// below would pass for the wrong reason — rejected at the envelope rather than
// at the guard under test.
const typedData = {
  domain: { chainId: "0x534e5f4d41494e", name: "Test", revision: "1", version: "1" },
  message: { contents: "hi" },
  primaryType: "Mail",
  types: {
    Mail: [{ name: "contents", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
    ],
  },
};

describe("handleChainOps guard branches", () => {
  test("the shared fixture really does hash, so every guard below is the reason", () => {
    // Without this the tests still pass while the envelope is rejected before
    // the guard under test is ever reached — a silently weakened control.
    expect(typedDataHash(typedData, account.address)).toMatch(/^0x[0-9a-f]+$/);
  });

  test("rejects a malformed signTypedData message", async () => {
    const response = await handleChainOps(
      deps(unlocked()),
      "wallet.signTypedData",
      { debug: true, origin: ORIGIN, type: "wallet.signTypedData", typedData },
      matchingSender,
    );
    expect(response).toEqual({ error: "invalid sign typed data request" });
  });

  test("rejects a signTypedData whose sender origin does not match", async () => {
    const response = await handleChainOps(
      deps(unlocked()),
      "wallet.signTypedData",
      { origin: ORIGIN, type: "wallet.signTypedData", typedData },
      mismatchedSender,
    );
    expect(response).toEqual({ error: "sender origin mismatch" });
  });

  test("rejects a signTypedData while the wallet is locked", async () => {
    const response = await handleChainOps(
      deps(createUnlockSession()),
      "wallet.signTypedData",
      { origin: ORIGIN, type: "wallet.signTypedData", typedData },
      matchingSender,
    );
    expect(response).toEqual({ error: "wallet locked" });
  });

  test("rejects typed data for a different network", async () => {
    const response = await handleChainOps(
      deps(unlocked(), [account]),
      "wallet.signTypedData",
      {
        origin: ORIGIN,
        type: "wallet.signTypedData",
        typedData: {
          ...typedData,
          domain: { ...typedData.domain, chainId: "SN_SEPOLIA" },
        },
      },
      matchingSender,
    );
    expect(response).toEqual({ error: "invalid typed data" });
  });

  test("rejects a malformed getChainId message", async () => {
    const response = await handleChainOps(
      deps(unlocked()),
      "wallet.getChainId",
      { debug: true, origin: ORIGIN, type: "wallet.getChainId" },
      matchingSender,
    );
    expect(response).toEqual({ error: "invalid chain id request" });
  });

  test("rejects a malformed switchChain message", async () => {
    const response = await handleChainOps(
      deps(unlocked()),
      "wallet.switchChain",
      { chainId: "not-hex", origin: ORIGIN, type: "wallet.switchChain" },
      matchingSender,
    );
    expect(response).toEqual({ error: "invalid switch chain request" });
  });

  test("rejects a switchChain whose sender origin does not match", async () => {
    const response = await handleChainOps(
      deps(unlocked()),
      "wallet.switchChain",
      { chainId: "0x534e5f4d41494e", origin: ORIGIN, type: "wallet.switchChain" },
      mismatchedSender,
    );
    expect(response).toEqual({ error: "sender origin mismatch" });
  });

  test("rejects a switchChain to a chain the wallet is not configured for", async () => {
    const response = await handleChainOps(
      deps(unlocked(), [account]),
      "wallet.switchChain",
      { chainId: "0xabc123", origin: ORIGIN, type: "wallet.switchChain" },
      matchingSender,
    );
    expect(response).toEqual({ error: "unsupported chain" });
  });
});

describe("executeSignApproval failure branches", () => {
  test("fails when the wallet is locked", async () => {
    const response = await executeSignApproval(deps(createUnlockSession()), {
      origin: ORIGIN,
      typedData,
    });
    expect(response).toEqual({ error: "wallet locked" });
  });

  test("fails when the origin holds no grant on the active network", async () => {
    const response = await executeSignApproval(deps(unlocked(), []), { origin: ORIGIN, typedData });
    expect(response).toEqual({ error: "origin not connected" });
  });

  test("fails when the typed data cannot be hashed", async () => {
    const response = await executeSignApproval(deps(unlocked(), [account]), {
      origin: ORIGIN,
      typedData: { not: "a valid envelope" },
    });
    expect(response).toEqual({ error: "invalid typed data" });
  });
});
