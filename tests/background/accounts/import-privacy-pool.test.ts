/**
 * Single-account imports (raw key, first-run key vault, Ledger) are refused
 * before any write when another wallet registered the address with the privacy
 * pool, or when the pool cannot be read.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  extensionSender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const OWN_VIEWING_PUBLIC_KEY = "0xa11ce";
const ELSEWHERE = { error: "account registered for privacy in another wallet" };
const UNCHECKED = { error: "privacy registration unavailable" };

const ledgerAccount: LedgerAccountRef = {
  accountContractType: "argent",
  address: "0x1ed",
  classHash: "0x111111",
  deploymentSalt: "0x0",
  derivation: {
    accountIndex: 0,
    eip2645application: "argentx",
    kind: "ledger",
    path: ledgerAccountPath(0, "argentx"),
  },
  id: "SN_MAIN:0x1ed",
  networkId: "SN_MAIN",
  publicKeyX: "0x1234",
};

const harness = (registered: RuntimeRpc["getStrk20PublicKey"]) => {
  const stored: string[] = [];
  const poolReads: string[] = [];
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const wallet = {
    ...createWallet({ captureCreateKeyVault: () => stored.push("createKeyVault") }),
    async addLedgerAccount() {
      stored.push("addLedgerAccount");
      return ledgerAccount;
    },
    async deriveLedgerAccounts() {
      return [ledgerAccount];
    },
    async importRawKeyAccount() {
      stored.push("importAccount");
      return account;
    },
    async previewImportedStrk20ViewingPublicKey() {
      return { address: account.address, viewingPublicKey: OWN_VIEWING_PUBLIC_KEY };
    },
  };
  const handler = createMessageHandler(wallet, testExtension, {
    runtimeRpc: makeRuntimeRpc({
      ...(registered
        ? {
            getStrk20PublicKey: (input) => {
              poolReads.push(input.address);
              return registered(input);
            },
          }
        : {}),
    }),
    session,
  });
  return { handler, poolReads, stored };
};

const rawKey = (type: "wallet.importAccount" | "wallet.createKeyVault") => ({
  accountContractType: "openzeppelin",
  networkId: "SN_MAIN",
  // Clearly-fake test vector; not a real key.
  privateKey: "0xfeedface",
  type,
  ...(type === "wallet.createKeyVault" ? { vaultPassphrase } : {}),
});

const addLedger = {
  accountContractType: "argent",
  accountIndex: 0,
  eip2645application: "argentx",
  networkId: "SN_MAIN",
  publicKeyX: "0x1234",
  type: "wallet.addLedgerAccount",
};

describe("raw-key import privacy-pool check", () => {
  for (const type of ["wallet.importAccount", "wallet.createKeyVault"] as const) {
    test(`${type} refuses a key registered elsewhere before storing`, async () => {
      const { handler, poolReads, stored } = harness(async () => "0xbeef");
      await expect(handler(rawKey(type), extensionSender)).resolves.toEqual(ELSEWHERE);
      expect(poolReads).toEqual([account.address]);
      expect(stored).toEqual([]);
    });

    test(`${type} refuses when the pool cannot be read`, async () => {
      const { handler, stored } = harness(async () => {
        throw new Error("node unreachable");
      });
      await expect(handler(rawKey(type), extensionSender)).resolves.toEqual(UNCHECKED);
      expect(stored).toEqual([]);
    });

    test(`${type} imports an account registered under this wallet's own key`, async () => {
      const { handler, stored } = harness(async () => "0x0A11CE");
      await expect(handler(rawKey(type), extensionSender)).resolves.toMatchObject({ ok: true });
      expect(stored).toEqual([type.replace("wallet.", "")]);
    });
  }

  test("a router with no pool reader refuses rather than skipping the check", async () => {
    const { getStrk20PublicKey: _, ...withoutPoolReader } = makeRuntimeRpc();
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async previewImportedStrk20ViewingPublicKey() {
          return { address: account.address, viewingPublicKey: OWN_VIEWING_PUBLIC_KEY };
        },
      },
      testExtension,
      { runtimeRpc: withoutPoolReader, session },
    );
    await expect(handler(rawKey("wallet.importAccount"), extensionSender)).resolves.toEqual(
      UNCHECKED,
    );
  });
});

describe("Ledger import privacy-pool check", () => {
  test("refuses any registered Ledger account: Bramble never registers one", async () => {
    const { handler, poolReads, stored } = harness(async () => "0xbeef");
    await expect(handler(addLedger, extensionSender)).resolves.toEqual(ELSEWHERE);
    expect(poolReads).toEqual([ledgerAccount.address]);
    expect(stored).toEqual([]);
  });

  test("refuses when the pool cannot be read", async () => {
    const { handler, stored } = harness(async () => {
      throw new Error("node unreachable");
    });
    await expect(handler(addLedger, extensionSender)).resolves.toEqual(UNCHECKED);
    expect(stored).toEqual([]);
  });

  test("stores an unregistered Ledger account", async () => {
    const { handler, stored } = harness(async () => "0x0");
    await expect(handler(addLedger, extensionSender)).resolves.toMatchObject({ ok: true });
    expect(stored).toEqual(["addLedgerAccount"]);
  });
});

describe("raw-key import on a locked wallet", () => {
  test("reports wallet locked without reading the pool", async () => {
    const poolReads: string[] = [];
    const handler = createMessageHandler(createWallet(), testExtension, {
      runtimeRpc: makeRuntimeRpc({
        getStrk20PublicKey: async ({ address }) => {
          poolReads.push(address);
          return "0x0";
        },
      }),
      session: createUnlockSession(),
    });
    await expect(handler(rawKey("wallet.importAccount"), extensionSender)).resolves.toEqual({
      error: "wallet locked",
    });
    expect(poolReads).toEqual([]);
  });
});
