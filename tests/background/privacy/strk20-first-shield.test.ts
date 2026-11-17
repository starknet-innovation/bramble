/**
 * First shield with activation in the same transaction (#789). An unregistered
 * account shielding into its own private balance registers inside that one
 * `apply_actions`, so it pays one pool fee. Anything else still needs the
 * registration first, and the review, the digest, the execution re-check and
 * the activity row all say the batch registers.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { PRIVACY_DEPLOY_REQUIRED } from "@bramble/wallet-protocol/privacy-blocker";
import {
  hasPendingRegistration,
  STRK20_REGISTRATION_SUMMARY,
} from "../../../apps/extension/src/background/privacy/strk20-activity";
import {
  type Strk20DepositPreparation,
  strk20WalletPreparationPayload,
} from "../../../apps/extension/src/background/privacy/strk20-wallet-preparations";
import { account } from "../../support/background-wallet-stub";
import {
  buildStrk20Handler,
  executeStrk20Preparation,
  prepareStrk20Deposit,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";
import { makeStrk20WalletService } from "../../support/strk20-wallet-service";

const NOW = 1_700_000_000_000;

const tokenId = defaultWalletPreferences().tokens.find(
  (candidate) => candidate.networkId === "SN_SEPOLIA" && candidate.address === STRK20_TOKEN,
)?.id;
if (!tokenId) {
  throw new Error("Sepolia token fixture missing");
}

const harness = (
  options: {
    readonly activity?: ReturnType<typeof memoryActivityLog>;
    readonly deployed?: boolean;
    readonly registered?: boolean;
    /** The account registers elsewhere between preparation and the proof. */
    readonly registersBeforeProof?: boolean;
  } = {},
) => {
  const registered = { value: options.registered ?? false };
  const submissions: Parameters<typeof makeStrk20WalletService>[0]["submissions"] = [];
  const activations: (true | undefined)[] = [];
  const base = makeStrk20WalletService({ registered, registrations: { value: 0 }, submissions });
  const strk20: Strk20Service = {
    ...base,
    async prepareAccountActions(input) {
      activations.push(input.activate);
      if (options.registersBeforeProof) {
        registered.value = true;
        await input.beforeProof?.();
      }
      return (await base.prepareAccountActions?.(input)) as never;
    },
  };
  const activity = options.activity ?? memoryActivityLog(() => NOW);
  const handler = buildStrk20Handler({
    activity,
    ...(options.deployed === undefined ? {} : { deployed: options.deployed }),
    now: () => NOW,
    strk20,
  });
  return { activations, activity, handler, registered, submissions };
};

type Review = {
  readonly error?: string;
  readonly strk20Preparation?: { readonly id: string; readonly summaries: readonly string[] };
};

const shield = (handler: ReturnType<typeof harness>["handler"], recipient = account.address) =>
  prepareStrk20Deposit(handler, {
    amount: "1.5",
    recipient,
    tokenId,
    type: "wallet.strk20PrepareDeposit",
  }) as Promise<Review>;

const pendingContext = {
  accountContext: { account: { id: account.id, networkId: "SN_SEPOLIA" } },
};

describe("first shield activates in the same transaction", () => {
  test("an unregistered self-credit registers and shields in one reviewed batch", async () => {
    const run = harness();
    const review = await shield(run.handler);
    const preparation = review.strk20Preparation;
    if (!preparation) throw new Error(`expected a review, got ${review.error}`);
    expect(run.activations).toEqual([true]);
    expect(preparation.summaries[0]).toMatch(/^Activate private balances and shield 1\.5 /);
    expect(preparation.summaries).toContain(
      "Registration is public and links this wallet address to its viewing key",
    );

    await expect(executeStrk20Preparation(run.handler, preparation.id)).resolves.toMatchObject({
      ok: true,
      transactionHash: "0x222",
    });
    expect(run.submissions).toHaveLength(1);
    const row = (await run.activity.list()).find((entry) => entry.hash === "0x222");
    expect(row?.summary).toMatch(/^Activate private balances and shield 1\.5 /);
    // The one row is what keeps a second registration from being prepared
    // while the indexer catches up.
    await expect(
      hasPendingRegistration({ activity: run.activity, now: () => NOW }, pendingContext),
    ).resolves.toBe(true);
  });

  test("a registered account's shield never registers again", async () => {
    const run = harness({ registered: true });
    const review = await shield(run.handler);
    expect(run.activations).toEqual([undefined]);
    expect(review.strk20Preparation?.summaries[0]).toMatch(/^Shield 1\.5 /);
  });

  test("a deposit into someone else's balance still needs the registration first", async () => {
    const run = harness();
    await expect(shield(run.handler, STRK20_RECIPIENT)).resolves.toMatchObject({
      error: "Activate private balances before shielding an asset",
    });
    expect(run.activations).toEqual([]);
  });

  test("refuses while a registration is already on its way", async () => {
    const activity = memoryActivityLog(() => NOW);
    await activity.record({
      accountId: account.id,
      hash: "0x111",
      kind: "invoke",
      networkId: "SN_SEPOLIA",
      summary: STRK20_REGISTRATION_SUMMARY,
    });
    const run = harness({ activity });
    await expect(shield(run.handler)).resolves.toMatchObject({
      error: "A registration is already on its way for this account",
    });
    expect(run.activations).toEqual([]);
  });

  test("refuses an undeployed account before any proof", async () => {
    const run = harness({ deployed: false });
    const review = await shield(run.handler);
    expect(review.error).toBe(PRIVACY_DEPLOY_REQUIRED);
    expect(run.activations).toEqual([]);
  });

  test("refuses before the proof when the account registered meanwhile", async () => {
    const run = harness({ registersBeforeProof: true });
    await expect(shield(run.handler)).resolves.toMatchObject({
      error: "Private balances changed. Review the shield again.",
    });
    expect(run.submissions).toHaveLength(0);
  });

  test("refuses at execution when the account registered meanwhile", async () => {
    const run = harness();
    const preparation = (await shield(run.handler)).strk20Preparation;
    if (!preparation) throw new Error("expected a review");
    run.registered.value = true;
    await expect(executeStrk20Preparation(run.handler, preparation.id)).resolves.toMatchObject({
      error: "Private balances changed. Review the shield again.",
    });
    expect(run.submissions).toHaveLength(0);
  });

  test("the approval digest binds whether the batch registers", () => {
    const frozen = {
      actions: [],
      allowanceGrants: [],
      amount: "1",
      amountRaw: "0x1",
      calls: [],
      kind: "deposit",
      plan: { mode: "account", poolFeeFri: "0x1" },
      poolAddress: "0x123",
      proof: [],
      recipient: account.address,
      summaries: [],
      token: { address: STRK20_TOKEN },
    } as unknown as Omit<Strk20DepositPreparation, "context" | "id">;
    expect(strk20WalletPreparationPayload({ ...frozen, activates: true })).toMatchObject({
      activates: true,
    });
    expect(strk20WalletPreparationPayload(frozen)).not.toHaveProperty("activates");
  });
});
