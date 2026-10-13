/**
 * MCW-V09-109: the recipient risk policy must not depend on which send product
 * line the user picked, and it must be ONE function rather than one per line.
 *
 * Before this fix only the NFT send refused an address-poisoning recipient. The
 * public ERC20 send — the highest-value route — ran `verifyCalls` only AFTER
 * `submitErc20Transfer` had already broadcast, purely to build the activity
 * summary; the swap execute path discarded its report entirely; the dapp invoke
 * only annotated the prompt; and the three privacy-pool routes ran no recipient
 * check at all.
 *
 * These pin the shared `refuseOnPoisonedRecipient` at each enforcement point, in
 * the background, where the message is untrusted — a panel-side gate could only
 * ever be advisory. The clean-recipient counterparts are load-bearing too: a
 * check that refused everything would also pass a "does it refuse" test.
 *
 * The lines covered here are the public ERC20 send, the NFT send, the dapp
 * invoke, the wallet's three privacy-pool routes, and the shared policy itself.
 * The dapp invoke is checked at BOTH of its enforcement points, request time and
 * approve time, because the address book can gain the mimicked contact while the
 * prompt is on screen — the card's flags are frozen at queue time, so the
 * approve-time gate is the only thing standing between that and a broadcast.
 * The two remaining send lines have their own suites, split out only to keep
 * every file under the size limit — a claim of full coverage is only true with
 * all three: the multisig line in ./multisig-recipient-poisoning-parity.test.ts,
 * and the dapp-facing STRK20 privacy routes in
 * ./strk20-dapp-recipient-poisoning-parity.test.ts. The swap execute path is
 * gated at the background's transactions/swap-ops.ts but is unreachable through the real
 * handler because `buildPolicy` already refuses any aggregator build containing
 * a decoded transfer; its gate is a second line of defence and the shared policy
 * under it is unit-tested below.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Service, Strk20SubmissionPlan } from "@bramble/privacy/service";
import { createPreferencesStore, type WalletPreferences } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { Vault } from "@bramble/vault/schema";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { testExtension } from "../support/background-wallet-stub";
import { latestApprovalId, reviewedApprovalFee } from "../support/held";
import {
  CLEAN_RECIPIENT,
  POISONED_RECIPIENT,
  POISONING_CONTACT,
  poisoningAccount,
  poolPreferences,
  poolToken,
} from "../support/poisoned-recipients";
import {
  buildStrk20Handler,
  prepareStrk20Deposit,
  STRK20_CALL_AND_PROOF,
  STRK20_EXTENSION_SENDER,
  STRK20_TOKEN,
} from "../support/strk20-background";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const TOKEN_ID = `SN_MAIN:ETH:${ETH}`;

// The one shared triple, so this suite and its two siblings cannot end up
// testing three different attacks under the same name.
const CONTACT = POISONING_CONTACT;
const POISONED = POISONED_RECIPIENT;
const CLEAN = CLEAN_RECIPIENT;

const account = poisoningAccount;
const vault = { accounts: [account], activeAccountId: account.id } as unknown as Vault;
const passphrase = "correct horse battery staple";
const reviewedFee = { overallFee: "1", unit: "FRI" } as const;
const origin = "https://dapp.example";
const extensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};
const contentSender: RuntimeSender = { id: "extension-id", url: `${origin}/app` };

const walletStub = {
  async getGrantedAccounts() {
    return [account];
  },
  async grantOrigin() {
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
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      ready: true,
    };
  },
};

// One background handler over a real preferences store holding the saved
// contact, so every route below reads the same trusted set the shipped wallet
// would.
const makeHandler = async (contactSaved = true) => {
  const session = createUnlockSession();
  session.unlock(passphrase);
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  // `contactSaved: false` starts with an empty address book, so a suite can save
  // the mimicked contact WHILE a prompt is already queued — the state the
  // post-consent gate exists for.
  if (contactSaved) {
    await preferencesStore.saveAddress({ address: CONTACT, label: "Friend", networkId: "SN_MAIN" });
  }
  const submitted: string[] = [];
  const handler = createMessageHandler(walletStub as never, testExtension, {
    preferencesStore,
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
          transactionHash: "0x7ab",
        };
      },
      async submitInvokeTransaction() {
        submitted.push("invoke");
        return { calls: [], transactionHash: "0x7cd" };
      },
    } as never,
    session,
  });
  return { handler, preferencesStore, submitted };
};

describe("public ERC20 send", () => {
  test("refuses a poisoned recipient BEFORE anything is broadcast", async () => {
    const { handler, submitted } = await makeHandler();

    await expect(
      handler(
        {
          accountId: account.id,
          amount: "1.5",
          recipient: POISONED,
          speed: "standard",
          tokenId: TOKEN_ID,
          type: "wallet.transfer",
        },
        extensionSender,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(submitted).toEqual([]);
  });

  test("still submits to a recipient that resembles nothing the wallet trusts", async () => {
    const { handler, submitted } = await makeHandler();

    await expect(
      handler(
        {
          accountId: account.id,
          amount: "1.5",
          recipient: CLEAN,
          reviewedFee,
          speed: "standard",
          tokenId: TOKEN_ID,
          type: "wallet.transfer",
        },
        extensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(submitted).toEqual(["erc20"]);
  });
});

describe("NFT send", () => {
  test("refuses a poisoned recipient", async () => {
    const { handler, submitted } = await makeHandler();

    await expect(
      handler(
        {
          contract: ETH,
          networkId: "SN_MAIN",
          recipient: POISONED,
          tokenId: "7",
          type: "wallet.transferNft",
        },
        extensionSender,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(submitted).toEqual([]);
  });
});

describe("dapp invoke", () => {
  // Queued with the poisoning flag, whose card offers Deny only, instead of
  // refused on arrival: an instant refusal told the site which addresses the
  // user has saved or paid (Sherlock 140). Approving it anyway is refused at the
  // execution-time gate below, and nothing is submitted.
  test("flags a poisoned recipient and refuses it even when approved", async () => {
    const { handler, submitted } = await makeHandler();
    const held = handler(
      {
        calls: [
          { calldata: [POISONED, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
        ],
        origin,
        type: "wallet.addInvokeTransaction",
      },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    const listed = (await handler({ type: "wallet.pendingApprovals" }, extensionSender)) as {
      readonly pending: readonly { readonly flags?: readonly { readonly code: string }[] }[];
    };
    expect(listed.pending.at(-1)?.flags?.map((flag) => flag.code)).toContain("address-poisoning");
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);

    await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);

    await expect(held).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(submitted).toEqual([]);
  });

  test("answers a denied poisoned request exactly as a denied clean one (Sherlock 140)", async () => {
    const denied = async (recipient: string): Promise<unknown> => {
      const { handler } = await makeHandler();
      const held = handler(
        {
          calls: [
            { calldata: [recipient, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
          ],
          origin,
          type: "wallet.addInvokeTransaction",
        },
        contentSender,
      );
      const id = await latestApprovalId(handler, extensionSender);
      await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
      return held;
    };
    expect(await denied(POISONED)).toEqual(await denied(CLEAN));
  });

  // The request-time gate reads the address book as it stands when the site
  // asks. A contact saved while the prompt is open turns a recipient the wallet
  // had no opinion about into a lookalike, and the card's flags were frozen at
  // queue time, so the user is not even shown the warning. Only a gate at the
  // execution point catches it — the same one the STRK20 executors apply.
  test("refuses to submit an approved invoke whose recipient became a lookalike", async () => {
    const { handler, preferencesStore, submitted } = await makeHandler(false);
    const held = handler(
      {
        calls: [
          { calldata: [POISONED, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" },
        ],
        origin,
        type: "wallet.addInvokeTransaction",
      },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);

    await preferencesStore.saveAddress({ address: CONTACT, label: "Friend", networkId: "SN_MAIN" });
    await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);

    await expect(held).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(submitted).toEqual([]);
  });

  test("still submits an approved invoke the address book never turned against", async () => {
    const { handler, submitted } = await makeHandler(false);
    const held = handler(
      {
        calls: [{ calldata: [CLEAN, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
        origin,
        type: "wallet.addInvokeTransaction",
      },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);

    await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);

    await expect(held).resolves.toMatchObject({ ok: true });
    expect(submitted).toEqual(["invoke"]);
  });
});

const RELAY_PLAN: Strk20SubmissionPlan = {
  feeAction: { amount: "0x2a", recipient: CLEAN, token: STRK20_TOKEN, type: "withdraw" },
  mode: "private-relay",
};

const poolService = (): Strk20Service => ({
  async prepare() {
    return STRK20_CALL_AND_PROOF;
  },
  async prepareAccountActions(input) {
    await input.beforeProof?.();
    return {
      allowanceGrants: [],
      calls: [
        {
          calldata: [...STRK20_CALL_AND_PROOF.call.calldata],
          contractAddress: input.config?.poolAddress ?? STRK20_TOKEN,
          entrypoint: "apply_actions",
        },
      ],
      proof: STRK20_CALL_AND_PROOF.proof,
    };
  },
  async privateBalances({ tokens }) {
    return tokens.map((entry) => ({ balance: "0xde0b6b3a7640000", token: entry }));
  },
  async poolFee() {
    return "0x1";
  },
  async quoteActions() {
    return RELAY_PLAN;
  },
  async register() {
    return { transactionHash: "0x111" };
  },
  async registrationStatus() {
    return "registered" as const;
  },
  async shadowAccountCommitment() {
    return "0x1";
  },
  async submitActions() {
    return { transactionHash: "0x222" };
  },
  async submitPrepared() {
    return { transactionHash: "0x333" };
  },
});

describe("privacy pool routes", () => {
  const preferences = poolPreferences();
  const token = poolToken(preferences);
  const routes = [
    ["wallet.strk20PrepareDeposit", "shield"],
    ["wallet.strk20PrepareTransfer", "private send"],
    ["wallet.strk20PrepareWithdraw", "unshield"],
  ] as const;

  for (const [type, label] of routes) {
    test(`refuses a poisoned recipient on the ${label} route before preparing`, async () => {
      const handler = buildStrk20Handler({ preferences, strk20: poolService() });

      await expect(
        handler(
          { amount: "0.5", recipient: POISONED, tokenId: token.id, type },
          STRK20_EXTENSION_SENDER,
        ),
      ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    });

    test(`prepares the ${label} route for an untrusted-looking recipient`, async () => {
      const handler = buildStrk20Handler({ preferences, strk20: poolService() });

      // The shield answers through a tracked job, so the review is what its
      // poll settles on; the relay quotes answer on the request itself.
      await expect(
        prepareStrk20Deposit(handler, { amount: "0.5", recipient: CLEAN, tokenId: token.id, type }),
      ).resolves.toMatchObject({ ok: true, strk20Preparation: expect.anything() });
    });

    // The preparation gate alone would leave a window: the user composes a send,
    // reviews it, saves the contact it mimics, and only then confirms. The
    // execute path re-decides, like the dapp-facing invoke does after consent.
    test(`refuses to execute a prepared ${label} whose recipient became a lookalike`, async () => {
      let current: WalletPreferences = { ...preferences, addressBook: [] };
      const handler = buildStrk20Handler({
        preferencesRead: () => current,
        strk20: poolService(),
      });
      const prepared = (await prepareStrk20Deposit(handler, {
        amount: "0.5",
        recipient: POISONED,
        tokenId: token.id,
        type,
      })) as { readonly strk20Preparation?: { readonly id: string } };
      const preparationId = prepared.strk20Preparation?.id;
      if (!preparationId) {
        throw new Error(`${label} route did not prepare against an empty address book`);
      }
      current = preferences;

      await expect(
        handler({ preparationId, type: "wallet.strk20Execute" }, STRK20_EXTENSION_SENDER),
      ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    });
  }
});

describe("shared policy", () => {
  const probe = (
    recipient: string,
    preferences: Pick<WalletPreferences, "addressBook" | "tokens">,
  ) =>
    verifyCalls(
      [{ calldata: [recipient, "0x0", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
      verificationContext(account, preferences),
    );

  const mainnetContact = {
    addressBook: [
      {
        address: CONTACT,
        id: `SN_MAIN:${CONTACT}`,
        label: "Friend",
        networkId: "SN_MAIN" as const,
      },
    ],
    tokens: [],
  };

  test("refuses with the verifier's own wording and passes a clean recipient", () => {
    expect(refuseOnPoisonedRecipient(probe(POISONED, mainnetContact))?.error).toBe(
      probe(POISONED, mainnetContact).flags.find((flag) => flag.code === "address-poisoning")
        ?.message,
    );
    expect(refuseOnPoisonedRecipient(probe(CLEAN, mainnetContact))).toBeNull();
  });

  // The trusted set is scoped to the sending account's network by the one shared
  // helper, so a contact saved on another network can neither make a recipient
  // read as trusted nor make one read as poisoned.
  test("scopes the trusted set to the sending account's network", () => {
    const foreign = {
      addressBook: mainnetContact.addressBook.map((entry) => ({
        ...entry,
        networkId: "SN_SEPOLIA" as const,
      })),
      tokens: [],
    };
    expect(refuseOnPoisonedRecipient(probe(POISONED, foreign))).toBeNull();
  });

  // Only poisoning refuses: a shield or consolidation to your own account is an
  // ordinary self-transfer and must stay possible.
  test("does not refuse a self-transfer", () => {
    expect(canonicalFelt(account.address)).not.toBeNull();
    expect(refuseOnPoisonedRecipient(probe(account.address, mainnetContact))).toBeNull();
  });
});
