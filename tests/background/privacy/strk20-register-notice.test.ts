/**
 * Audit L1: `wallet_strk20Register` answered a connected site at once, with no
 * card, when the account is a Ledger, when the network has no private services,
 * or when the public balance cannot cover the pool fee. Each instant answer
 * told the site something about the user's setup. Each is now held on the
 * close-only private-services notice: the site gets the same refusal only when
 * the user closes it, and the ordinary expiry refusal if nobody does.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  APPROVAL_TTL_MS,
  createApprovalQueue,
} from "../../../apps/extension/src/background/approvals/approvals";
import { account } from "../../support/background-wallet-stub";
import { flushHeld, waitForPendingApprovals } from "../../support/held";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  type Strk20HarnessOptions,
} from "../../support/strk20-background";

const REGISTER = { origin: STRK20_ORIGIN, type: "wallet.strk20Register" } as const;

// The granted stub account, held on a Ledger.
const ledgerAccount: AccountRef = {
  ...account,
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: "m/2645'/1195502025'/1470455285'/0'/0'/0",
  },
};

const defaults = defaultWalletPreferences();
const { SN_SEPOLIA: _sepolia, ...withoutSepolia } = defaults.strk20Networks ?? {};
const noPrivateServices = {
  ...defaults,
  activeNetworkId: "SN_SEPOLIA" as const,
  strk20Networks: withoutSepolia,
};

const CASES: readonly {
  readonly name: string;
  readonly notice?: string;
  readonly options: Strk20HarnessOptions;
  readonly refusal: string;
}[] = [
  {
    name: "a Ledger account",
    notice: "request-failed",
    options: { accounts: [ledgerAccount] },
    refusal: "Private balances are not available for Ledger accounts",
  },
  {
    name: "a network without private services",
    options: { preferences: noPrivateServices },
    refusal: "strk20 services unavailable",
  },
  {
    name: "a public balance below the pool fee",
    notice: "request-failed",
    options: { publicBalance: "0" },
    refusal: "Not enough STRK for the pool fee",
  },
];

type Listed = { readonly id: string; readonly kind: string; readonly notice?: string };

const start = (options: Strk20HarnessOptions) => {
  const handler = buildStrk20Handler(options);
  let settled: unknown = "unsettled";
  const held = handler(REGISTER, STRK20_CONTENT_SENDER).then((result) => {
    settled = result;
    return result;
  });
  return { handler, held, settled: () => settled };
};

describe("strk20 register never answers the account's setup at once", () => {
  for (const entry of CASES) {
    test(`${entry.name} is held on a notice and refused only on Close`, async () => {
      const { handler, held, settled } = start(entry.options);
      const pending = await waitForPendingApprovals<Listed>(handler, STRK20_EXTENSION_SENDER);
      await flushHeld();
      expect(settled()).toBe("unsettled");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.kind).toBe("strk20-unavailable");
      expect(pending[0]?.notice).toBe(entry.notice);
      await handler({ id: pending[0]?.id, type: "wallet.denyOrigin" }, STRK20_EXTENSION_SENDER);
      expect(await held).toEqual({ error: entry.refusal });
    });

    test(`${entry.name} expires like any approval`, async () => {
      const clock = { now: 1_700_000_000_000 };
      const { handler, held, settled } = start({
        ...entry.options,
        approvals: createApprovalQueue({ now: () => clock.now }),
      });
      await waitForPendingApprovals(handler, STRK20_EXTENSION_SENDER);
      await flushHeld();
      expect(settled()).toBe("unsettled");
      clock.now += APPROVAL_TTL_MS + 1;
      await handler({ type: "wallet.pendingApprovals" }, STRK20_EXTENSION_SENDER);
      expect(await held).toEqual({ error: "request rejected" });
    });
  }

  test("the notice expires from when the request arrived, as its card would", async () => {
    const START = 1_700_000_000_000;
    const clock = { now: START };
    let reads = 0;
    const { handler, held } = start({
      accounts: [ledgerAccount],
      approvals: createApprovalQueue({ now: () => clock.now }),
      // The wallet's own work takes half the deadline before the notice queues.
      preferencesRead: () => {
        reads += 1;
        if (reads === 1) clock.now += APPROVAL_TTL_MS / 2;
        return {
          ...defaults,
          activeNetworkId: "SN_SEPOLIA" as const,
        };
      },
    });
    await waitForPendingApprovals(handler, STRK20_EXTENSION_SENDER);
    clock.now = START + APPROVAL_TTL_MS + 1;
    await handler({ type: "wallet.pendingApprovals" }, STRK20_EXTENSION_SENDER);
    expect(await held).toEqual({ error: "request rejected" });
  });

  test("a software account with services and funds still reaches the register card", async () => {
    const { handler } = start({});
    const pending = await waitForPendingApprovals<Listed>(handler, STRK20_EXTENSION_SENDER);
    expect(pending.map((approval) => approval.kind)).toEqual(["strk20-register"]);
  });
});
