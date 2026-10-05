/**
 * Active-account signability verdict for the Home read-only flag: privileged,
 * locked-safe, family-routed, and advisory — a failing probe answers signable
 * rather than alarming on an RPC flake, since the transaction path keeps the
 * authoritative checks.
 */
import { describe, expect, test } from "bun:test";
import type { SigningRestrictionInput } from "@bramble/starknet/rpc";
import type { Vault } from "@bramble/vault/schema";
import { BRAAVOS_DEPLOYMENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { walletStub as sharedWalletStub } from "../../support/key-boundary-collaborators";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const base = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };
const vaultPassphrase = "correct horse battery staple";

type ProbeBehaviour = "guardian" | "null" | "strong-signer" | "throws";

const makeHandler = (
  account: AccountRef,
  options: { readonly deployed?: boolean; readonly probe?: ProbeBehaviour } = {},
) => {
  const probeCalls: SigningRestrictionInput[] = [];
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
  const localWallet = {
    ...sharedWalletStub,
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
  };
  const handler = createMessageHandler(localWallet, testExtension, {
    runtimeRpc: makeRuntimeRpc({
      async getArgentSigningRestriction(input) {
        probeCalls.push(input);
        if (options.probe === "throws") throw new Error("probe unavailable");
        return options.probe === "guardian" ? "guardian" : null;
      },
      async getBraavosSigningRestriction(input) {
        probeCalls.push(input);
        if (options.probe === "throws") throw new Error("probe unavailable");
        return options.probe === "strong-signer" ? "strong-signer" : null;
      },
      async getDeploymentStatus() {
        return options.deployed ?? true;
      },
    }),
    session,
  });
  const ask = () => handler({ type: "wallet.accountSignability" }, extensionSender);
  return { ask, handler, probeCalls };
};

const ozAccount: AccountRef = { ...base, accountContractType: "openzeppelin" };
const argentAccount: AccountRef = {
  ...base,
  accountContractType: "argent",
  deploymentSalt: base.publicKeyX,
};
const braavosAccount: AccountRef = {
  ...base,
  accountContractType: "braavos",
  deploymentSalt: base.publicKeyX,
};

describe("background braavos recovery", () => {
  const recoverable: AccountRef = {
    ...base,
    accountContractType: "braavos",
    deploymentSalt: base.publicKeyX,
  };
  const makeRecoveryHandler = () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const vault = { accounts: [recoverable], activeAccountId: recoverable.id } as unknown as Vault;
    const handler = createMessageHandler(
      {
        ...sharedWalletStub,
        async readVault() {
          return vault;
        },
        async status() {
          return {
            accountCount: 1,
            activeAccountId: recoverable.id,
            hasVault: true,
            locked: false,
            ready: true,
          };
        },
      },
      testExtension,
      {
        runtimeRpc: makeRuntimeRpc({
          async getBraavosRecoveryState() {
            return { delaySeconds: 345_600, pendingUntil: null };
          },
          async reviewBraavosRecovery() {
            return { overallFee: "100", unit: "FRI" as const };
          },
          async submitBraavosRecovery() {
            return { pendingUntil: 1_000, transactionHash: "0xreq" };
          },
        }),
        session,
      },
    );
    return handler;
  };

  test("quotes the removal fee and delay", async () => {
    const handler = makeRecoveryHandler();
    expect(await handler({ type: "wallet.reviewBraavosRecovery" }, extensionSender)).toEqual({
      accountId: recoverable.id,
      delaySeconds: 345_600,
      fee: { overallFee: "100", unit: "FRI" },
      ok: true,
    });
  });

  test("submits the reviewed removal request", async () => {
    const handler = makeRecoveryHandler();
    expect(
      await handler(
        { reviewedFee: { overallFee: "100", unit: "FRI" }, type: "wallet.recoverBraavosAccount" },
        extensionSender,
      ),
    ).toEqual({
      accountId: recoverable.id,
      ok: true,
      pendingUntil: 1_000,
      transactionHash: "0xreq",
    });
  });

  test("stays privileged", async () => {
    const handler = makeRecoveryHandler();
    expect(await handler({ type: "wallet.reviewBraavosRecovery" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
  });
});

describe("background account signability", () => {
  test("stays privileged and locked-safe", async () => {
    const { handler } = makeHandler(ozAccount);
    expect(await handler({ type: "wallet.accountSignability" }, contentSender)).toEqual({
      error: "privileged sender required",
    });
    const locked = createMessageHandler(
      {
        ...sharedWalletStub,
        async status() {
          return {
            accountCount: 0,
            activeAccountId: null,
            hasVault: true,
            locked: true,
            ready: true,
          };
        },
      },
      testExtension,
      { runtimeRpc: makeRuntimeRpc({}), session: createUnlockSession() },
    );
    expect(await locked({ type: "wallet.accountSignability" }, extensionSender)).toEqual({
      error: "wallet locked",
    });
  });

  test("answers signable for the wallet's own accounts without probing", async () => {
    const { ask, probeCalls } = makeHandler(ozAccount);
    expect(await ask()).toEqual({ accountId: ozAccount.id, ok: true, readOnly: false });
    expect(probeCalls).toHaveLength(0);
  });

  test("probes a deployed Braavos account and marks only real restrictions", async () => {
    const guarded = makeHandler(braavosAccount, { probe: "strong-signer" });
    expect(await guarded.ask()).toEqual({
      accountId: braavosAccount.id,
      ok: true,
      readOnly: true,
      reason: "strong-signer",
    });
    const starkOnly = makeHandler(braavosAccount, { probe: "null" });
    expect(await starkOnly.ask()).toEqual({
      accountId: braavosAccount.id,
      ok: true,
      readOnly: false,
    });
    // An undeployed Braavos counterfactual on an older base class stays view
    // only; the modern deployment class deploys from here like any account.
    const undeployed = makeHandler(braavosAccount, { deployed: false });
    expect(await undeployed.ask()).toEqual({
      accountId: braavosAccount.id,
      ok: true,
      readOnly: true,
      reason: "braavos",
    });
    const modern = makeHandler(
      { ...braavosAccount, classHash: canonicalFelt(BRAAVOS_DEPLOYMENT_CLASS_HASH) as string },
      { deployed: false },
    );
    expect(await modern.ask()).toEqual({
      accountId: braavosAccount.id,
      ok: true,
      readOnly: false,
    });
  });

  test("carries a deployed Argent account's probed restriction", async () => {
    const { ask, probeCalls } = makeHandler(argentAccount, { probe: "guardian" });
    expect(await ask()).toEqual({
      accountId: argentAccount.id,
      ok: true,
      readOnly: true,
      reason: "guardian",
    });
    expect(probeCalls).toEqual([
      {
        accountAddress: argentAccount.address,
        publicKeyX: argentAccount.publicKeyX,
        rpcUrls: [
          "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10",
          "https://mainnet.nodes.starknet.org/rpc/v0_10",
        ],
      },
    ]);
  });

  test("answers signable for an undeployed Argent account and on a failed probe", async () => {
    const undeployed = makeHandler(argentAccount, { deployed: false, probe: "guardian" });
    expect(await undeployed.ask()).toEqual({
      accountId: argentAccount.id,
      ok: true,
      readOnly: false,
    });
    expect(undeployed.probeCalls).toHaveLength(0);
    const flaky = makeHandler(argentAccount, { probe: "throws" });
    expect(await flaky.ask()).toEqual({ accountId: argentAccount.id, ok: true, readOnly: false });
  });
});
