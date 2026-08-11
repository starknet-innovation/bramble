/**
 * Wallet-owned privacy preparations are digest-bound, bounded, cloned, and
 * consumed once before asynchronous submission begins.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig } from "@mc-wallet/settings/preferences";
import {
  type ApprovalContext,
  createApprovalContext,
} from "../../../apps/extension/src/background/approvals/approval-context";
import {
  createStrk20WalletPreparationStore,
  type Strk20DepositPreparation,
  type Strk20RegistrationPreparation,
  strk20WalletPreparationPayload,
} from "../../../apps/extension/src/background/privacy/strk20-wallet-preparations";
import { account } from "../../support/background-wallet-stub";

const token: TokenConfig = {
  address: "0x456",
  decimals: 18,
  id: "SN_SEPOLIA:ETH:0x456",
  name: "Sepolia Ether",
  networkId: "SN_SEPOLIA",
  symbol: "ETH",
};

const registration = async (suffix = ""): Promise<Strk20RegistrationPreparation> => {
  const unsigned = {
    kind: "register" as const,
    poolAddress: `0x123${suffix}`,
    poolFeeFri: "0x1",
    summaries: ["Register private balances"],
    token,
  };
  const context = await createApprovalContext(account, strk20WalletPreparationPayload(unsigned));
  return { ...unsigned, context, id: context.payloadDigest };
};

const privateDeposit = async (): Promise<Strk20DepositPreparation> => {
  const unsigned = {
    actions: [{ amount: "0x1", token: token.address, type: "deposit" as const }],
    amount: "1",
    amountRaw: "1",
    kind: "deposit" as const,
    plan: {
      authorization: {
        caller: "0x99",
        executeAfter: "0x1",
        executeBefore: "0x100",
        publicCallCount: 1,
      },
      feeAction: {
        amount: "0x2",
        recipient: "0x3",
        token: "0x4",
        type: "withdraw" as const,
      },
      mode: "private-relay" as const,
    },
    poolAddress: "0x123",
    recipient: account.address,
    summaries: ["Shield 1 ETH"],
    token,
  };
  const context = await createApprovalContext(account, strk20WalletPreparationPayload(unsigned));
  return { ...unsigned, context, id: context.payloadDigest };
};

describe("STRK20 wallet preparation store", () => {
  test("returns a display-safe review and claims a deep clone exactly once", async () => {
    const store = createStrk20WalletPreparationStore();
    const value = await registration();

    expect(store.put(value)).toEqual({
      id: value.id,
      kind: "register",
      payloadDigest: value.id,
      poolAddress: value.poolAddress,
      poolFeeFri: "0x1",
      route: "public-account",
      summaries: value.summaries,
      symbol: "ETH",
      tokenId: token.id,
    });
    expect(store.claim(value.id)).toEqual(value);
    expect(store.claim(value.id)).toBeNull();
    expect(store.claim("not-a-digest")).toBeNull();
  });

  test("rejects an invalid or mismatched digest commitment", async () => {
    const store = createStrk20WalletPreparationStore();
    const value = await registration();
    const badContext: ApprovalContext = {
      ...value.context,
      payloadDigest: `sha256:${"b".repeat(64)}`,
    };

    expect(() => store.put({ ...value, id: "bad" })).toThrow(
      "Invalid privacy preparation commitment",
    );
    expect(() => store.put({ ...value, context: badContext })).toThrow(
      "Invalid privacy preparation commitment",
    );
  });

  test("exposes the exact relay fee and public authorization capability", async () => {
    const store = createStrk20WalletPreparationStore();
    const value = await privateDeposit();
    if (!("feeAction" in value.plan)) {
      throw new Error("private relay fixture expected");
    }

    expect(store.put(value)).toMatchObject({
      authorization: value.plan.authorization,
      relayFee: {
        amount: value.plan.feeAction.amount,
        recipient: value.plan.feeAction.recipient,
        token: value.plan.feeAction.token,
      },
      route: "private-relay",
    });
  });

  test("evicts the oldest preparation after the bounded capacity", async () => {
    const store = createStrk20WalletPreparationStore();
    const values = await Promise.all(
      Array.from({ length: 21 }, (_, index) => registration(index.toString(16))),
    );
    for (const value of values) {
      store.put(value);
    }

    expect(store.claim(values[0]?.id ?? "")).toBeNull();
    expect(store.claim(values[20]?.id ?? "")).not.toBeNull();
  });
});
