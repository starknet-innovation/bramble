/**
 * Concurrent dapp requests from one origin that do expensive work before they
 * queue (Sherlock 151). A declare reads the vault, hashes the contract class
 * and estimates fees; a typed-data signature reads the vault and hashes the
 * document. Admission reserves a slot first, so only as many requests as the
 * origin may queue run that work at once, and the rest are refused before any
 * of it.
 */
import { describe, expect, test } from "bun:test";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  createApprovalQueue,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { unavailablePreferencesStore } from "../../../apps/extension/src/background/runtime/runtime-state";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import {
  invokeAccount,
  invokeContentSender,
  invokeOrigin,
  invokeVaultPassphrase,
  invokeWalletStub,
} from "../../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

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
const origin = "https://dapp.example";
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };
const FEE: FeeEstimate = { overallFee: "2500000000000000", unit: "FRI" } as FeeEstimate;

const declareMessage = (index: number) => ({
  declare: {
    classHash: `0x5ab${index}`,
    compiledClassHash: "0x6def",
    contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
  },
  origin,
  type: "wallet.addDeclareTransaction" as const,
});

describe("concurrent declare requests (Sherlock 151)", () => {
  test("only as many as the origin may queue run the review at once", async () => {
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");
    const approvals = createApprovalQueue();
    const gates: (() => void)[] = [];
    let estimates = 0;
    const rpc = {
      async estimateAccountDeploymentFee() {
        return FEE;
      },
      async estimateDeclareFee() {
        estimates += 1;
        await new Promise<void>((resolve) => gates.push(resolve));
        return FEE;
      },
      async getDeploymentStatus() {
        return true;
      },
    } as unknown as RuntimeRpc;
    const wallet = {
      async getGrantedAccounts(target: string) {
        return target === origin ? [account] : [];
      },
    };
    const handler = createMessageHandler(wallet as never, testExtension, {
      approvals,
      preferencesStore: unavailablePreferencesStore,
      runtimeRpc: rpc,
      session,
    });

    const count = MAX_PENDING_APPROVALS_PER_ORIGIN + 3;
    const responses = Array.from({ length: count }, (_, index) =>
      handler(declareMessage(index), contentSender),
    );
    while (estimates < MAX_PENDING_APPROVALS_PER_ORIGIN) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const refused = await Promise.all(responses.slice(MAX_PENDING_APPROVALS_PER_ORIGIN));

    expect(estimates).toBe(MAX_PENDING_APPROVALS_PER_ORIGIN);
    expect(refused.every((response) => "error" in (response as object))).toBe(true);
    expect(approvals.list()).toEqual([]);

    for (const open of gates) {
      open();
    }
    while (approvals.list().length < MAX_PENDING_APPROVALS_PER_ORIGIN) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(approvals.list()).toHaveLength(MAX_PENDING_APPROVALS_PER_ORIGIN);
  });
});

const signMessage = {
  origin: invokeOrigin,
  type: "wallet.signTypedData",
  typedData: {
    domain: { chainId: "0x534e5f4d41494e", name: "Concurrent", version: "1" },
    message: { a: ["0x1"] },
    primaryType: "Bulk",
    types: {
      Bulk: [{ name: "a", type: "felt*" }],
      StarkNetDomain: [
        { name: "name", type: "felt" },
        { name: "version", type: "felt" },
        { name: "chainId", type: "felt" },
      ],
    },
  },
};

describe("concurrent typed-data signature requests (Sherlock 151)", () => {
  test("only as many as the origin may queue read the vault at once", async () => {
    const session = createUnlockSession();
    session.unlock(invokeVaultPassphrase);
    const stub = invokeWalletStub([invokeAccount]);
    const gates: (() => void)[] = [];
    let grantReads = 0;
    const handler = createMessageHandler(
      {
        ...stub,
        async getGrantedAccounts(target: string) {
          grantReads += 1;
          await new Promise<void>((resolve) => gates.push(resolve));
          return stub.getGrantedAccounts(target);
        },
      } as unknown as Parameters<typeof createMessageHandler>[0],
      testExtension,
      { runtimeRpc: makeRuntimeRpc(), session },
    );

    const responses = Array.from({ length: MAX_PENDING_APPROVALS_PER_ORIGIN + 3 }, () =>
      handler(signMessage, invokeContentSender),
    );
    while (grantReads < MAX_PENDING_APPROVALS_PER_ORIGIN) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const refused = await Promise.all(responses.slice(MAX_PENDING_APPROVALS_PER_ORIGIN));

    expect(grantReads).toBe(MAX_PENDING_APPROVALS_PER_ORIGIN);
    expect(refused).toEqual(Array.from({ length: 3 }, () => ({ error: "wallet request failed" })));
    for (const open of gates) {
      open();
    }
  });
});
