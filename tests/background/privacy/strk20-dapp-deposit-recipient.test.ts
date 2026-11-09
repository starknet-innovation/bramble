/**
 * Audit finding 139, background half. A dapp `deposit` that names a recipient
 * pays that account privately; both dapp routes that queue such an action
 * (`wallet.strk20InvokeTransaction`, `wallet.strk20PrepareInvoke`) must summarize
 * it as a payment to that payee, and only a deposit back to the requesting
 * account may read as a plain shield. The side-panel half is pinned in
 * packages/presentation/wallet-ui/tests/.../strk20-deposit-recipient.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { account } from "../../support/background-wallet-stub";
import { flushHeld, waitForPendingApprovals } from "../../support/held";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

type Pending = { readonly kind: string; readonly summaries?: readonly string[] };

const routes = [
  { kind: "strk20-invoke", type: "wallet.strk20InvokeTransaction" },
  { kind: "strk20-prepare", simulate: false, type: "wallet.strk20PrepareInvoke" },
] as const;

const queuedSummary = async (
  route: (typeof routes)[number],
  recipient: string | undefined,
  token: string = STRK20_TOKEN,
): Promise<string | undefined> => {
  const handler = buildStrk20Handler();
  const { kind, ...message } = route;
  void handler(
    {
      ...message,
      actions: [
        {
          amount: "0x5",
          ...(recipient === undefined ? {} : { recipient }),
          token,
          type: "deposit",
        },
      ],
      origin: STRK20_ORIGIN,
    },
    STRK20_CONTENT_SENDER,
  );
  await flushHeld();
  const pending = await waitForPendingApprovals<Pending & { id: string }>(
    handler,
    STRK20_EXTENSION_SENDER,
  );
  const approval = pending.at(-1);
  expect(approval?.kind).toBe(kind);
  return approval?.summaries?.[0];
};

describe("dapp STRK20 deposit recipient summaries", () => {
  for (const route of routes) {
    test(`${route.kind} names the payee of a deposit to another account`, async () => {
      await expect(queuedSummary(route, STRK20_RECIPIENT)).resolves.toBe(
        "Pay 0.000000000000000005 ETH privately to 0x04718f…938d (0x049d36…4dc7)",
      );
    });

    test(`${route.kind} keeps a deposit to the requesting account a plain shield`, async () => {
      await expect(queuedSummary(route, account.address)).resolves.toBe(
        "Deposit 0.000000000000000005 ETH to private balance (0x049d36…4dc7)",
      );
      await expect(queuedSummary(route, undefined)).resolves.toBe(
        "Deposit 0.000000000000000005 ETH to private balance (0x049d36…4dc7)",
      );
    });
  }

  // Sherlock 154: a token outside the wallet's trusted set never lends a
  // decimal point or ticker to the card, so its exact felt is shown.
  for (const route of routes) {
    test(`${route.kind} keeps the exact amount for a token the wallet does not trust`, async () => {
      const untracked = "0x0123abc";
      await expect(queuedSummary(route, account.address, untracked)).resolves.toBe(
        "Deposit 0x5 to private balance (0x0123abc)",
      );
    });
  }
});
