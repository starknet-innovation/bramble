/**
 * No import path blocks on the privacy pool. The paths that write an account
 * never read it; the two that list candidates (seed discovery, find by
 * address) read it only to note a deployed account another wallet registered,
 * and still answer when the pool cannot be read. A flaky node cannot stop
 * bringing an account in; the registration check happens when a private action
 * is attempted.
 */
import { describe, expect, test } from "bun:test";
import type { WalletStatusReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PRIVATE_KEY = "0xfeedface";

const countingRpc = () => {
  const reads = { value: 0 };
  return {
    reads,
    runtimeRpc: makeRuntimeRpc({
      async getStrk20PublicKey() {
        reads.value += 1;
        throw new Error("node down");
      },
    }),
  };
};

const handlerFor = (runtimeRpc: ReturnType<typeof makeRuntimeRpc>, unlocked: boolean) => {
  const session = createUnlockSession();
  if (unlocked) session.unlock(vaultPassphrase);
  const wallet = {
    ...createWallet(),
    async addLedgerAccount() {
      return account;
    },
    async createLedgerVault() {
      return account;
    },
    async previewStrk20ViewingPublicKey() {
      return "0x1";
    },
  };
  return createMessageHandler(wallet as unknown as WalletStatusReader, testExtension, {
    runtimeRpc,
    session,
  });
};

describe("import paths and the privacy pool", () => {
  test("paths that write an account never read the pool", async () => {
    const { reads, runtimeRpc } = countingRpc();
    const locked = handlerFor(runtimeRpc, false);
    const unlocked = handlerFor(runtimeRpc, true);
    const cases: readonly { readonly message: unknown; readonly unlocked?: boolean }[] = [
      {
        message: {
          mnemonic: MNEMONIC,
          networkId: "SN_MAIN",
          selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
          type: "wallet.importSeedAccounts",
        },
        unlocked: true,
      },
      {
        message: {
          accountContractType: "openzeppelin",
          networkId: "SN_MAIN",
          privateKey: PRIVATE_KEY,
          type: "wallet.createKeyVault",
          vaultPassphrase,
        },
      },
      {
        message: {
          accountContractType: "openzeppelin",
          networkId: "SN_MAIN",
          privateKey: PRIVATE_KEY,
          type: "wallet.importAccount",
          vaultPassphrase,
        },
        unlocked: true,
      },
      {
        message: {
          accountContractType: "openzeppelin",
          accountIndex: 0,
          networkId: "SN_MAIN",
          publicKeyX: "0xabc",
          type: "wallet.addLedgerAccount",
        },
        unlocked: true,
      },
      {
        message: {
          accountContractType: "openzeppelin",
          accountIndex: 0,
          networkId: "SN_MAIN",
          publicKeyX: "0xabc",
          type: "wallet.createLedgerVault",
          vaultPassphrase,
        },
      },
      {
        message: {
          networkId: "SN_MAIN",
          privateKey: PRIVATE_KEY,
          type: "wallet.discoverReadyKeyAccounts",
        },
      },
      {
        message: {
          accountContractType: "argent",
          classHashes: ["0x1"],
          networkId: "SN_MAIN",
          privateKey: PRIVATE_KEY,
          type: "wallet.importAccount",
          vaultPassphrase,
        },
        unlocked: true,
      },
      {
        message: {
          address: account.address,
          networkId: "SN_MAIN",
          privateKey: PRIVATE_KEY,
          type: "wallet.findKeyAccountByAddress",
        },
        unlocked: true,
      },
    ];
    for (const entry of cases) {
      const response = await (entry.unlocked ? unlocked : locked)(entry.message, extensionSender);
      expect(response).not.toEqual({ error: "privileged sender required" });
    }
    expect(reads.value).toBe(0);
  });

  test("candidate listings still answer when the pool cannot be read", async () => {
    const { reads, runtimeRpc } = countingRpc();
    const locked = handlerFor(runtimeRpc, false);
    const unlocked = handlerFor(runtimeRpc, true);
    const discovery = await locked(
      {
        manualIndex: 0,
        mnemonic: MNEMONIC,
        networkId: "SN_MAIN",
        type: "wallet.discoverRecoveryAccounts",
      },
      extensionSender,
    );
    expect(discovery).toMatchObject({ ok: true });
    const byAddress = await locked(
      {
        address: account.address,
        mnemonic: MNEMONIC,
        networkId: "SN_MAIN",
        type: "wallet.findRecoveryAccountByAddress",
      },
      extensionSender,
    );
    expect(byAddress).not.toEqual({ error: "privileged sender required" });
    const own = await unlocked(
      { address: account.address, networkId: "SN_MAIN", type: "wallet.findOwnAccountByAddress" },
      extensionSender,
    );
    expect(own).not.toEqual({ error: "privileged sender required" });
    // The stub's candidate is deployed, so discovery tried the pool and carried on.
    expect(reads.value).toBeGreaterThan(0);
    const candidates = (discovery as { readonly candidates: readonly { privacyPool?: string }[] })
      .candidates;
    expect(candidates.every((candidate) => candidate.privacyPool === undefined)).toBe(true);
  });
});
