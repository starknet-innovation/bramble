/**
 * The Home notice's Ready key verdict: privileged, locked-safe, asked only for
 * Ready-scheme accounts, answered with a boolean and an account id only, and
 * advisory — a failing vault check shows no notice rather than alarming.
 */
import { describe, expect, test } from "bun:test";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { walletStub as sharedWalletStub } from "../../support/key-boundary-collaborators";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const address = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const base = {
  accountContractType: "argent" as const,
  address,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  deploymentSalt: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: `SN_MAIN:${address}`,
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const readyAccount = {
  ...base,
  derivation: { addressIndex: 0, kind: "argentx-bip44" as const },
} as AccountRef;
const ownAccount = {
  ...base,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
} as AccountRef;

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };
const vaultPassphrase = "correct horse battery staple";

const makeHandler = (account: AccountRef, check: "affected" | "current" | "throws") => {
  const checks: { accountId: string; vaultPassphrase: string }[] = [];
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
  const handler = createMessageHandler(
    {
      ...sharedWalletStub,
      async hasPreFixReadyKey(input: { accountId: string; vaultPassphrase: string }) {
        checks.push(input);
        if (check === "throws") throw new Error("krusty unavailable");
        return check === "affected";
      },
      async readVault() {
        return vault;
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
    testExtension,
    { runtimeRpc: makeRuntimeRpc({}), session },
  );
  const ask = () => handler({ type: "wallet.readyKeyStatus" }, extensionSender);
  return { ask, checks, handler };
};

describe("background Ready key status", () => {
  test("stays privileged and rejects extra fields", async () => {
    const { handler } = makeHandler(readyAccount, "affected");
    expect(await handler({ type: "wallet.readyKeyStatus" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
    expect(
      await handler({ accountId: "x", type: "wallet.readyKeyStatus" }, extensionSender),
    ).toEqual({ error: "invalid Ready key status request" });
  });

  test("flags an affected Ready account with its id and a boolean only", async () => {
    const { ask, checks } = makeHandler(readyAccount, "affected");
    expect(await ask()).toEqual({ accountId: readyAccount.id, ok: true, preFixKey: true });
    expect(checks).toEqual([{ accountId: readyAccount.id, vaultPassphrase }]);
  });

  test("answers false for a current Ready key", async () => {
    const { ask } = makeHandler(readyAccount, "current");
    expect(await ask()).toEqual({ accountId: readyAccount.id, ok: true, preFixKey: false });
  });

  test("never asks the vault about accounts outside the Ready scheme", async () => {
    const { ask, checks } = makeHandler(ownAccount, "affected");
    expect(await ask()).toEqual({ accountId: ownAccount.id, ok: true, preFixKey: false });
    expect(checks).toHaveLength(0);
  });

  test("a failing check shows no notice instead of an error", async () => {
    const { ask } = makeHandler(readyAccount, "throws");
    expect(await ask()).toEqual({ accountId: readyAccount.id, ok: true, preFixKey: false });
  });
});
