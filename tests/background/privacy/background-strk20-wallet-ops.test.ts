/**
 * Extension-owned STRK20 journeys keep discovery opt-in and commit
 * registration/deposit details before their one-time submission.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { strk20WaitExceeded } from "@bramble/privacy/official-sdk-budget";
import type { Strk20SubmissionPlan } from "@bramble/privacy/service";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import {
  type ActivityLog,
  type ActivityStatus,
  memoryActivityLog,
} from "@bramble/transactions/activity";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { readStrk20WalletExecuteInput } from "../../../apps/extension/src/background/privacy/strk20-wallet-inputs";
import { STRK20_REGISTRATION_SUMMARY } from "../../../apps/extension/src/background/privacy/strk20-wallet-ops";
import { account } from "../../support/background-wallet-stub";
import {
  buildStrk20Handler,
  executeStrk20Preparation,
  prepareStrk20Deposit,
  prepareStrk20Registration,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";
import { makeStrk20WalletService } from "../../support/strk20-wallet-service";

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

const SUBMITTED_AT = 1_700_000_000_000;

const activityWithRegistration = async (
  status: ActivityStatus = "pending",
): Promise<ActivityLog> => {
  const log = memoryActivityLog(() => SUBMITTED_AT);
  await log.record({
    accountId: account.id,
    hash: "0x111",
    kind: "invoke",
    networkId: "SN_SEPOLIA",
    summary: STRK20_REGISTRATION_SUMMARY,
  });
  if (status !== "pending") {
    await log.updateStatuses(
      { "0x111": { status } },
      { accountId: account.id, networkId: "SN_SEPOLIA" },
    );
  }
  return log;
};

const CANONICAL_RECIPIENT = canonicalFelt(STRK20_RECIPIENT);
if (CANONICAL_RECIPIENT === null) {
  throw new Error("recipient fixture is not a field element");
}

const token = preferences().tokens.find(
  (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
);
if (!token) {
  throw new Error("Sepolia token fixture missing");
}

describe("background wallet STRK20 operations", () => {
  test("keeps private discovery privileged and returns account-scoped registration state", async () => {
    const capture = {
      registered: { value: true },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: makeStrk20WalletService(capture),
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
        readonly poolFeeFri: string;
        readonly relayConfigured: boolean;
        readonly registration: string;
      };
    };
    expect(response.strk20State.networkId).toBe("SN_SEPOLIA");
    expect(response.strk20State.poolFeeFri).toBe("0x1");
    expect(response.strk20State.relayConfigured).toBe(false);
    expect(response.strk20State.registration).toBe("registered");
    expect(response.strk20State.balances.find((entry) => entry.tokenId === token.id)).toEqual({
      balance: "0xde0b6b3a7640000",
      formatted: "1",
      symbol: "ETH",
      token: STRK20_TOKEN,
      tokenId: token.id,
    });
  });

  test("answers the state read on the request, never through a job", async () => {
    // The disclosure is what every surface paints its Shield entry from, so it
    // must settle on the request that asked for it: a job envelope here would
    // fail the panel's reader and leave the entry reading as unavailable.
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: makeStrk20WalletService({
        registered: { value: true },
        registrations: { value: 0 },
        submissions: [],
      }),
    });

    const response = (await handler({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)) as {
      readonly strk20Job?: unknown;
      readonly strk20State?: { readonly registration: string };
    };

    expect(response.strk20Job).toBeUndefined();
    expect(response.strk20State?.registration).toBe("registered");
  });

  test("a lapsed discovery budget is an error, never an unregistered reading", async () => {
    // A registered account whose indexer read stalls must not be offered
    // registration again: the lapse reaches the UI's retry as a service error.
    for (const stalled of ["registrationStatus", "privateBalances"] as const) {
      const handler = buildStrk20Handler({
        preferences: preferences(),
        strk20: {
          ...makeStrk20WalletService({
            registered: { value: true },
            registrations: { value: 0 },
            submissions: [],
          }),
          async [stalled]() {
            throw new WalletError(strk20WaitExceeded("checking registration", 60_000));
          },
        },
      });

      await expect(
        handler({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER),
      ).resolves.toEqual({
        error: "strk20 services unavailable: checking registration did not finish within 60 s",
      });
    }
  });

  test("returns a recoverable error without exposing the RPC diagnostic", async () => {
    const capture = {
      registered: { value: true },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: {
        ...makeStrk20WalletService(capture),
        async poolFee() {
          throw new Error("could not read the pool fee (node unavailable)");
        },
      },
    });

    await expect(handler({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)).resolves.toEqual(
      { error: "Private balances unavailable" },
    );
  });

  test("prepares public registration and atomically consumes it before submission", async () => {
    const capture = {
      registered: { value: false },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: makeStrk20WalletService(capture),
    });
    // The activation proof runs as a tracked job: the review is what the poll
    // settles on, exactly as a shield's is.
    const prepared = (await prepareStrk20Registration(handler)) as {
      readonly strk20Preparation: {
        readonly id: string;
        readonly poolFeeFri: string;
        readonly summaries: readonly string[];
      };
    };

    expect(prepared.strk20Preparation.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(prepared.strk20Preparation.poolFeeFri).toBe("0x1");
    expect(
      prepared.strk20Preparation.summaries.some((summary) =>
        summary.includes("Registration is public"),
      ),
    ).toBe(true);
    // Issue 484: the reviewed pool fee is drawn in STRK, never the raw felt.
    expect(prepared.strk20Preparation.summaries).toContain(
      "Approve and pay the reviewed 0.000000000000000001 STRK pool fee from this account",
    );
    const execute = {
      preparationId: prepared.strk20Preparation.id,
      type: "wallet.strk20Execute",
    };
    expect(readStrk20WalletExecuteInput(execute)).toEqual({
      preparationId: prepared.strk20Preparation.id,
    });
    // The submission runs as a tracked job too; the hash is what its poll
    // settles on. The claim happened on the request, so the second execute is
    // refused on its request, without a job.
    await expect(executeStrk20Preparation(handler, prepared.strk20Preparation.id)).resolves.toEqual(
      { ok: true, transactionHash: "0x111" },
    );
    expect(capture.registrations.value).toBe(1);
    await expect(handler(execute, STRK20_EXTENSION_SENDER)).resolves.toEqual({
      error: "Privacy preparation not found",
    });
    expect(capture.registrations.value).toBe(1);
  });

  test("an unindexed registration reads as pending and refuses a duplicate preparation", async () => {
    const capture = {
      registered: { value: false },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      activity: await activityWithRegistration(),
      now: () => SUBMITTED_AT + 5_000,
      preferences: preferences(),
      strk20: makeStrk20WalletService(capture),
    });

    const response = (await handler({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)) as {
      readonly strk20State: {
        readonly balances: readonly unknown[];
        readonly registration: string;
      };
    };
    expect(response.strk20State.registration).toBe("pending");
    // Pending is not shieldable: no private balances are claimed for it.
    expect(response.strk20State.balances).toEqual([]);

    await expect(prepareStrk20Registration(handler)).resolves.toEqual({
      error: "A registration is already on its way for this account",
      privacyBlocker: "pending",
    });
    expect(capture.registrations.value).toBe(0);
  });

  test("a pending registration stops shadowing the service reading once its window lapses", async () => {
    const capture = {
      registered: { value: false },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      activity: await activityWithRegistration(),
      now: () => SUBMITTED_AT + 31 * 60_000,
      preferences: preferences(),
      strk20: makeStrk20WalletService(capture),
    });

    const response = (await handler({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)) as {
      readonly strk20State: { readonly registration: string };
    };
    expect(response.strk20State.registration).toBe("unregistered");
    // A registration that never landed must stay retryable rather than locking
    // the account out of the flow forever.
    const prepared = (await prepareStrk20Registration(handler)) as {
      readonly strk20Preparation?: { readonly id: string };
    };
    expect(prepared.strk20Preparation?.id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("a rejected registration never reads as pending", async () => {
    const capture = {
      registered: { value: false },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      activity: await activityWithRegistration("rejected"),
      now: () => SUBMITTED_AT + 5_000,
      preferences: preferences(),
      strk20: makeStrk20WalletService(capture),
    });

    const response = (await handler({ type: "wallet.strk20State" }, STRK20_EXTENSION_SENDER)) as {
      readonly strk20State: { readonly registration: string };
    };
    expect(response.strk20State.registration).toBe("unregistered");
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
      strk20: makeStrk20WalletService(capture),
    });
    const prepared = (await prepareStrk20Deposit(handler, {
      amount: "1.5",
      recipient: account.address,
      tokenId: token.id,
      type: "wallet.strk20PrepareDeposit",
    })) as {
      readonly strk20Preparation: {
        readonly amount: string;
        readonly id: string;
        readonly route: string;
      };
    };

    expect(prepared.strk20Preparation.amount).toBe("1.5");
    expect(prepared.strk20Preparation.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(prepared.strk20Preparation.route).toBe("public-account");
    await expect(executeStrk20Preparation(handler, prepared.strk20Preparation.id)).resolves.toEqual(
      { ok: true, transactionHash: "0x222" },
    );
    // A self-credit rides the batch's implicit surplus, so it stays a bare
    // deposit — naming the sender would add a redundant note to the batch.
    expect(capture.submissions).toEqual([
      {
        actions: [
          {
            amount: "0x14d1120d7b160000",
            token: STRK20_TOKEN,
            type: "deposit",
          },
        ],
        plan: { mode: "account", poolFeeFri: "0x1" },
      },
    ]);
  });

  test("carries a third-party recipient into the deposit action", async () => {
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
      strk20: makeStrk20WalletService(capture),
    });
    const prepared = (await prepareStrk20Deposit(handler, {
      amount: "1.5",
      recipient: STRK20_RECIPIENT,
      tokenId: token.id,
      type: "wallet.strk20PrepareDeposit",
    })) as {
      readonly strk20Preparation: {
        readonly id: string;
        readonly recipient: string;
        readonly summaries: readonly string[];
      };
    };

    expect(prepared.strk20Preparation.recipient).toBe(CANONICAL_RECIPIENT);
    expect(prepared.strk20Preparation.summaries[0]).toBe(
      `Shield 1.5 ETH into ${CANONICAL_RECIPIENT}'s private balance`,
    );
    await expect(executeStrk20Preparation(handler, prepared.strk20Preparation.id)).resolves.toEqual(
      { ok: true, transactionHash: "0x222" },
    );
    expect(capture.submissions).toEqual([
      {
        actions: [
          {
            amount: "0x14d1120d7b160000",
            recipient: CANONICAL_RECIPIENT,
            token: STRK20_TOKEN,
            type: "deposit",
          },
        ],
        plan: { mode: "account", poolFeeFri: "0x1" },
      },
    ]);
  });

  // The side panel gates this too, but the message is untrusted: the note lands
  // in a channel derived from the recipient's registered viewing key.
  test("refuses a deposit crediting an unregistered third party", async () => {
    const capture = {
      recipientRegistered: { value: false },
      registered: { value: true },
      registrations: { value: 0 },
      submissions: [],
    };
    const handler = buildStrk20Handler({
      preferences: preferences(),
      publicBalance: "2000000000000000000",
      strk20: makeStrk20WalletService(capture),
    });

    // Decided inside the job, after the gate: the start request answers with
    // the running job, and the refusal is what the poll settles on.
    await expect(
      prepareStrk20Deposit(handler, {
        amount: "1",
        recipient: STRK20_RECIPIENT,
        tokenId: token.id,
        type: "wallet.strk20PrepareDeposit",
      }),
    ).resolves.toEqual({ error: "The recipient has not activated private balances" });
    expect(capture.submissions).toEqual([]);
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
      strk20: makeStrk20WalletService(capture),
    });

    await expect(
      prepareStrk20Deposit(handler, {
        amount: "1",
        recipient: account.address,
        tokenId: token.id,
        type: "wallet.strk20PrepareDeposit",
      }),
    ).resolves.toEqual({ error: "Activate private balances before shielding an asset" });
    await expect(
      handler(
        {
          amount: 1,
          recipient: account.address,
          tokenId: token.id,
          type: "wallet.strk20PrepareDeposit",
        },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Invalid shield request" });
    await expect(
      handler(
        {
          amount: "1",
          recipient: "not-an-address",
          tokenId: token.id,
          type: "wallet.strk20PrepareDeposit",
        },
        STRK20_EXTENSION_SENDER,
      ),
    ).resolves.toEqual({ error: "Enter a valid Starknet address" });
    await expect(
      handler({ preparationId: "bad", type: "wallet.strk20Execute" }, STRK20_EXTENSION_SENDER),
    ).resolves.toEqual({ error: "Invalid privacy execution request" });
  });
});
