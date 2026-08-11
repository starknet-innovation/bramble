/**
 * External-allowance manager messages: allowances discovered on-chain (not
 * granted through this wallet) are merged into the list, and revoking one —
 * which has no local store record — still resolves its target from the id and
 * submits a zero-amount approve through the verified invoke path.
 */
import { describe, expect, test } from "bun:test";
import { allowanceOwner, recordApproveAllowances } from "../../src/background/allowance-recording";
import { createMessageHandler } from "../../src/background/messages";
import type { RuntimeSender } from "../../src/background/senders";
import { createUnlockSession } from "../../src/background/session";
import { isUnlimitedAllowance } from "../../src/starknet/allowance-discovery";
import type { TrackedAllowanceScan } from "../../src/starknet/allowance-scan";
import { memoryAllowanceStore } from "../../src/storage/allowance-store";
import { createMemoryStore } from "../../src/storage/kv";
import { createPreferencesStore } from "../../src/storage/preferences-store";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
// A token the user does not track: the dapp's own ERC20, which no `Approval`
// event scan over `preferences.tokens` will ever be asked about.
const UNTRACKED_TOKEN = `0x0666${"6".repeat(59)}1`;
const SPENDER = `0x7${"5".repeat(62)}`;
const UNLIMITED = ((1n << 128n) + 5n).toString();
const account: AccountRef = {
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
};

const listed = async (
  handler: ReturnType<typeof makeHarness>["handler"],
): Promise<readonly ListedAllowance[]> => {
  const response = await handler({ type: "wallet.allowances" }, extensionSender);
  return "allowances" in response ? (response.allowances as readonly ListedAllowance[]) : [];
};

const recordIncrease = (
  allowanceStore: ReturnType<typeof memoryAllowanceStore>,
  token: string,
  amount = "0x1",
) =>
  recordApproveAllowances(
    allowanceStore,
    [
      {
        calldata: [SPENDER, amount, "0x0"],
        contractAddress: token,
        entrypoint: "increase_allowance",
      },
    ],
    allowanceOwner(account),
  );

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

    const revoke = await handler({ id, type: "wallet.revokeAllowance" }, extensionSender);
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

  const makeNftHarness = async () => {
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
        async submitInvokeTransaction(input) {
          invokeCalls.push(input.calls);
          return { calls: input.calls, transactionHash: "0x7cd" };
        },
      }),
      session,
    });
    return { allowanceStore, handler, invokeCalls };
  };

  test("a collection approval is never listed as a token allowance", async () => {
    const { allowanceStore, handler } = await makeNftHarness();
    await recordApproveAllowances(
      allowanceStore,
      [{ calldata: [SPENDER, "0x7", "0x0"], contractAddress: COLLECTION, entrypoint: "approve" }],
      allowanceOwner(account),
    );

    expect(await listed(handler)).toEqual([]);
  });

  test("revoking a collection row is refused instead of broadcasting an approval", async () => {
    const { allowanceStore, handler, invokeCalls } = await makeNftHarness();
    await recordApproveAllowances(
      allowanceStore,
      [{ calldata: [SPENDER, "0x7", "0x0"], contractAddress: COLLECTION, entrypoint: "approve" }],
      allowanceOwner(account),
    );
    const id = (await allowanceStore.list())[0]?.id ?? "";

    await expect(handler({ id, type: "wallet.revokeAllowance" }, extensionSender)).resolves.toEqual(
      {
        error: "this contract is an NFT collection, not a token; revoke it from the dapp",
      },
    );
    expect(invokeCalls).toEqual([]);
  });
});
