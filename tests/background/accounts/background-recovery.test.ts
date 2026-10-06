/**
 * Recovery review/submit handlers: privileged, bound to the reviewed account,
 * step and fee, Ledger-refusing, and journaling every accepted or possibly
 * landed submission to activity — including the lost-reply and hash-mismatch
 * case, which must never read as a determinate failure.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentRecoveryInput, BraavosRecoveryInput } from "@bramble/starknet/rpc";
import { IndeterminateRpcWriteError } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { createActivityLog } from "@bramble/transactions/activity";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { walletStub as sharedWalletStub } from "../../support/key-boundary-collaborators";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const base = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const derived = {
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const braavos: AccountRef = {
  ...base,
  ...derived,
  accountContractType: "braavos",
  deploymentSalt: base.publicKeyX,
};
const argent: AccountRef = {
  ...base,
  ...derived,
  accountContractType: "argent",
  deploymentSalt: base.publicKeyX,
};
const ledgerArgent = {
  ...base,
  accountContractType: "argent",
  deploymentSalt: base.publicKeyX,
  derivation: {
    accountIndex: 0,
    eip2645application: "argentx",
    kind: "ledger",
    path: "m/2645'/1195502025'/1148870696'/0'/0'/0",
  },
} as unknown as AccountRef;

const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: "https://example.com/app" };
const FEE = { overallFee: "100", unit: "FRI" as const };

const harness = (account: AccountRef, overrides: Partial<RuntimeRpc> = {}) => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
  let tick = 0;
  const activity = createActivityLog({
    now: () => {
      tick += 1000;
      return tick;
    },
    store: createMemoryStore(),
  });
  const calls: {
    readonly argent: ArgentRecoveryInput[];
    readonly braavos: BraavosRecoveryInput[];
  } = { argent: [], braavos: [] };
  const handler = createMessageHandler(
    {
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
    },
    testExtension,
    {
      activity,
      runtimeRpc: makeRuntimeRpc({
        async reviewBraavosRecovery() {
          return { delaySeconds: 345_600, effectiveAfter: 1_345_600, fee: FEE };
        },
        async submitBraavosRecovery(input) {
          calls.braavos.push(input);
          input.onSigned?.("0xb1");
          return { pendingUntil: 1_345_600, transactionHash: "0xb1" };
        },
        async reviewArgentRecovery() {
          return {
            expiresAt: 2_209_600,
            fee: FEE,
            readyAt: 1_604_800,
            replaces: { kind: "owner-escape" as const, readyAt: 1_500 },
            step: "start" as const,
          };
        },
        async submitArgentRecovery(input) {
          calls.argent.push(input);
          const hash = `0xa${calls.argent.length}`;
          input.onSigned?.(hash);
          return { expiresAt: 2_209_600, readyAt: 1_604_800, transactionHash: hash };
        },
        ...overrides,
      }),
      session,
    },
  );
  const send = (message: Record<string, unknown>, sender = extensionSender) =>
    handler(message, sender);
  return { activity, calls, send };
};

const braavosSubmit = {
  accountId: braavos.id,
  reviewedFee: FEE,
  type: "wallet.recoverBraavosAccount",
};
const argentSubmit = (extra: Record<string, unknown> = {}) => ({
  accountId: argent.id,
  reviewedFee: FEE,
  step: "start",
  type: "wallet.recoverArgentAccount",
  ...extra,
});

describe("recovery reviews", () => {
  test("state what each confirmation shows", async () => {
    expect(await harness(braavos).send({ type: "wallet.reviewBraavosRecovery" })).toEqual({
      accountId: braavos.id,
      expiresAt: null,
      fee: FEE,
      ok: true,
      readyAt: 1_345_600,
      replaces: null,
      step: "start",
    });
    expect(await harness(argent).send({ type: "wallet.reviewArgentRecovery" })).toEqual({
      accountId: argent.id,
      expiresAt: 2_209_600,
      fee: FEE,
      ok: true,
      readyAt: 1_604_800,
      replaces: { kind: "owner-escape", readyAt: 1_500 },
      step: "start",
    });
  });

  test("stay privileged", async () => {
    for (const type of ["wallet.reviewBraavosRecovery", "wallet.recoverBraavosAccount"]) {
      expect(await harness(braavos).send({ type }, contentSender)).toEqual({
        error: "privileged sender required",
      });
    }
    for (const type of ["wallet.reviewArgentRecovery", "wallet.recoverArgentAccount"]) {
      expect(await harness(argent).send({ type }, contentSender)).toEqual({
        error: "privileged sender required",
      });
    }
  });

  test("refuse a Ledger account before any estimate or signer", async () => {
    let reached = false;
    const { calls, send } = harness(ledgerArgent, {
      async reviewArgentRecovery() {
        reached = true;
        throw new Error("unreachable");
      },
    });
    const refusal = { error: "Account recovery is not available for Ledger accounts" };
    expect(await send({ type: "wallet.reviewArgentRecovery" })).toEqual(refusal);
    expect(await send(argentSubmit({ accountId: ledgerArgent.id }))).toEqual(refusal);
    expect(reached).toBe(false);
    expect(calls.argent).toHaveLength(0);
  });
});

describe("recovery submissions", () => {
  test("submit the Braavos request under the reviewed fee and journal it", async () => {
    const { activity, calls, send } = harness(braavos);
    expect(await send(braavosSubmit)).toEqual({
      accountId: braavos.id,
      ok: true,
      pendingUntil: 1_345_600,
      transactionHash: "0xb1",
    });
    expect(calls.braavos[0]?.reviewedFee).toEqual(FEE);
    expect(calls.braavos[0]?.isAuthorized?.()).toBe(true);
    expect(await activity.list()).toMatchObject([
      { hash: "0xb1", kind: "invoke", origin: "wallet", summary: "Start 2FA removal" },
    ]);
  });

  test("pass the confirmed step and owner-escape acknowledgement for Ready", async () => {
    const { activity, calls, send } = harness(argent);
    await send(argentSubmit({ replaceEscapeReadyAt: 1_500 }));
    expect(calls.argent[0]).toMatchObject({ expectedStep: "start", replaceEscapeReadyAt: 1_500 });
    await send(argentSubmit({ step: "complete" }));
    expect(calls.argent[1]?.expectedStep).toBe("complete");
    expect(calls.argent[1]?.replaceEscapeReadyAt).toBeUndefined();
    expect((await activity.list()).map((entry) => entry.summary).sort()).toEqual([
      "Complete guardian removal",
      "Start guardian removal",
    ]);
  });

  test("refuse malformed or unbound requests", async () => {
    const { calls, send } = harness(argent);
    const invalid = { error: "invalid account recovery request" };
    expect(await send(argentSubmit({ step: undefined }))).toEqual(invalid);
    expect(await send(argentSubmit({ replaceEscapeReadyAt: true }))).toEqual(invalid);
    expect(await send(argentSubmit({ replaceEscapeReadyAt: 0 }))).toEqual(invalid);
    expect(await send(argentSubmit({ replaceEscapeReadyAt: 1.5 }))).toEqual(invalid);
    expect(await send(argentSubmit({ step: "cancel" }))).toEqual(invalid);
    expect(await send(argentSubmit({ reviewedFee: undefined }))).toEqual(invalid);
    expect(await send({ ...argentSubmit(), accountId: undefined })).toEqual(invalid);
    expect(await send(argentSubmit({ accountId: "SN_MAIN:0x99" }))).toEqual({
      error: "The active account changed. Review the recovery again.",
    });
    expect(calls.argent).toHaveLength(0);
    const braavosHarness = harness(braavos);
    expect(await braavosHarness.send({ ...braavosSubmit, step: "start" })).toEqual(invalid);
    expect(braavosHarness.calls.braavos).toHaveLength(0);
  });

  test("journal a lost or mismatched reply under the signed hash and report it unknown", async () => {
    const { activity, send } = harness(braavos, {
      async submitBraavosRecovery(input) {
        input.onSigned?.("0xb2");
        throw new IndeterminateRpcWriteError("RPC accepted a different transaction hash.");
      },
    });
    expect(await send(braavosSubmit)).toEqual({
      error: "RPC accepted a different transaction hash.",
      submissionUnknown: true,
      transactionHash: "0xb2",
    });
    expect(await activity.list()).toMatchObject([
      { hash: "0xb2", status: "pending", summary: "Start 2FA removal" },
    ]);
  });

  test("record nothing when nothing was signed or the failure is determinate", async () => {
    const unsigned = harness(argent, {
      async submitArgentRecovery() {
        throw new IndeterminateRpcWriteError("Transaction submission status is unknown.");
      },
    });
    expect(await unsigned.send(argentSubmit())).toEqual({
      error: "Transaction submission status is unknown.",
      submissionUnknown: true,
    });
    expect(await unsigned.activity.list()).toEqual([]);
    const refused = harness(argent, {
      async submitArgentRecovery() {
        throw new Error("The recovery fee changed. Review it and try again.");
      },
    });
    expect(await refused.send(argentSubmit())).toHaveProperty("error");
    expect(await refused.activity.list()).toEqual([]);
  });
});
