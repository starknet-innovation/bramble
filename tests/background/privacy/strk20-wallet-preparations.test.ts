/**
 * Wallet-owned privacy preparations are digest-bound, bounded, cloned, and
 * consumed once before asynchronous submission begins.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig } from "@bramble/settings/preferences";
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
    allowanceGrants: [],
    calls: [{ calldata: ["0x1"], contractAddress: `0x123${suffix}`, entrypoint: "apply_actions" }],
    kind: "register" as const,
    networkFee: { overallFee: "1", unit: "FRI" },
    poolAddress: `0x123${suffix}`,
    poolFeeFri: "0x1",
    proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
    summaries: ["Register private balances"],
    token,
  };
  const context = await createApprovalContext(account, strk20WalletPreparationPayload(unsigned));
  return { ...unsigned, context, id: context.payloadDigest };
};

const privateDeposit = async (): Promise<Strk20DepositPreparation> => {
  const unsigned = {
    actions: [{ amount: "0x1", token: token.address, type: "deposit" as const }],
    allowanceGrants: [],
    amount: "1",
    amountRaw: "1",
    calls: [{ calldata: ["0x1"], contractAddress: "0x123", entrypoint: "apply_actions" }],
    kind: "deposit" as const,
    networkFee: { overallFee: "2", unit: "FRI" },
    plan: { mode: "account" as const, poolFeeFri: "0x1" },
    poolAddress: "0x123",
    proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
    recipient: account.address,
    summaries: ["Shield 1 ETH"],
    token,
  };
  const context = await createApprovalContext(account, strk20WalletPreparationPayload(unsigned));
  return { ...unsigned, context, id: context.payloadDigest };
};

const USDT = "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8";

const relayedTransfer = async (feeToken: string) => {
  const mainnetToken: TokenConfig = { ...token, id: "SN_MAIN:ETH:0x456", networkId: "SN_MAIN" };
  const unsigned = {
    actions: [
      { amount: "0x1", recipient: "0x999", token: token.address, type: "transfer" as const },
    ],
    amount: "1",
    amountRaw: "1",
    kind: "transfer" as const,
    plan: {
      feeAction: {
        amount: "0x124f80",
        recipient: "0x4",
        token: feeToken,
        type: "withdraw" as const,
      },
      mode: "private-relay" as const,
    },
    poolAddress: "0x123",
    recipient: "0x999",
    summaries: ["Send 1 ETH privately"],
    token: mainnetToken,
  };
  const context = await createApprovalContext(account, strk20WalletPreparationPayload(unsigned));
  return { ...unsigned, context, id: context.payloadDigest };
};

describe("STRK20 wallet preparation store", () => {
  // #358: a relay fee converted out of STRK must reach the panel with its own
  // token's display metadata, from the registry rather than preferences.
  test("describes the relay fee token from the registry, and only when it knows it", async () => {
    const store = createStrk20WalletPreparationStore();

    expect(store.put(await relayedTransfer(USDT)).relayFee).toEqual({
      amount: "0x124f80",
      asset: { decimals: 6, symbol: "USDT" },
      recipient: "0x4",
      token: USDT,
    });
    expect(store.put(await relayedTransfer("0x777")).relayFee).toEqual({
      amount: "0x124f80",
      recipient: "0x4",
      token: "0x777",
    });
  });

  test("returns a display-safe review and claims a deep clone exactly once", async () => {
    const store = createStrk20WalletPreparationStore();
    const value = await registration();

    expect(store.put(value)).toEqual({
      id: value.id,
      kind: "register",
      networkFee: value.networkFee,
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

  test("exposes the exact public network fee", async () => {
    const store = createStrk20WalletPreparationStore();
    const value = await privateDeposit();
    expect(store.put(value)).toMatchObject({
      networkFee: value.networkFee,
      route: "public-account",
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
