/**
 * External-allowance manager messages: allowances discovered on-chain (not
 * granted through this wallet) are merged into the list, and revoking one —
 * which has no local store record — still resolves its target from the id and
 * submits a zero-amount approve through the verified invoke path.
 */

import { describe, expect, test } from "bun:test";
import { createPreferencesStore, defaultWalletPreferences } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { isUnlimitedAllowance } from "@bramble/transactions/allowance-discovery";
import type { TrackedAllowanceScan } from "@bramble/transactions/allowance-scan";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { verificationContext } from "@bramble/transactions/verify-decode";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  allowanceOwner,
  recordApproveAllowances,
} from "../../../apps/extension/src/background/portfolio/allowance-recording";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
// A token the user does not track: the dapp's own ERC20, which no `Approval`
// event scan over `preferences.tokens` will ever be asked about.
const UNTRACKED_TOKEN = `0x0666${"6".repeat(59)}1`;
const SPENDER = `0x7${"5".repeat(62)}`;
const UNLIMITED = ((1n << 128n) + 5n).toString();
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
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

const walletStub = {
  async addDerivedAccount() {
    return account;
  },
  async createAccount() {
    return account;
  },
  async ensureNetworkAccount() {
    return account;
  },
  async getGrantedAccounts() {
    return [account];
  },
  async generateMnemonic() {
    return "unused";
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
  async signHash() {
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
  },
  async status() {
    return {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: false,
    };
  },
};

const makeHarness = (
  options: {
    readonly trackedAmounts?: Readonly<Record<string, string>>;
    readonly trackedUnavailable?: boolean;
  } = {},
) => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const invokeCalls: (readonly unknown[])[] = [];
  const trackedReads: TrackedAllowanceScan[] = [];
  const allowanceStore = memoryAllowanceStore();
  const handler = createMessageHandler(walletStub, "extension-id", {
    allowanceStore,
    runtimeRpc: makeRuntimeRpc({
      // Faithful to the real scan: it can only answer about the tokens it was
      // handed, which is `preferences.tokens` for the active network.
      async getExternalAllowances(input) {
        return input.tokens.some((token) => BigInt(token) === BigInt(TOKEN))
          ? [{ amount: "5000", spender: SPENDER, token: TOKEN }]
          : [];
      },
      async getTrackedAllowances(input) {
        trackedReads.push(input);
        if (options.trackedUnavailable) {
          throw new Error("node unavailable");
        }
        const amounts = options.trackedAmounts ?? {};
        return input.pairs.flatMap((pair) => {
          const amount = amounts[pair.id];
          return amount === undefined ? [] : [{ amount, id: pair.id }];
        });
      },
      async submitInvokeTransaction(input) {
        invokeCalls.push(input.calls);
        return { calls: input.calls, transactionHash: "0x7cd" };
      },
    }),
    session,
  });
  return { allowanceStore, handler, invokeCalls, trackedReads };
};

const canonical = (value: string): string => `0x${BigInt(value).toString(16)}`;
const pairId = (token: string): string => `${account.id}:${canonical(token)}:${canonical(SPENDER)}`;

type ListedAllowance = {
  readonly amount: string;
  readonly id: string;
  readonly lowerBound?: true;
  readonly source: string;
  readonly spender: string;
  readonly token: string;
  readonly unconfirmedToken?: true;
};

const listed = async (
  handler: ReturnType<typeof makeHarness>["handler"],
): Promise<readonly ListedAllowance[]> => {
  const response = await handler({ type: "wallet.allowances" }, extensionSender);
  return "allowances" in response ? (response.allowances as readonly ListedAllowance[]) : [];
};

// The trusted set every submitting path builds: this suite's account tracks
// the default mainnet tokens and watches no collections, so TOKEN is fungible
// and UNTRACKED_TOKEN is a contract the wallet cannot classify.
const assets = verificationContext(account, defaultWalletPreferences());

const recordDelta = (
  allowanceStore: ReturnType<typeof memoryAllowanceStore>,
  token: string,
  entrypoint: "decrease_allowance" | "increase_allowance",
  amount = "0x1",
) =>
  recordApproveAllowances({
    assets,
    calls: [{ calldata: [SPENDER, amount, "0x0"], contractAddress: token, entrypoint }],
    owner: allowanceOwner(account),
    store: allowanceStore,
  });

const recordIncrease = (
  allowanceStore: ReturnType<typeof memoryAllowanceStore>,
  token: string,
  amount = "0x1",
) => recordDelta(allowanceStore, token, "increase_allowance", amount);

describe("external allowance manager messages", () => {
  test("merges on-chain discovered allowances into the list, labelled external", async () => {
    const { handler } = makeHarness();
    const response = (await handler({ type: "wallet.allowances" }, extensionSender)) as {
      allowances: readonly { amount: string; source: string; spender: string }[];
    };
    expect(response.allowances).toHaveLength(1);
    expect(response.allowances[0]).toMatchObject({
      amount: "5000",
      source: "external",
      spender: `0x${BigInt(SPENDER).toString(16)}`,
    });
  });

  test("revokes an externally discovered allowance not held in the local store", async () => {
    const { handler, invokeCalls } = makeHarness();
    const listed = (await handler({ type: "wallet.allowances" }, extensionSender)) as {
      allowances: readonly { id: string }[];
    };
    const id = listed.allowances[0]?.id ?? "";

    const review = await handler({ id, type: "wallet.revokeAllowance" }, extensionSender);
    expect(review).toEqual({ feeReview: { overallFee: "1", unit: "FRI" }, ok: true });
    const revoke = await handler(
      { id, reviewedFee: { overallFee: "1", unit: "FRI" }, type: "wallet.revokeAllowance" },
      extensionSender,
    );
    expect(revoke).toEqual({ ok: true, transactionHash: "0x7cd" });

    const revokeCall = invokeCalls.at(-1)?.[0] as { calldata: string[]; entrypoint: string };
    expect(revokeCall.entrypoint).toBe("approve");
    expect(revokeCall.calldata).toEqual([`0x${BigInt(SPENDER).toString(16)}`, "0x0", "0x0"]);
  });

  // MCW-V09-108 regression. The wallet cannot see an approval granted on
  // another site, so an `increase_allowance` it submits on top of one adds to a
  // base it does not know. Reporting that increment as the standing allowance
  // made the manager UNDERSTATE an allowance it had been reporting correctly —
  // and, above the unlimited threshold, dropped the panel's "Unlimited" badge.
  test("never lists an increase as less than the allowance the chain reports", async () => {
    const { allowanceStore, handler } = makeHarness();
    await recordIncrease(allowanceStore, TOKEN);
    expect((await allowanceStore.list())[0]).toMatchObject({ amount: "1", lowerBound: true });

    const response = (await handler({ type: "wallet.allowances" }, extensionSender)) as {
      allowances: readonly { amount: string; lowerBound?: true; source: string }[];
    };
    // One row, not two: the tracked entry owns the (token, spender) pair and
    // reports the stronger of what the wallet knows and what the chain says.
    expect(response.allowances).toHaveLength(1);
    expect(response.allowances[0]).toMatchObject({ amount: "5000", source: "wallet" });
    expect(response.allowances[0]?.lowerBound).toBeUndefined();
  });

  // The regression's real habitat: the dapp's own ERC20, which the user does
  // not track. No `Approval` event scan is ever asked about it, so only the
  // direct per-record read can state the standing allowance.
  test("reads the live amount of a tracked pair on a token the user does not track", async () => {
    const { allowanceStore, handler, trackedReads } = makeHarness({
      trackedAmounts: { [pairId(UNTRACKED_TOKEN)]: UNLIMITED },
    });
    await recordIncrease(allowanceStore, UNTRACKED_TOKEN);

    const dappRow = (await listed(handler)).find(
      (allowance) => BigInt(allowance.token) === BigInt(UNTRACKED_TOKEN),
    );
    expect(dappRow?.amount).toBe(UNLIMITED);
    expect(isUnlimitedAllowance(dappRow?.amount ?? "")).toBe(true);
    // Resolved: the chain answered for this exact pair, so the row is no longer
    // an "at least".
    expect(dappRow?.lowerBound).toBeUndefined();
    // Asked as the account that owns the record, about the record's own token.
    expect(trackedReads[0]?.pairs).toEqual([
      {
        id: pairId(UNTRACKED_TOKEN),
        owner: account.address,
        spender: canonical(SPENDER),
        token: canonical(UNTRACKED_TOKEN),
      },
    ]);
  });

  test("keeps the increase marked as a lower bound when no reading is available", async () => {
    // One offline or erroring node is enough to lose the on-chain reading. The
    // row must then say what the wallet actually knows — "at least 1" — rather
    // than claim 1 is the standing allowance.
    const { allowanceStore, handler } = makeHarness({ trackedUnavailable: true });
    await recordIncrease(allowanceStore, UNTRACKED_TOKEN);

    const dappRow = (await listed(handler)).find(
      (allowance) => BigInt(allowance.token) === BigInt(UNTRACKED_TOKEN),
    );
    expect(dappRow).toMatchObject({ amount: "1", lowerBound: true, source: "wallet" });
  });

  // MCW-V09-108: lower-bound erasure, end to end. The base was granted on the
  // dapp's own site, this wallet saw only `increase_allowance(100)` and then
  // `decrease_allowance(100)`. Deleting the record there stranded a live
  // allowance: with no row, the manager has nothing to list, nothing to revoke,
  // and no pair to take a reading for — so the 995 still standing on chain
  // became invisible.
  test("a decrease that floors a lower bound leaves a row the chain still corrects", async () => {
    const { allowanceStore, handler } = makeHarness({ trackedAmounts: { [pairId(TOKEN)]: "995" } });
    await recordIncrease(allowanceStore, TOKEN, "0x64");
    await recordDelta(allowanceStore, TOKEN, "decrease_allowance", "0x64");

    expect((await allowanceStore.list())[0]).toMatchObject({ amount: "0", lowerBound: true });
    const row = (await listed(handler)).find(
      (allowance) => BigInt(allowance.token) === BigInt(TOKEN),
    );
    expect(row).toMatchObject({ amount: "995", source: "wallet" });
    expect(row?.lowerBound).toBeUndefined();
  });

  test("still rejects revoking an id that does not belong to the active account", async () => {
    const { handler } = makeHarness();
    await expect(
      handler({ id: "SN_MAIN:0x9999:0x1:0x2", type: "wallet.revokeAllowance" }, extensionSender),
    ).resolves.toEqual({ error: "allowance not found" });
  });
});

// MCW-V09-108: an ERC721 `approve(to, token_id)` is byte-for-byte an ERC20
// `approve(spender, amount)`. Filing one as an allowance puts a meaningless row
// in the manager whose Revoke would broadcast `approve(operator, 0)` against the
// collection — under ERC721 that APPROVES item #0, the opposite of revoking.
describe("NFT collection approvals are not ERC20 allowances", () => {
  const COLLECTION = "0x03ba1f0dd8b9b6f7c8d1d1d7f0a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4";
  // The collection in the reported reproducer: an ERC721 the user has never
  // added to their gallery, so no watch entry can tell it from an ERC20.
  const UNWATCHED_COLLECTION = `0x0299${"8".repeat(59)}4`;
  const UNCONFIRMED_REFUSAL =
    "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an NFT instead; revoke it from the dapp";

  const makeNftHarness = async (
    options: { readonly trackedAmounts?: Readonly<Record<string, string>> } = {},
  ) => {
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    await preferencesStore.addNft({
      contract: COLLECTION,
      networkId: "SN_MAIN",
      owner: account.address,
      tokenId: "1",
    });
    const session = createUnlockSession();
    session.unlock("correct horse battery staple");
    const invokeCalls: (readonly unknown[])[] = [];
    const allowanceStore = memoryAllowanceStore();
    const handler = createMessageHandler(walletStub, "extension-id", {
      allowanceStore,
      preferencesStore,
      runtimeRpc: makeRuntimeRpc({
        // Faithful to `collectTrackedAllowances`: a contract with no ERC20
        // `allowance` view (every ERC721) simply yields no reading.
        async getTrackedAllowances(input) {
          const amounts = options.trackedAmounts ?? {};
          return input.pairs.flatMap((pair) => {
            const amount = amounts[pair.token];
            return amount === undefined ? [] : [{ amount, id: pair.id }];
          });
        },
        async submitInvokeTransaction(input) {
          invokeCalls.push(input.calls);
          return { calls: input.calls, transactionHash: "0x7cd" };
        },
      }),
      session,
    });
    // Exactly what every submitting path passes: the one shared trusted-set
    // builder, over this account's real preferences.
    const fileApprove = async (contract: string, amountLow = "0x5") =>
      recordApproveAllowances({
        assets: verificationContext(account, await preferencesStore.read()),
        calls: [
          {
            calldata: [SPENDER, amountLow, "0x0"],
            contractAddress: contract,
            entrypoint: "approve",
          },
        ],
        owner: allowanceOwner(account),
        store: allowanceStore,
      });
    return { allowanceStore, fileApprove, handler, invokeCalls };
  };

  test("a watched collection approval is never even filed in the log", async () => {
    const { allowanceStore, fileApprove, handler } = await makeNftHarness();
    await fileApprove(COLLECTION);

    expect(await allowanceStore.list()).toEqual([]);
    expect(await listed(handler)).toEqual([]);
  });

  test("revoking a collection row is refused instead of broadcasting an approval", async () => {
    // Written straight to the log, as a build before the recording guard would
    // have left it: the refusal must not depend on the row being unwritable.
    const { allowanceStore, handler, invokeCalls } = await makeNftHarness();
    await allowanceStore.record({
      accountId: account.id,
      amount: "7",
      networkId: "SN_MAIN",
      spender: SPENDER,
      token: COLLECTION,
    });
    const id = (await allowanceStore.list())[0]?.id ?? "";

    await expect(handler({ id, type: "wallet.revokeAllowance" }, extensionSender)).resolves.toEqual(
      {
        error: "this contract is an NFT collection, not a token; revoke it from the dapp",
      },
    );
    expect(invokeCalls).toEqual([]);
  });

  // MCW-V09-108(c), the reported reproducer. An unwatched collection is
  // indistinguishable from an ERC20 by calldata, so the manager must not claim
  // its item id is an amount, and must not "revoke" it with a call that grants.
  test("an approve on an unwatched collection is listed unconfirmed and cannot be revoked", async () => {
    const { fileApprove, handler, invokeCalls } = await makeNftHarness();
    await fileApprove(UNWATCHED_COLLECTION);

    const row = (await listed(handler)).find(
      (allowance) => BigInt(allowance.token) === BigInt(UNWATCHED_COLLECTION),
    );
    expect(row).toMatchObject({ amount: "5", unconfirmedToken: true });

    await expect(
      handler({ id: row?.id, type: "wallet.revokeAllowance" }, extensionSender),
    ).resolves.toEqual({ error: UNCONFIRMED_REFUSAL });
    expect(invokeCalls).toEqual([]);
  });

  test("the same approve on a dapp's own ERC20 stays listed and revokable", async () => {
    // The chain answers `allowance(owner, spender)` for the pair, which is a
    // question only a fungible token can answer — so this row keeps its amount,
    // its exactness, and its revoke.
    const { fileApprove, handler, invokeCalls } = await makeNftHarness({
      trackedAmounts: { [canonical(UNTRACKED_TOKEN)]: "5000" },
    });
    await fileApprove(UNTRACKED_TOKEN);

    const row = (await listed(handler)).find(
      (allowance) => BigInt(allowance.token) === BigInt(UNTRACKED_TOKEN),
    );
    expect(row).toMatchObject({ amount: "5000" });
    expect(row?.unconfirmedToken).toBeUndefined();

    await handler({ id: row?.id, type: "wallet.revokeAllowance" }, extensionSender);
    await expect(
      handler(
        {
          id: row?.id,
          reviewedFee: { overallFee: "1", unit: "FRI" },
          type: "wallet.revokeAllowance",
        },
        extensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls).toHaveLength(1);
  });
});
