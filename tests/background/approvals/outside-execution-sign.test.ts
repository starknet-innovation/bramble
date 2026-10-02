/**
 * OutsideExecution sign-route defences (audit 144): a SNIP-9 signature
 * authorizes calls the site can submit later with no second prompt, so the sign
 * route applies the invoke route's self-call and poisoned-recipient refusals at
 * queue time and again before signing, and carries the risk flags and decoded
 * call summaries onto the card. Plain SNIP-12 messages are unchanged.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { type AllowanceStore, memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { constants, outsideExecution } from "starknet";
import { setApprovalNotifier } from "../../../apps/extension/src/background/approvals/approval-notifier";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { chromiumExtension } from "../../support/background-wallet-stub";
import { flushHeld, waitForPendingApprovals } from "../../support/held";

const PASSPHRASE = "correct horse battery staple";
const ORIGIN = "https://dapp.example";
const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const MAX_U128 = "0xffffffffffffffffffffffffffffffff";
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
// Same leading and trailing digits as the account, different address.
const LOOKALIKE = "0x12340000000000000000000000000000000000000000000000000000000bcde";
const CONTACT = "0x56780000000000000000000000000000000000000000000000000000000abc";
const CONTACT_LOOKALIKE = "0x56781111111111111111111111111111111111111111111111111111110abc";

const content: RuntimeSender = { id: "ext", url: `${ORIGIN}/swap` };
const page: RuntimeSender = { id: "ext", url: "chrome-extension://ext/sidepanel.html" };

let signed = 0;
const wallet = {
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
    return "phrase";
  },
  async grantOrigin() {
    return [account];
  },
  async readVault() {
    return {
      accounts: [account],
      accountSecrets: [],
      activeAccountId: account.id,
      importedSeeds: [],
      mnemonic: null,
      originGrants: [{ accountIds: [account.id], origin: ORIGIN }],
      schemaVersion: 10 as const,
      signingKeys: [{ accountId: account.id, privateKey: "0x7e5" }],
    };
  },
  async setActiveAccount() {
    return account;
  },
  async signHash() {
    signed += 1;
    return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
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

type Call = {
  readonly calldata: string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

const outside = (calls: readonly Call[], version: "1" | "2" = "2"): unknown =>
  JSON.parse(
    JSON.stringify(
      outsideExecution.getTypedData(
        constants.StarknetChainId.SN_MAIN,
        { caller: "0x0", execute_after: 1, execute_before: 999_999_999_999 },
        1,
        [...calls],
        version,
      ),
    ),
  );

const setup = (allowanceStore: AllowanceStore = memoryAllowanceStore()) => {
  setApprovalNotifier(() => undefined);
  signed = 0;
  const session = createUnlockSession();
  session.unlock(PASSPHRASE);
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const handler = createMessageHandler(wallet, chromiumExtension("ext"), {
    allowanceStore,
    preferencesStore,
    session,
  });
  const sign = (typedData: unknown) =>
    handler({ origin: ORIGIN, type: "wallet.signTypedData", typedData }, content);
  // A refusal settles at once; a queued request stays held until a decision,
  // so it reads as "held" here instead of hanging the test.
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
  // The risk-flag codes on the one queued card.
  const queuedFlags = async () => {
    await flushHeld();
    const [queued] = await waitForPendingApprovals<{
      readonly flags?: readonly { readonly code: string }[];
      readonly id: string;
    }>(handler, page);
    return queued?.flags?.map((flag) => flag.code) ?? [];
  };
  return { handler, pending, preferencesStore, queuedFlags, sign, signNow };
};

// 2^127 base units: one grant stays below the unlimited threshold (2^128 - 2),
// two of them cross it.
const HALF_U128 = "0x80000000000000000000000000000000";

describe("OutsideExecution sign route (audit 144)", () => {
  for (const version of ["1", "2"] as const) {
    test(`refuses a v${version} transfer to a lookalike of the account and queues nothing`, async () => {
      const { pending, signNow } = setup();
      const response = await signNow(
        outside(
          [{ calldata: [LOOKALIKE, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
          version,
        ),
      );
      expect(response).toEqual({ error: expect.stringContaining("closely mimics") });
      expect(await pending()).toEqual([]);
    });
  }

  test("refuses a call to the account contract itself", async () => {
    const { pending, signNow } = setup();
    await expect(
      signNow(
        outside([{ calldata: ["0x1"], contractAddress: account.address, entrypoint: "upgrade" }]),
      ),
    ).resolves.toEqual({ error: "Dapps cannot call the wallet account contract itself" });
    expect(await pending()).toEqual([]);
  });

  test("refuses an OutsideExecution the reader cannot parse", async () => {
    const { pending, signNow } = setup();
    const typed = {
      domain: {
        chainId: "0x534e5f4d41494e",
        name: "Account.execute_from_outside",
        revision: "1",
        version: "2",
      },
      message: { Nonce: "0x1" },
      primaryType: "OutsideExecution",
      types: {
        OutsideExecution: [{ name: "Nonce", type: "felt" }],
        StarknetDomain: [
          { name: "name", type: "shortstring" },
          { name: "version", type: "shortstring" },
          { name: "chainId", type: "shortstring" },
          { name: "revision", type: "shortstring" },
        ],
      },
    };
    await expect(signNow(typed)).resolves.toEqual({ error: "invalid typed data" });
    expect(await pending()).toEqual([]);
  });

  test("queues an unlimited approve with its flag and decoded summary", async () => {
    const { handler, sign } = setup();
    void sign(
      outside([
        { calldata: [CONTACT, MAX_U128, MAX_U128], contractAddress: ETH, entrypoint: "approve" },
      ]),
    );
    await flushHeld();
    const [queued] = await waitForPendingApprovals<{
      readonly flags?: readonly { readonly code: string }[];
      readonly id: string;
      readonly summaries?: readonly string[];
    }>(handler, page);
    expect(queued?.flags?.map((flag) => flag.code)).toContain("unlimited-approval");
    expect(queued?.summaries).toHaveLength(2);
    expect(queued?.summaries?.[0]).toBe("OutsideExecution · Account.execute_from_outside");
    expect(queued?.summaries?.[1]).toContain("Allow");
  });

  // The selector-to-name map covers every decoded entrypoint, not only
  // transfer/approve: v1 carries raw selector hashes and decimal calldata.
  test("refuses a v1 transfer_from to a lookalike, with decimal calldata", async () => {
    const { pending, signNow } = setup();
    const typed = outside(
      [
        {
          calldata: [account.address, LOOKALIKE, "0x1", "0x0"],
          contractAddress: ETH,
          entrypoint: "transfer_from",
        },
      ],
      "1",
    ) as { readonly message: { readonly calls: { calldata: string[] }[] } };
    for (const call of typed.message.calls) {
      call.calldata = call.calldata.map((felt) => BigInt(felt).toString(10));
    }
    await expect(signNow(typed)).resolves.toEqual({
      error: expect.stringContaining("closely mimics"),
    });
    expect(await pending()).toEqual([]);
  });

  test("flags increase_allowance grants that add up to an unlimited allowance", async () => {
    const { queuedFlags, sign } = setup();
    const grant = {
      calldata: [CONTACT, HALF_U128, "0x0"],
      contractAddress: ETH,
      entrypoint: "increase_allowance",
    };
    void sign(outside([grant, grant]));
    expect(await queuedFlags()).toContain("unlimited-approval");
  });

  test("flags a small increase_allowance that tops up a standing allowance", async () => {
    // The same input the invoke route reviews against: the recorded allowance
    // log, so a top-up over an existing near-unlimited allowance is flagged.
    const allowances = memoryAllowanceStore();
    await allowances.record({
      accountId: account.id,
      amount: (2n ** 128n - 10n).toString(10),
      networkId: "SN_MAIN",
      spender: CONTACT,
      token: ETH,
    });
    const { queuedFlags, sign } = setup(allowances);
    void sign(
      outside([
        {
          calldata: [CONTACT, "0x64", "0x0"],
          contractAddress: ETH,
          entrypoint: "increase_allowance",
        },
      ]),
    );
    expect(await queuedFlags()).toContain("unlimited-approval");
  });

  test("does not flag the same small increase_allowance with no standing allowance", async () => {
    const { queuedFlags, sign } = setup();
    void sign(
      outside([
        {
          calldata: [CONTACT, "0x64", "0x0"],
          contractAddress: ETH,
          entrypoint: "increase_allowance",
        },
      ]),
    );
    expect(await queuedFlags()).not.toContain("unlimited-approval");
  });

  test("refuses at approval when a contact added meanwhile makes the payee a lookalike", async () => {
    const { handler, preferencesStore, sign } = setup();
    const held = sign(
      outside([
        {
          calldata: [CONTACT_LOOKALIKE, "0x1", "0x0"],
          contractAddress: ETH,
          entrypoint: "transfer",
        },
      ]),
    );
    await flushHeld();
    const [queued] = await waitForPendingApprovals(handler, page);
    await preferencesStore.saveAddress({ address: CONTACT, label: "Friend", networkId: "SN_MAIN" });
    await expect(handler({ id: queued?.id, type: "wallet.approveOrigin" }, page)).resolves.toEqual({
      error: expect.stringContaining("closely mimics"),
    });
    await expect(held).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(signed).toBe(0);
  });

  test("leaves plain SNIP-12 messages unchanged", async () => {
    const { handler, sign } = setup();
    void sign({
      domain: { chainId: "0x534e5f4d41494e", name: "Example", revision: "1", version: "1" },
      message: { contents: "hello" },
      primaryType: "Mail",
      types: {
        Mail: [{ name: "contents", type: "felt" }],
        StarknetDomain: [
          { name: "name", type: "felt" },
          { name: "version", type: "felt" },
          { name: "chainId", type: "felt" },
        ],
      },
    });
    await flushHeld();
    const [queued] = await waitForPendingApprovals<{
      readonly flags?: unknown;
      readonly id: string;
      readonly summaries?: readonly string[];
    }>(handler, page);
    expect(queued?.flags).toBeUndefined();
    expect(queued?.summaries).toEqual(["Mail · Example"]);
  });
});
