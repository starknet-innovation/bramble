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
