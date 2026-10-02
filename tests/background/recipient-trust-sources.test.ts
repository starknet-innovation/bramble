/**
 * Audits #163 and #242 at the background enforcement points.
 *
 * #163: the poisoning refusal must also protect recipients the user has paid
 * from this wallet (an unsaved exchange deposit address is the typical victim)
 * and the user's other accounts, and it must never trust a chain-discovered
 * row, which a third party can plant with a zero-value `transfer_from`.
 *
 * #242: contacts are stored and rendered zero-padded, so a twin that matches
 * only the padded `0x0` + three-digit window must refuse as well.
 *
 * Every send line is wired through the one background helper; the suites below
 * cover the public send, the dapp invoke (shared origin resolver), the STRK20
 * pool route (shared privacy context), and multisig review.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore, type WalletPreferences } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { type ActivityEntry, memoryActivityLog } from "@bramble/transactions/activity";
import type { Vault } from "@bramble/vault/schema";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { createApprovalContext } from "../../apps/extension/src/background/approvals/approval-context";
import { reviewArgentMultisigCalls } from "../../apps/extension/src/background/multisig/multisig-call-review";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { paidCounterparty } from "../../apps/extension/src/background/transactions/activity-recording";
import {
  createSwapPreparationStore,
  type SwapPreparationStore,
  swapPreparationPayload,
} from "../../apps/extension/src/background/transactions/swap-preparations";
import { testExtension } from "../support/background-wallet-stub";
import {
  POISONING_CONTACT,
  poisoningAccount,
  poolPreferences,
  poolToken,
} from "../support/poisoned-recipients";
import { buildStrk20Handler, STRK20_EXTENSION_SENDER } from "../support/strk20-background";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const TOKEN_ID = `SN_MAIN:ETH:${ETH}`;
const account = poisoningAccount;
const passphrase = "correct horse battery staple";
const origin = "https://dapp.example";
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };

// An unsaved recipient the user pays (an exchange deposit address), and a
// different account sharing its visible `0x` + four + last-four window.
const PAID = "0x049d3aa7890abcdef1234567890abcdef1234567890abcdef1234567890a9f1e";
const PAID_TWIN = "0x049d3ff111111111111111111111111111111111111111111111111111119f1e";
// The user's second account and a twin of it.
const SECOND = {
  ...account,
  address: "0x07aa11111111111111111111111111111111111111111111111111111111c0de",
  id: "SN_MAIN:0x07aa11111111111111111111111111111111111111111111111111111111c0de",
};
const SECOND_TWIN = "0x07aa12222222222222222222222222222222222222222222222222222222c0de";
// A twin of the saved contact that matches only the padded window (#242).
const PADDED_TWIN = `0x0555f${"0".repeat(55)}bbcc`;

const chainRow = (counterparty: string): ActivityEntry => ({
  accountId: account.id,
  amount: "0",
  counterparty,
  hash: "0xbad",
  kind: "transfer",
  networkId: "SN_MAIN",
  status: "accepted",
  submittedAt: 1,
  summary: "Sent 0 ETH to 0x049d…9f1e",
  token: "ETH",
});

const makeHandler = async (
  options: {
    readonly seed?: readonly ActivityEntry[];
    readonly swapPreparations?: SwapPreparationStore;
  } = {},
) => {
  const session = createUnlockSession();
  session.unlock(passphrase);
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.saveAddress({
    address: POISONING_CONTACT,
    label: "Friend",
    networkId: "SN_MAIN",
  });
  const activity = memoryActivityLog(() => 10);
  if (options.seed?.length) {
    await activity.replaceScope?.(options.seed, { accountId: account.id, networkId: "SN_MAIN" });
  }
  const vault = { accounts: [account, SECOND], activeAccountId: account.id } as unknown as Vault;
  const submitted: string[] = [];
  const wallet = {
    async getGrantedAccounts() {
      return [account];
    },
    async readVault() {
      return vault;
    },
    async signHash() {
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
  const handler = createMessageHandler(wallet as never, testExtension, {
    activity,
    preferencesStore,
    ...(options.swapPreparations ? { swapPreparations: options.swapPreparations } : {}),
    runtimeRpc: {
      async estimateInvokeFee() {
        return { overallFee: "1", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return true;
      },
      async getNftOwnership() {
        return { balance: "1", standard: "ERC721" as const };
      },
      async getTokenBalances() {
        return [];
      },
      async submitErc20Transfer() {
        submitted.push("erc20");
        return {
          call: { calldata: [], contractAddress: ETH, entrypoint: "transfer" },
          transactionHash: `0x7a${submitted.length}`,
        };
      },
      async submitInvokeTransaction() {
        submitted.push("invoke");
        return { calls: [], transactionHash: "0x7cd" };
      },
    } as never,
    session,
  });
  const send = (recipient: string) =>
    handler(
      {
        accountId: account.id,
        amount: "1",
        recipient,
        reviewedFee: { overallFee: "1", unit: "FRI" },
        speed: "standard",
        tokenId: TOKEN_ID,
        type: "wallet.transfer",
      },
      extensionSender,
    );
  const reviewFlags = async (recipient: string) => {
    const response = (await handler(
      {
        accountId: account.id,
        amount: "1",
        recipient,
        speed: "standard",
        tokenId: TOKEN_ID,
        type: "wallet.reviewTransfer",
      },
      extensionSender,
    )) as { readonly review?: { readonly flags: readonly { readonly code: string }[] } };
    return (response.review?.flags ?? []).map((flag) => flag.code);
  };
  return { activity, handler, reviewFlags, send, submitted };
};

describe("public send: recipients the wallet paid (#163)", () => {
  test("a lookalike of a recipient paid from this wallet is refused", async () => {
    const harness = await makeHandler();
    expect(await harness.reviewFlags(PAID_TWIN)).not.toContain("address-poisoning");

    await expect(harness.send(PAID)).resolves.toMatchObject({ ok: true });
    const [recorded] = await harness.activity.list();
    expect(recorded?.origin).toBe("wallet");

    expect(await harness.reviewFlags(PAID_TWIN)).toContain("address-poisoning");
    await expect(harness.send(PAID_TWIN)).resolves.toEqual({
      error: expect.stringContaining("an address you saved or paid"),
    });
    expect(harness.submitted).toEqual(["erc20"]);
  });

  test("paying the same recipient again is not refused", async () => {
    const harness = await makeHandler();
    await harness.send(PAID);
    await expect(harness.send(PAID)).resolves.toMatchObject({ ok: true });
  });

  test("a planted chain-discovered row never makes its lookalike trusted", async () => {
    // A third party's transfer_from(account, PAID_TWIN, 0) persisted from history.
    const harness = await makeHandler({ seed: [chainRow(PAID_TWIN)] });
    expect(await harness.reviewFlags(PAID)).not.toContain("address-poisoning");
    await expect(harness.send(PAID)).resolves.toMatchObject({ ok: true });
  });

  test("a recipient paid through the NFT send is trusted too", async () => {
    const harness = await makeHandler();
    await expect(
      harness.handler(
        {
          contract: ETH,
          networkId: "SN_MAIN",
          recipient: PAID,
          reviewedFee: { overallFee: "1", unit: "FRI" },
          tokenId: "7",
          type: "wallet.transferNft",
        },
        extensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    const [recorded] = await harness.activity.list();
    expect(recorded).toMatchObject({ counterparty: PAID, kind: "invoke", origin: "wallet" });

    await expect(harness.send(PAID_TWIN)).resolves.toEqual({
      error: expect.stringContaining("an address you saved or paid"),
    });
    expect(harness.submitted).toEqual(["invoke"]);
  });

  test("a legacy row without provenance contributes nothing", async () => {
    const harness = await makeHandler({ seed: [chainRow(PAID)] });
    expect(await harness.reviewFlags(PAID_TWIN)).not.toContain("address-poisoning");
  });
});

describe("public send: the user's other accounts and padded contacts", () => {
  test("a lookalike of another vault account is refused (#163)", async () => {
    const harness = await makeHandler();
    await expect(harness.send(SECOND_TWIN)).resolves.toEqual({
      error: expect.stringContaining("closely mimics"),
    });
    await expect(harness.send(SECOND.address)).resolves.toMatchObject({ ok: true });
  });

  test("a twin matching only the padded contact window is flagged and refused (#242)", async () => {
    const harness = await makeHandler();
    expect(await harness.reviewFlags(PADDED_TWIN)).toContain("address-poisoning");
    await expect(harness.send(PADDED_TWIN)).resolves.toEqual({
      error: expect.stringContaining("closely mimics"),
    });
    expect(harness.submitted).toEqual([]);
  });
});

describe("NFT send and swap execute use the same trusted set (#163)", () => {
  test("an NFT send to a lookalike of a paid recipient is refused", async () => {
    const harness = await makeHandler();
    await harness.send(PAID);
    await expect(
      harness.handler(
        {
          contract: ETH,
          networkId: "SN_MAIN",
          recipient: PAID_TWIN,
          reviewedFee: { overallFee: "1", unit: "FRI" },
          tokenId: "7",
          type: "wallet.transferNft",
        },
        extensionSender,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(harness.submitted).toEqual(["erc20"]);
  });

  test("a frozen swap route paying a lookalike of a paid recipient is refused at execute", async () => {
    // buildPolicy refuses any aggregator build carrying a transfer, so the
    // execute gate is reached here by freezing such a route directly: it is
    // the second line of defence and must judge against the full trusted set.
    const swapPreparations = createSwapPreparationStore();
    const harness = await makeHandler({ swapPreparations });
    await harness.send(PAID);
    const unsigned = {
      amount: "1",
      buyAmount: "1",
      buySymbol: "STRK",
      calls: [
        { calldata: [PAID_TWIN, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
      ],
      flags: [],
      minBuyAmount: "1",
      reviewedFee: { overallFee: "1", unit: "FRI" as const },
      sellSymbol: "ETH",
      summaries: ["Swap"],
    };
    const context = await createApprovalContext(account, swapPreparationPayload(unsigned));
    const { id } = swapPreparations.put({ ...unsigned, context, id: context.payloadDigest });
    await expect(
      harness.handler({ preparationId: id, type: "wallet.swapExecute" }, extensionSender),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(harness.submitted).toEqual(["erc20"]);
  });
});

describe("dapp invoke uses the same trusted set (#163)", () => {
  test("a dapp transfer to a lookalike of a paid recipient is refused before queueing", async () => {
    const harness = await makeHandler();
    await harness.send(PAID);
    const response = harness.handler(
      {
        calls: [
          { calldata: [PAID_TWIN, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
        ],
        origin,
        type: "wallet.addInvokeTransaction",
      },
      contentSender,
    );
    // A request that is not refused is held for the user's approval and never
    // settles on its own; report that as "queued" instead of hanging the suite.
    const outcome = await Promise.race([
      response,
      new Promise((resolve) => setTimeout(() => resolve("queued"), 500)),
    ]);
    expect(outcome).toEqual({ error: expect.stringContaining("closely mimics") });
    await expect(
      harness.handler({ type: "wallet.pendingApprovals" }, extensionSender),
    ).resolves.toMatchObject({ pending: [] });
    expect(harness.submitted).toEqual(["erc20"]);
  });
});

describe("STRK20 pool route uses the same trusted set (#163)", () => {
  test("a private send to a lookalike of a paid recipient is refused", async () => {
    const preferences: WalletPreferences = { ...poolPreferences(), addressBook: [] };
    const token = poolToken(preferences);
    const activity = memoryActivityLog(() => 10);
    await activity.record({
      accountId: "SN_SEPOLIA:0xabcabcdef",
      counterparty: PAID,
      hash: "0x77",
      kind: "transfer",
      networkId: "SN_SEPOLIA",
      origin: "wallet",
      summary: "Sent 1 STRK",
    });
    const handler = buildStrk20Handler({ activity, preferences });
    await expect(
      handler(
        {
          amount: "0.5",
          recipient: PAID_TWIN,
          tokenId: token.id,
          type: "wallet.strk20PrepareTransfer",
        },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
  });
});

describe("multisig review uses the same trusted set (#163)", () => {
  test("a frozen multisig call paying a lookalike of a paid recipient is refused", async () => {
    const activity = memoryActivityLog(() => 10);
    await activity.record({
      accountId: account.id,
      counterparty: PAID,
      hash: "0x77",
      kind: "transfer",
      networkId: "SN_MAIN",
      origin: "wallet",
      summary: "Sent 1 ETH",
    });
    const session = createUnlockSession();
    session.unlock(passphrase);
    const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
    const record = {
      address: "0x0123450000000000000000000000000000000000000000000000000000006789",
      id: "SN_MAIN:0x0123450000000000000000000000000000000000000000000000000000006789",
      networkId: "SN_MAIN",
    };
    const review = (recipient: string) =>
      reviewArgentMultisigCalls(
        {
          activity,
          preferencesStore,
          session,
          wallet: {
            async readVault() {
              return { accounts: [account] };
            },
          },
        } as never,
        { record } as never,
        // Frozen multisig calls are stored in canonical (unpadded) felt form.
        [
          {
            calldata: [canonicalFelt(recipient) ?? recipient, "0x1", "0x0"],
            contractAddress: canonicalFelt(ETH) ?? ETH,
            entrypoint: "transfer",
          },
        ],
        null,
      );
    await expect(review(PAID_TWIN)).resolves.toEqual({
      error: expect.stringContaining("closely mimics"),
    });
    await expect(review(PAID)).resolves.toMatchObject({ summary: expect.any(String) });
  });
});

describe("paidCounterparty", () => {
  const transfer = (recipient: string) => ({
    calldata: [recipient, "0x1", "0x0"],
    contractAddress: ETH,
    entrypoint: "transfer",
  });

  test("names the payee of a single known-recipient call, canonicalized", () => {
    expect(paidCounterparty([transfer(PAID)])).toEqual({ counterparty: canonicalFelt(PAID) ?? "" });
  });

  test("records nothing for a multicall, an unknown selector, or a zero recipient", () => {
    expect(paidCounterparty([transfer(PAID), transfer(SECOND.address)])).toEqual({});
    expect(paidCounterparty([{ ...transfer(PAID), entrypoint: "mint" }])).toEqual({});
    expect(paidCounterparty([transfer("0x0")])).toEqual({});
    expect(paidCounterparty([])).toEqual({});
  });
});
