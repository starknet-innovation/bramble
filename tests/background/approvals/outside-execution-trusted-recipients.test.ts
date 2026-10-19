/**
 * The OutsideExecution sign review (audit 144) judges recipients against the
 * same trusted set as the dapp invoke route (audit 163): contacts, the user's
 * other vault accounts and watched shared accounts, and the recipients this
 * wallet itself paid. A SNIP-9 signature authorizes calls the site can submit
 * later with no second prompt, so a narrower set here would let a lookalike
 * the invoke route refuses through on the sign route instead.
 */
import { describe, expect, test } from "bun:test";
import { type MultisigStore, memoryMultisigStore } from "@bramble/multisig/repository";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { type ActivityEntry, memoryActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { constants, outsideExecution } from "starknet";
import { setApprovalNotifier } from "../../../apps/extension/src/background/approvals/approval-notifier";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { chromiumExtension } from "../../support/background-wallet-stub";
import { flushHeld, waitForPendingApprovals } from "../../support/held";

const PASSPHRASE = "correct horse battery staple";
const ORIGIN = "https://dapp.example";
const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
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
// The user's second vault account and a different address sharing its window.
const SECOND: AccountRef = {
  ...account,
  address: "0x07aa11111111111111111111111111111111111111111111111111111111c0de",
  id: "SN_MAIN:0x07aa11111111111111111111111111111111111111111111111111111111c0de",
};
const SECOND_TWIN = "0x07aa12222222222222222222222222222222222222222222222222222222c0de";
// An unsaved recipient this wallet paid (an exchange deposit address) and a twin.
const PAID = "0x049d3aa7890abcdef1234567890abcdef1234567890abcdef1234567890a9f1e";
const PAID_TWIN = "0x049d3ff111111111111111111111111111111111111111111111111111119f1e";
// A watched shared account and a twin of it.
const SHARED = "0x05bb33333333333333333333333333333333333333333333333333333333f00d";
const SHARED_TWIN = "0x05bb34444444444444444444444444444444444444444444444444444444f00d";

const content: RuntimeSender = { id: "ext", url: `${ORIGIN}/swap` };
const page: RuntimeSender = { id: "ext", url: "chrome-extension://ext/sidepanel.html" };

let signed = 0;
const wallet = {
  async getGrantedAccounts() {
    return [account];
  },
  async readVault() {
    return {
      accounts: [account, SECOND],
      accountSecrets: [],
      activeAccountId: account.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin: ORIGIN }],
      schemaVersion: 10 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x7e5" }],
    };
  },
  async signHash() {
    signed += 1;
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 2,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

// A wallet-origin row: what the background records for a send it broadcast.
const paidRow = (
  counterparty: string,
): Omit<ActivityEntry, "status" | "submittedAt"> & { readonly origin: "wallet" } => ({
  accountId: account.id,
  counterparty,
  hash: "0x77",
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  summary: "Sent 1 ETH",
});

const transferTo = (recipient: string): unknown =>
  JSON.parse(
    JSON.stringify(
      outsideExecution.getTypedData(
        constants.StarknetChainId.SN_MAIN,
        { caller: "0x0", execute_after: 1, execute_before: 999_999_999_999 },
        1,
        [{ calldata: [recipient, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
        "2",
      ),
    ),
  );

const setup = async (runtimeRpc?: RuntimeRpc) => {
  setApprovalNotifier(() => undefined);
  signed = 0;
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  const activity = memoryActivityLog(() => 10);
  // The registry as the background reads it: one watched shared account.
  const multisigStore: MultisigStore = {
    ...memoryMultisigStore(),
    async listMultisigs() {
      return [
        {
          accountContractType: "argent-multisig",
          address: SHARED,
          classHash: "0x1",
          id: `SN_MAIN:${SHARED}`,
          networkId: "SN_MAIN",
        },
      ];
    },
  };
  const handler = createMessageHandler(wallet as never, chromiumExtension("ext"), {
    activity,
    multisigStore,
    preferencesStore: createPreferencesStore({ store: createMemoryStore() }),
    ...(runtimeRpc ? { runtimeRpc } : {}),
    session,
  });
  const sign = (typedData: unknown) =>
    handler({ origin: ORIGIN, type: "wallet.signTypedData", typedData }, content);
  // A refusal settles at once; a queued request stays held until a decision.
  const signNow = (typedData: unknown) =>
    Promise.race([
      sign(typedData),
      new Promise((resolve) => {
        setTimeout(() => resolve("held"), 250);
      }),
    ]);
  const pending = async () =>
    (
      (await handler({ type: "wallet.pendingApprovals" }, page)) as {
        readonly pending: readonly unknown[];
      }
    ).pending;
  return { activity, handler, pending, sign, signNow };
};

const MIMICS = { error: expect.stringContaining("closely mimics") };

// A lookalike is queued with its flag, not refused on arrival, so the answer
// cannot reveal the trusted set (Sherlock 140); approving it is still refused
// before any key is used.
const expectFlaggedThenRefused = async (
  handler: Awaited<ReturnType<typeof setup>>["handler"],
): Promise<void> => {
  await flushHeld();
  const [queued] = await waitForPendingApprovals<{
    readonly flags?: readonly { readonly code: string }[];
    readonly id: string;
  }>(handler, page);
  expect(queued?.flags?.map((flag) => flag.code)).toContain("address-poisoning");
  await expect(handler({ id: queued?.id, type: "wallet.approveOrigin" }, page)).resolves.toEqual(
    MIMICS,
  );
  expect(signed).toBe(0);
};

describe("OutsideExecution review uses the invoke route's trusted set (audit 163)", () => {
  test("flags a transfer to a lookalike of a recipient this wallet paid and refuses it at approval", async () => {
    const { activity, handler, signNow } = await setup();
    await activity.record(paidRow(PAID));
    await expect(signNow(transferTo(PAID_TWIN))).resolves.toBe("held");
    await expectFlaggedThenRefused(handler);
  });

  test("flags a transfer to a lookalike of the user's other vault account and refuses it at approval", async () => {
    const { handler, signNow } = await setup();
    await expect(signNow(transferTo(SECOND_TWIN))).resolves.toBe("held");
    await expectFlaggedThenRefused(handler);
  });

  test("flags a transfer to a lookalike of a watched shared account and refuses it at approval", async () => {
    const { handler, signNow } = await setup();
    await expect(signNow(transferTo(SHARED_TWIN))).resolves.toBe("held");
    await expectFlaggedThenRefused(handler);
  });

  test("still queues a transfer to the paid recipient itself", async () => {
    const { activity, signNow } = await setup();
    await activity.record(paidRow(PAID));
    await expect(signNow(transferTo(PAID))).resolves.toBe("held");
  });

  test("refuses at approval when a payment made meanwhile makes the payee a lookalike", async () => {
    const { activity, handler, sign } = await setup();
    const held = sign(transferTo(PAID_TWIN));
    await flushHeld();
    const [queued] = await waitForPendingApprovals(handler, page);
    await activity.record(paidRow(PAID));
    await expect(handler({ id: queued?.id, type: "wallet.approveOrigin" }, page)).resolves.toEqual(
      MIMICS,
    );
    await expect(held).resolves.toEqual(MIMICS);
    expect(signed).toBe(0);
  });
});

// The dapp invoke route queues the same lookalike Deny-only (Sherlock 140) and
// relies on its execution-time check, which must read the watched shared
// accounts too: a forced approval is refused before anything is submitted.
describe("execution-time lookalike check reads watched shared accounts (Sherlock 140)", () => {
  test("a forced approval of a dapp invoke paying a shared-account twin is refused", async () => {
    let submitted = 0;
    const rpc = {
      async estimateInvokeFee() {
        return { overallFee: "1", unit: "FRI" as const };
      },
      async getDeploymentStatus() {
        return true;
      },
      async getTokenBalances() {
        return [];
      },
      async submitInvokeTransaction() {
        submitted += 1;
        return { calls: [], transactionHash: "0x7cd" };
      },
    } as unknown as RuntimeRpc;
    const { handler } = await setup(rpc);
    const held = handler(
      {
        calls: [
          { calldata: [SHARED_TWIN, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
        ],
        origin: ORIGIN,
        type: "wallet.addInvokeTransaction",
      },
      content,
    );
    type Queued = {
      readonly fee?: { readonly overallFee: string; readonly unit: string };
      readonly flags?: readonly { readonly code: string }[];
      readonly id: string;
    };
    let queued: Queued | undefined;
    for (let attempt = 0; attempt < 50 && !queued?.fee; attempt += 1) {
      await flushHeld();
      [queued] = await waitForPendingApprovals<Queued>(handler, page);
    }
    expect(queued?.flags?.map((flag) => flag.code)).toContain("address-poisoning");
    await expect(
      handler({ id: queued?.id, reviewedFee: queued?.fee, type: "wallet.approveOrigin" }, page),
    ).resolves.toEqual(MIMICS);
    await expect(held).resolves.toEqual(MIMICS);
    expect(submitted).toBe(0);
  });
});
