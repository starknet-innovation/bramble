/**
 * Extension-owned STRK20 journeys keep discovery opt-in and commit
 * registration/deposit details before their one-time submission.
 */
import { describe, expect, test } from "bun:test";
import { readStrk20WalletExecuteInput } from "../../src/background/strk20-wallet-inputs";
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
      subaccountAnonymizerAddress: "0x456",
    },
  },
});

const token = preferences().tokens.find(
  (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
);
if (!token) {
  throw new Error("Sepolia token fixture missing");
}

const service = (capture: {
  readonly registered: { value: boolean };
  readonly registrations: { value: number };
  readonly submissions: {
    actions: readonly Strk20Action[];
    plan: Strk20SubmissionPlan;
  }[];
}): Strk20Service => {
  const { registered, registrations, submissions } = capture;
  return {
    async prepare() {
      return STRK20_CALL_AND_PROOF;
    },
    async privateBalances({ tokens }) {
      return tokens.map((entry) => ({ balance: "0xde0b6b3a7640000", token: entry }));
    },
    async quoteActions() {
      return { mode: "account" };
    },
    async register() {
      registrations.value += 1;
      registered.value = true;
      return { transactionHash: "0x111" };
    },
    async registrationStatus() {
      return registered.value ? "registered" : "unregistered";
    },
    async subaccountCommitment() {
      return STRK20_RECIPIENT;
    },
    async submitActions({ actions, plan }) {
      submissions.push({ actions, plan });
      return { transactionHash: "0x222" };
    },
    async submitPrepared() {
      return { transactionHash: "0x333" };
    },
  };
};

describe("background wallet STRK20 operations", () => {
  test("keeps private discovery privileged and returns account-scoped registration state", async () => {
    const capture = {
      registered: { value: true },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: service(capture),
    });

    await expect(handler({ type: "wallet.strk20State" }, STRK20_CONTENT_SENDER)).resolves.toEqual({
      error: "privileged sender required",
    });
    const response = (await handler({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)) as {
      readonly strk20State: {
        readonly balances: readonly {
          readonly balance: string;
          readonly formatted: string;
          readonly symbol: string;
          readonly token: string;
          readonly tokenId: string;
        }[];
        readonly networkId: string;
        readonly registration: string;
      };
    };
    expect(response.strk20State.networkId).toBe("SN_SEPOLIA");
    expect(response.strk20State.registration).toBe("registered");
    expect(response.strk20State.balances.find((entry) => entry.tokenId === token.id)).toEqual({
      balance: "0xde0b6b3a7640000",
      formatted: "1",
      symbol: "ETH",
      token: STRK20_TOKEN,
      tokenId: token.id,
    });
  });

  test("prepares public registration and atomically consumes it before submission", async () => {
    const capture = {
      registered: { value: false },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: service(capture),
    });
    const prepared = (await handler(
      { type: "wallet.strk20PrepareRegistration" },
      STRK20_EXTENSION_SENDER,
    )) as {
      readonly strk20Preparation: { readonly id: string; readonly summaries: readonly string[] };
    };

    expect(prepared.strk20Preparation.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      prepared.strk20Preparation.summaries.some((summary) =>
        summary.includes("Registration is public"),
      ),
    ).toBe(true);
    const execute = {
      preparationId: prepared.strk20Preparation.id,
      type: "wallet.strk20Execute",
    };
    expect(readStrk20WalletExecuteInput(execute)).toEqual({
      preparationId: prepared.strk20Preparation.id,
    });
    await expect(handler(execute, STRK20_EXTENSION_SENDER)).resolves.toEqual({
      ok: true,
      transactionHash: "0x111",
    });
    expect(capture.registrations.value).toBe(1);
    await expect(handler(execute, STRK20_EXTENSION_SENDER)).resolves.toEqual({
      error: "Privacy preparation not found",
    });
    expect(capture.registrations.value).toBe(1);
  });

  test("prepares and submits an exact public-to-private deposit only after registration", async () => {
    const capture = {
      registered: { value: true },
      registrations: { value: 0 },
      submissions: [] as {
        actions: readonly Strk20Action[];
        plan: Strk20SubmissionPlan;
      }[],
    };
    const handler = buildStrk20Handler({
      preferences: preferences(),
      publicBalance: "2000000000000000000",
      strk20: service(capture),
    });
    const prepared = (await handler(
      {
        amount: "1.5",
        tokenId: token.id,
        type: "wallet.strk20PrepareDeposit",
      },
      STRK20_EXTENSION_SENDER,
    )) as {
      readonly strk20Preparation: {
        readonly amount: string;
        readonly id: string;
        readonly route: string;
      };
    };

    expect(prepared.strk20Preparation.amount).toBe("1.5");
    expect(prepared.strk20Preparation.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(prepared.strk20Preparation.route).toBe("public-account");
    await expect(
      handler(
        {
          preparationId: prepared.strk20Preparation.id,
          type: "wallet.strk20Execute",
        },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ ok: true, transactionHash: "0x222" });
    expect(capture.submissions).toEqual([
      {
        actions: [
          {
            amount: "0x14d1120d7b160000",
            token: STRK20_TOKEN,
            type: "deposit",
          },
        ],
        plan: { mode: "account" },
      },
    ]);
  });

  test("blocks shielding before registration and rejects malformed requests", async () => {
    const capture = {
      registered: { value: false },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      preferences: preferences(),
      publicBalance: "2000000000000000000",
      strk20: service(capture),
    });

    await expect(
      handler(
        { amount: "1", tokenId: token.id, type: "wallet.strk20PrepareDeposit" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Activate private balances before shielding an asset" });
    await expect(
      handler(
        { amount: 1, tokenId: token.id, type: "wallet.strk20PrepareDeposit" },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Invalid shield request" });
    await expect(
      handler({ preparationId: "bad", type: "wallet.strk20Execute" }, STRK20_EXTENSION_SENDER),
    ).resolves.toEqual({ error: "Invalid privacy execution request" });
  });
});
