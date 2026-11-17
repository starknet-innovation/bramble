/**
 * What Activity records for a private operation that pays someone else
 * (Sherlock 201). An unshield to another address is a public payment to that
 * address, so its row names the payee and records it as the counterparty, like
 * a shield to someone else; an unshield to the account itself stays an
 * internal move between the owner's own balances.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import {
  buildStrk20Handler,
  executeStrk20Preparation,
  STRK20_EXTENSION_SENDER,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

// The harness's signed-in account.
const ACTIVE_ACCOUNT_ADDRESS = "0xabcabcdef";

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

const unshieldTo = async (destination: string) => {
  const activity = memoryActivityLog();
  const handler = buildStrk20Handler({
    activity,
    balance: "0xde0b6b3a7640000",
    preferences: preferences(),
  });
  const prepared = (await handler(
    {
      amount: "0.25",
      recipient: destination,
      tokenId: token.id,
      type: "wallet.strk20PrepareWithdraw",
    },
    STRK20_EXTENSION_SENDER,
  )) as { readonly strk20Preparation: { readonly id: string } };
  await expect(
    executeStrk20Preparation(handler, prepared.strk20Preparation.id),
  ).resolves.toMatchObject({ ok: true });
  const [entry, ...rest] = await activity.list();
  expect(rest).toEqual([]);
  return entry;
};

describe("unshield activity", () => {
  test("names another address as the payee and records it as the counterparty", async () => {
    const payee = canonicalFelt(STRK20_RECIPIENT) ?? "";
    const entry = await unshieldTo(STRK20_RECIPIENT);
    expect(entry?.summary).toBe(`Unshield 0.25 ${token.symbol} to ${payee}`);
    expect(entry?.counterparty).toBe(payee);
    expect(entry?.origin).toBe("wallet");
    // The pool token is recorded by address as well as symbol (issue 643).
    expect(entry?.token).toBe(token.symbol);
    expect(entry?.tokenAddress).toBe(canonicalFelt(token.address) ?? "");
  });

  test("stays an internal move when the destination is the account itself", async () => {
    const entry = await unshieldTo(ACTIVE_ACCOUNT_ADDRESS);
    expect(entry?.summary).toBe(`Unshield 0.25 ${token.symbol}`);
    expect(entry?.counterparty).toBeUndefined();
  });
});
