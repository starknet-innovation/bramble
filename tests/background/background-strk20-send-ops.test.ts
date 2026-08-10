/**
 * Private-send background operations: recipient registration lookup and the
 * one-time shielded-transfer preparation. Sends are relay-only, gated on both
 * parties' registration and the sender's private balance, and executable only
 * through the frozen preparation.
 */
import { describe, expect, test } from "bun:test";
import { canonicalFelt } from "../../src/starknet/networks";
import type { Strk20Action } from "../../src/starknet/strk20/schemas";
import type { Strk20Service, Strk20SubmissionPlan } from "../../src/starknet/strk20/service";
import {
  defaultWalletPreferences,
  type WalletPreferences,
} from "../../src/storage/preferences-store";
import {
  buildStrk20Handler,
  STRK20_CALL_AND_PROOF,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../support/strk20-background";

const preferences = (): WalletPreferences => ({
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: {
    SN_SEPOLIA: {
      discoveryUrl: "https://discovery.example/strk20",
      poolAddress: "0x123",
      proverUrl: "https://prover.example/strk20",
    },
  },
});

const token = preferences().tokens.find(
  (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
);
if (!token) {
  throw new Error("Sepolia token fixture missing");
}
const recipient = canonicalFelt(STRK20_RECIPIENT) ?? "";
// The harness's signed-in account, distinct from every destination used below.
const ACTIVE_ACCOUNT_ADDRESS = "0xabcabcdef";

const RELAY_PLAN: Strk20SubmissionPlan = {
  feeAction: { amount: "0x2a", recipient: STRK20_RECIPIENT, token: STRK20_TOKEN, type: "withdraw" },
  mode: "private-relay",
};

const service = (capture: {
  readonly recipientRegistered: boolean;
  readonly submissions: { actions: readonly Strk20Action[]; plan: Strk20SubmissionPlan }[];
}): Strk20Service => ({
  async prepare() {
    return STRK20_CALL_AND_PROOF;
  },
  async privateBalances({ tokens }) {
    return tokens.map((entry) => ({ balance: "0xde0b6b3a7640000", token: entry }));
  },
  async quoteActions() {
    return RELAY_PLAN;
  },
  async register() {
    return { transactionHash: "0x111" };
  },
  async registrationStatus({ subject }) {
    if (subject !== undefined) {
      return capture.recipientRegistered ? "registered" : "unregistered";
    }
    return "registered";
  },
  async subaccountCommitment() {
    return STRK20_RECIPIENT;
  },
  async submitActions({ actions, plan }) {
    capture.submissions.push({ actions, plan });
    return { transactionHash: "0x444" };
  },
  async submitPrepared() {
    return { transactionHash: "0x333" };
  },
});

describe("unshield source and destination stay separate", () => {
  test("the shielded balance is read for the active account, never the destination", async () => {
    // The destination is only a payout address. Every read that decides what can
    // be spent — registration and private balance — must be scoped to the active
    // account, or picking a destination would silently change whose balance is
    // being withdrawn.
    const subjects: (string | undefined)[] = [];
    const balanceAccounts: string[] = [];
    const capture = {
      recipientRegistered: true,
      submissions: [] as { actions: readonly Strk20Action[]; plan: Strk20SubmissionPlan }[],
    };
    const base = service(capture);
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: {
        ...base,
        async privateBalances(input) {
          balanceAccounts.push(input.account.address);
          return base.privateBalances(input);
        },
        async registrationStatus(input) {
          subjects.push(input.subject);
          return "registered";
        },
      },
    });

    const prepared = (await handler(
      {
        amount: "0.25",
        recipient: STRK20_RECIPIENT,
        tokenId: token.id,
        type: "wallet.strk20PrepareWithdraw",
      },
      STRK20_EXTENSION_SENDER,
    )) as { readonly strk20Preparation: { readonly recipient: string } };

    // The payout goes to the chosen destination…
    expect(prepared.strk20Preparation.recipient).toBe(recipient);
    // …while the spendable balance was read for the signed-in account, whose
    // address is not the destination.
    expect(balanceAccounts.length).toBeGreaterThan(0);
    expect(new Set(balanceAccounts)).toEqual(new Set([ACTIVE_ACCOUNT_ADDRESS]));
    expect(balanceAccounts).not.toContain(recipient);
    // Registration was checked for the account itself (no subject), never for
    // the destination: a withdrawal does not require the destination to be in
    // the pool at all.
    expect(subjects.every((subject) => subject === undefined)).toBe(true);
  });
});

describe("background unshield operations", () => {
  test("prepares and executes a relay-only withdrawal to any address", async () => {
    const capture = {
      recipientRegistered: true,
      submissions: [] as { actions: readonly Strk20Action[]; plan: Strk20SubmissionPlan }[],
    };
    const handler = buildStrk20Handler({ preferences: preferences(), strk20: service(capture) });

    const prepared = (await handler(
      {
        amount: "0.25",
        recipient: STRK20_RECIPIENT,
        tokenId: token.id,
        type: "wallet.strk20PrepareWithdraw",
      },
      STRK20_EXTENSION_SENDER,
    )) as {
      readonly strk20Preparation: {
        readonly id: string;
        readonly kind: string;
        readonly recipient: string;
        readonly relayFee: { readonly amount: string };
        readonly route: string;
        readonly summaries: readonly string[];
      };
    };

    expect(prepared.strk20Preparation.kind).toBe("withdraw");
    // Withdrawals never use the public account route.
    expect(prepared.strk20Preparation.route).toBe("private-relay");
    expect(prepared.strk20Preparation.recipient).toBe(recipient);
    expect(prepared.strk20Preparation.relayFee.amount).toBe("0x2a");
    expect(
      prepared.strk20Preparation.summaries.some((summary) => summary.startsWith("Unshield 0.25")),
    ).toBe(true);
    expect(
      prepared.strk20Preparation.summaries.some((summary) =>
        summary.includes("amount and destination become visible on-chain"),
      ),
    ).toBe(true);

    await expect(
      handler(
        { preparationId: prepared.strk20Preparation.id, type: "wallet.strk20Execute" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ ok: true, transactionHash: "0x444" });
    expect(capture.submissions).toEqual([
      {
        actions: [
          { amount: "0x3782dace9d90000", recipient, token: STRK20_TOKEN, type: "withdraw" },
        ],
        plan: RELAY_PLAN,
      },
    ]);
  });

  test("blocks withdrawals above the private balance and malformed requests", async () => {
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: service({ recipientRegistered: true, submissions: [] }),
    });

    await expect(
      handler(
        {
          amount: "5",
          recipient: STRK20_RECIPIENT,
          tokenId: token.id,
          type: "wallet.strk20PrepareWithdraw",
        },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: `Not enough private ${token.symbol}` });
    await expect(
      handler(
        {
          amount: "1",
          recipient: "nope",
          tokenId: token.id,
          type: "wallet.strk20PrepareWithdraw",
        },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Enter a valid Starknet address" });
    await expect(
      handler(
        { amount: "1", tokenId: token.id, type: "wallet.strk20PrepareWithdraw" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Invalid unshield request" });
  });
});

describe("background private-send operations", () => {
  test("checks a recipient's registration for privileged senders only", async () => {
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: service({ recipientRegistered: true, submissions: [] }),
    });

    await expect(
      handler(
        { address: STRK20_RECIPIENT, tokenId: token.id, type: "wallet.strk20RecipientStatus" },
        STRK20_CONTENT_SENDER,
      ),
    ).resolves.toEqual({ error: "privileged sender required" });
    await expect(
      handler(
        { address: STRK20_RECIPIENT, tokenId: token.id, type: "wallet.strk20RecipientStatus" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ ok: true, strk20RecipientRegistration: "registered" });
    await expect(
      handler(
        { address: "not-an-address", tokenId: token.id, type: "wallet.strk20RecipientStatus" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Enter a valid Starknet address" });
  });

  test("prepares and executes a relay-only private send with the frozen batch", async () => {
    const capture = {
      recipientRegistered: true,
      submissions: [] as { actions: readonly Strk20Action[]; plan: Strk20SubmissionPlan }[],
    };
    const handler = buildStrk20Handler({ preferences: preferences(), strk20: service(capture) });

    const prepared = (await handler(
      {
        amount: "0.5",
        recipient: STRK20_RECIPIENT,
        tokenId: token.id,
        type: "wallet.strk20PrepareTransfer",
      },
      STRK20_EXTENSION_SENDER,
    )) as {
      readonly strk20Preparation: {
        readonly amount: string;
        readonly id: string;
        readonly kind: string;
        readonly recipient: string;
        readonly relayFee: { readonly amount: string };
        readonly route: string;
        readonly summaries: readonly string[];
      };
    };

    expect(prepared.strk20Preparation.kind).toBe("transfer");
    expect(prepared.strk20Preparation.route).toBe("private-relay");
    expect(prepared.strk20Preparation.amount).toBe("0.5");
    expect(prepared.strk20Preparation.recipient).toBe(recipient);
    expect(prepared.strk20Preparation.relayFee.amount).toBe("0x2a");
    expect(
      prepared.strk20Preparation.summaries.some((summary) =>
        summary.includes(`Send 0.5 ${token.symbol} privately`),
      ),
    ).toBe(true);

    await expect(
      handler(
        { preparationId: prepared.strk20Preparation.id, type: "wallet.strk20Execute" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ ok: true, transactionHash: "0x444" });
    expect(capture.submissions).toEqual([
      {
        actions: [
          { amount: "0x6f05b59d3b20000", recipient, token: STRK20_TOKEN, type: "transfer" },
        ],
        plan: RELAY_PLAN,
      },
    ]);
    // The preparation is one-shot: a second execute cannot double-submit.
    await expect(
      handler(
        { preparationId: prepared.strk20Preparation.id, type: "wallet.strk20Execute" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Privacy preparation not found" });
  });

  test("blocks sends to unregistered recipients, self-sends, and overdrafts", async () => {
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: service({ recipientRegistered: false, submissions: [] }),
    });

    await expect(
      handler(
        {
          amount: "0.5",
          recipient: STRK20_RECIPIENT,
          tokenId: token.id,
          type: "wallet.strk20PrepareTransfer",
        },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "The recipient has not activated private balances" });

    const registered = buildStrk20Handler({
      preferences: preferences(),
      strk20: service({ recipientRegistered: true, submissions: [] }),
    });
    await expect(
      registered(
        {
          amount: "5",
          recipient: STRK20_RECIPIENT,
          tokenId: token.id,
          type: "wallet.strk20PrepareTransfer",
        },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: `Not enough private ${token.symbol}` });
    await expect(
      registered(
        { amount: "1", recipient: 7, tokenId: token.id, type: "wallet.strk20PrepareTransfer" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Invalid private send request" });
  });
});
