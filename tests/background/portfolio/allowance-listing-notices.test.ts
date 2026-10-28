/**
 * What the allowance manager may claim about a listing, through the real
 * message handler, allowance store and multisig membership read.
 *
 * - Sherlock 190: one watched multisig that cannot be read (not deployed yet)
 *   used to fail `wallet.allowances`, which the panel showed as "No outstanding
 *   allowances". The account's own approvals are listed and the listing says a
 *   multisig was not read.
 * - Sherlock 181: a scan that stopped before the end of a token's approvals is
 *   reported as incomplete rather than as "none found".
 * - Sherlock 183: a scope at its retention cap says smaller approvals may be
 *   missing.
 * - Sherlock 192: a submitted revoke keeps the row until a chain reading says
 *   the allowance is zero; a revoke that reverted leaves the live grant listed.
 */
import { describe, expect, test } from "bun:test";
import { memoryMultisigStore } from "@bramble/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@bramble/starknet/account-contracts";
import type { ExternalAllowanceScanResult } from "@bramble/transactions/allowance-scan";
import { ALLOWANCE_LIMITS, memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import type { Vault } from "@bramble/vault/schema";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { testExtension } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const TOKEN = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPENDER = "0x05abcdef";
const UNLIMITED = ((1n << 128n) - 1n).toString();
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
const UNDEPLOYED = "0x497bd11e000000000000000000000000000000000000000000000000000abea";
const MEMBER = "0x5aa0000000000000000000000000000000000000000000000000000000000b1";
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const sender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const walletStub = {
  async readVault() {
    return vault;
  },
} as never;

const canonical = (value: string): string => `0x${BigInt(value).toString(16)}`;
const pairId = (owner: string, spender = SPENDER): string =>
  `${owner}:${canonical(TOKEN)}:${canonical(spender)}`;

type Listing = {
  readonly allowances: readonly { readonly amount: string; readonly id: string }[];
  readonly notices?: readonly string[];
  readonly ok: true;
};

const harness = (
  options: {
    readonly failingMultisigStore?: boolean;
    readonly readings?: Readonly<Record<string, string>>;
    readonly scan?: () => Promise<ExternalAllowanceScanResult>;
  } = {},
) => {
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  const allowanceStore = memoryAllowanceStore();
  const multisigStore = memoryMultisigStore();
  const handler = createMessageHandler(walletStub, testExtension, {
    allowanceStore,
    multisigStore: options.failingMultisigStore
      ? {
          ...multisigStore,
          listMultisigs: () => Promise.reject(new Error("storage unavailable")),
        }
      : multisigStore,
    runtimeRpc: makeRuntimeRpc({
      ...(options.scan ? { getExternalAllowances: options.scan } : {}),
      async getTrackedAllowances(input) {
        return input.pairs.flatMap((pair) => {
          const amount = options.readings?.[pair.id];
          return amount === undefined ? [] : [{ amount, id: pair.id }];
        });
      },
      multisig: {
        // What a node answers for an undeployed contract, and a deployed
        // multisig that lists the active account as a signer.
        async getConfig({ address }: { readonly address: string }) {
          if (BigInt(address) === BigInt(UNDEPLOYED)) {
            throw new Error(`RPC: starknet_getClassHashAt ${address}\n\n 20: Contract not found`);
          }
          return { signerGuids: [argentSignerGuid(account.publicKeyX)] };
        },
      } as never,
    }),
    session,
  });
  const list = async (): Promise<Listing> =>
    (await handler({ type: "wallet.allowances" }, sender)) as Listing;
  return { allowanceStore, handler, list, multisigStore };
};

const watch = async (store: ReturnType<typeof memoryMultisigStore>, address: string) =>
  store.upsertMultisig({
    accountContractType: "argent-multisig",
    address,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
  } as never);

const grant = (accountId: string, amount = UNLIMITED, spender = SPENDER) => ({
  accountId,
  amount,
  networkId: "SN_MAIN" as const,
  spender,
  token: TOKEN,
});

describe("Sherlock 190: an unreadable multisig", () => {
  test("still lists the account's own approvals, and the readable multisig's", async () => {
    const { allowanceStore, list, multisigStore } = harness();
    await watch(multisigStore, UNDEPLOYED);
    await watch(multisigStore, MEMBER);
    await allowanceStore.record(grant(account.id));
    await allowanceStore.record(grant(`SN_MAIN:${MEMBER}`, "77"));

    const listing = await list();

    expect(listing.allowances.map((entry) => entry.id).sort()).toEqual(
      [pairId(account.id), pairId(`SN_MAIN:${MEMBER}`)].sort(),
    );
    expect(listing.notices).toEqual(["multisig-unread"]);
  });

  test("still lists the account's own approvals when the multisig store fails", async () => {
    const { allowanceStore, list } = harness({ failingMultisigStore: true });
    await allowanceStore.record(grant(account.id));

    const listing = await list();

    expect(listing.allowances.map((entry) => entry.id)).toEqual([pairId(account.id)]);
    expect(listing.notices).toEqual(["multisig-unread"]);
  });

  test("carries no notices when everything was read", async () => {
    const { allowanceStore, list } = harness();
    await allowanceStore.record(grant(account.id));
    expect(await list()).toEqual({
      allowances: [expect.objectContaining({ id: pairId(account.id) })],
      ok: true,
    });
  });
});

describe("Sherlock 181: a scan that stopped early", () => {
  test("is reported as incomplete", async () => {
    const { list } = harness({ scan: async () => ({ allowances: [], complete: false }) });
    expect((await list()).notices).toEqual(["scan-incomplete"]);
  });

  test("a scan that failed is reported as incomplete too", async () => {
    const { list } = harness({ scan: () => Promise.reject(new Error("every endpoint failed")) });
    expect((await list()).notices).toEqual(["scan-incomplete"]);
  });
});

describe("Sherlock 183: a scope at its retention cap", () => {
  test("says smaller approvals may be missing", async () => {
    const { allowanceStore, list } = harness();
    for (let index = 0; index < ALLOWANCE_LIMITS.entriesPerScope; index += 1) {
      await allowanceStore.record(grant(account.id, "5", `0x${(index + 0x100).toString(16)}`));
    }
    expect((await list()).notices).toEqual(["retention-full"]);
  });
});

describe("Sherlock 183: a full log", () => {
  test("says approvals may be missing even when this account's scope is not full", async () => {
    const { allowanceStore, list } = harness();
    const others = ALLOWANCE_LIMITS.entriesTotal / ALLOWANCE_LIMITS.entriesPerScope;
    for (let owner = 0; owner < others; owner += 1) {
      const accountId = `SN_MAIN:0x${(0xa000 + owner).toString(16)}`;
      for (let index = 0; index < ALLOWANCE_LIMITS.entriesPerScope; index += 1) {
        await allowanceStore.record(grant(accountId, "5", `0x${(index + 0x100).toString(16)}`));
      }
    }
    await allowanceStore.record(grant(account.id));

    expect((await list()).notices).toEqual(["retention-full"]);
  });
});

describe("Sherlock 192: a submitted revoke", () => {
  test("keeps the row until the chain reads zero, then drops it from the log", async () => {
    const { allowanceStore, list } = harness({ readings: { [pairId(account.id)]: "0" } });
    await allowanceStore.record(grant(account.id));
    await allowanceStore.record(grant(account.id, "0"));

    expect((await list()).allowances).toEqual([]);
    expect(await allowanceStore.list()).toEqual([]);
  });

  test("that reverted leaves the live grant listed at the amount the chain reads", async () => {
    const { allowanceStore, list } = harness({ readings: { [pairId(account.id)]: UNLIMITED } });
    await allowanceStore.record(grant(account.id));
    await allowanceStore.record(grant(account.id, "0"));

    expect((await list()).allowances).toMatchObject([
      { amount: UNLIMITED, id: pairId(account.id) },
    ]);
    // Still held at its full amount, so it ranks as the unlimited grant it is.
    expect(await allowanceStore.list()).toMatchObject([{ amount: UNLIMITED }]);
  });

  test("with no reading stays listed at the grant's amount, marked as revoking", async () => {
    const { allowanceStore, list } = harness();
    await allowanceStore.record(grant(account.id));
    await allowanceStore.record(grant(account.id, "0"));

    expect((await list()).allowances).toMatchObject([
      { amount: UNLIMITED, id: pairId(account.id), revoking: true },
    ]);
  });

  test("not yet mined is listed at the amount the chain still reads, and kept", async () => {
    const { allowanceStore, list } = harness({ readings: { [pairId(account.id)]: "123" } });
    await allowanceStore.record(grant(account.id));
    await allowanceStore.record(grant(account.id, "0"));

    // The chain reading is the truth for a pending revoke, even when smaller.
    expect((await list()).allowances).toMatchObject([
      { amount: "123", id: pairId(account.id), revoking: true },
    ]);
    // A non-zero reading never rewrites the record: it cannot tell "not mined
    // yet" from "reverted", and the record must still settle on a later zero.
    expect(await allowanceStore.list()).toMatchObject([{ amount: UNLIMITED, revoking: true }]);
  });
});
