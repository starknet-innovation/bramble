/**
 * Import never reads the privacy pool. A flaky node cannot block bringing an
 * account in; the registration check happens when a private action is attempted.
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
        return "0x99";
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
  };
  return createMessageHandler(wallet as unknown as WalletStatusReader, testExtension, {
    runtimeRpc,
    session,
  });
};

describe("import paths do not read the privacy pool", () => {
  test("seed, raw key, key vault, Ledger, Ready key, and address import", async () => {
    const { reads, runtimeRpc } = countingRpc();
    const locked = handlerFor(runtimeRpc, false);
    const unlocked = handlerFor(runtimeRpc, true);
    const cases: readonly { readonly message: unknown; readonly unlocked?: boolean }[] = [
      {
        message: {
          manualIndex: 0,
          mnemonic: MNEMONIC,
          networkId: "SN_MAIN",
          type: "wallet.discoverRecoveryAccounts",
        },
      },
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
          mnemonic: MNEMONIC,
          networkId: "SN_MAIN",
          type: "wallet.findRecoveryAccountByAddress",
        },
      },
      {
        message: {
          address: account.address,
          networkId: "SN_MAIN",
          type: "wallet.findOwnAccountByAddress",
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
      const before = reads.value;
      const response = await (entry.unlocked ? unlocked : locked)(entry.message, extensionSender);
      expect(response).not.toEqual({ error: "privileged sender required" });
      expect(reads.value).toBe(before);
    }
    expect(reads.value).toBe(0);
  });
});
