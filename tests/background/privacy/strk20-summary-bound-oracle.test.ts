/**
 * Audit N1: a shadow-account batch's card names each settled token by its
 * trusted ticker when the user tracks it and by its address when not, and only
 * a configured anonymizer reaches a card at all. Measuring that real text
 * against the panel's line bound let a site pad a batch with OPEN transfers and
 * read, from an instant refusal, both that an anonymizer is configured and
 * which tokens the user tracks. The bound is now decided from the site's input
 * alone, and every later failure of a batch that needs the anonymizer is held
 * on the wallet's notice, on the prepare path as on the invoke path.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { APPROVAL_SUMMARY_UNRENDERABLE } from "../../../apps/extension/src/background/approvals/approval-summary-bound";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../../support/held";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const defaults = defaultWalletPreferences();
const mainnet = defaults.strk20Networks?.SN_MAIN;
if (!mainnet) throw new Error("missing bundled Mainnet STRK20 config");
// The bundled config, which ships without the opt-in anonymizer.
const withoutAnonymizer = {
  ...defaults,
  activeNetworkId: "SN_SEPOLIA" as const,
  strk20Networks: { ...defaults.strk20Networks, SN_SEPOLIA: mainnet },
};

// Distinct full-width token addresses no preference set tracks.
const untracked = (index: number): string => `0x${(0x1000 + index).toString(16).padStart(62, "a")}`;

const shadowInvoke = {
  calls: [{ calldata: [], contract_address: STRK20_RECIPIENT, entry_point: "swap" }],
  collect_policy: { type: "all" },
  dapp_name: "Example",
  nonce: "0x1",
  type: "shadow_account_invoke",
};

// The reviewer's probe: one shadow invoke settling OPEN notes for a probe token
// plus `fillers` untracked tokens, all to someone else.
const probe = (
  type: "wallet.strk20PrepareInvoke" | "wallet.strk20InvokeTransaction",
  fillers: number,
  probeToken: string,
) => ({
  actions: [
    ...[probeToken, ...Array.from({ length: fillers }, (_, index) => untracked(index))].map(
      (token) => ({ amount: "OPEN", recipient: STRK20_RECIPIENT, token, type: "transfer" }),
    ),
    shadowInvoke,
  ],
  origin: STRK20_ORIGIN,
  ...(type === "wallet.strk20PrepareInvoke" ? { simulate: false } : {}),
  type,
});

const SETUPS = [
  { name: "configured, probe token tracked", options: {}, token: STRK20_TOKEN },
  { name: "configured, probe token untracked", options: {}, token: untracked(99) },
  {
    name: "not configured, probe token tracked",
    options: { preferences: withoutAnonymizer },
    token: STRK20_TOKEN,
  },
  {
    name: "not configured, probe token untracked",
    options: { preferences: withoutAnonymizer },
    token: untracked(99),
  },
] as const;

// What the site can see without the user doing anything: the settled answer,
// or that it is still held.
const observe = async (message: unknown, options: object): Promise<string> => {
  const handler = buildStrk20Handler(options);
  let settled = "held";
  void handler(message, STRK20_CONTENT_SENDER).then((result) => {
    settled = JSON.stringify(result);
  });
  for (let flush = 0; flush < 20; flush += 1) await flushHeld();
  return settled;
};

describe("the summary bound reveals nothing about the user's setup", () => {
  for (const type of ["wallet.strk20PrepareInvoke", "wallet.strk20InvokeTransaction"] as const) {
    test(`${type}: same answer tracked or not, configured or not, at every padding`, async () => {
      const seen = new Set<string>();
      for (let fillers = 8; fillers <= 20; fillers += 1) {
        const answers = await Promise.all(
          SETUPS.map((setup) => observe(probe(type, fillers, setup.token), setup.options)),
        );
        expect({ answers, fillers }).toEqual({
          answers: answers.map(() => answers[0] ?? ""),
          fillers,
        });
        seen.add(answers[0] ?? "");
      }
      // The probe range crosses the bound: held below it, refused past it.
      expect([...seen].sort()).toEqual(
        [JSON.stringify({ error: APPROVAL_SUMMARY_UNRENDERABLE }), "held"].sort(),
      );
    });
  }

  test("the reviewer's 16-filler probe, tracked or not, configured or not", async () => {
    const answers = await Promise.all(
      SETUPS.map((setup) =>
        observe(probe("wallet.strk20PrepareInvoke", 16, setup.token), setup.options),
      ),
    );
    expect(new Set(answers).size).toBe(1);
  });
});

describe("a prepare that needs the anonymizer holds every queueing failure", () => {
  test("held on the request-failed notice, refused only once the user closes it", async () => {
    const queue = createApprovalQueue();
    const failing = {
      ...queue,
      requestStrk20Disclosure: () => {
        throw new WalletError("Request too large to review");
      },
    };
    const handler = buildStrk20Handler({ approvals: failing });
    let settled: unknown = "held";
    const held = handler(
      probe("wallet.strk20PrepareInvoke", 0, STRK20_TOKEN),
      STRK20_CONTENT_SENDER,
    );
    void held.then((result) => {
      settled = result;
    });
    const pending = await waitForPendingApprovals<{ id: string; kind: string; notice?: string }>(
      handler,
      STRK20_EXTENSION_SENDER,
    );
    expect(pending.map((approval) => [approval.kind, approval.notice])).toEqual([
      ["strk20-unavailable", "request-failed"],
    ]);
    await flushHeld();
    expect(settled).toBe("held");
    const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
    await handler({ id, type: "wallet.denyOrigin" }, STRK20_EXTENSION_SENDER);
    expect(await held).toEqual({ error: "Request too large to review" });
  });

  test("a prepare that does not need it still fails at once", async () => {
    const queue = createApprovalQueue();
    const failing = {
      ...queue,
      requestStrk20Disclosure: () => {
        throw new WalletError("Request too large to review");
      },
    };
    const handler = buildStrk20Handler({ approvals: failing });
    const result = await handler(
      {
        actions: [
          { amount: "0x0a", recipient: STRK20_RECIPIENT, token: STRK20_TOKEN, type: "withdraw" },
        ],
        origin: STRK20_ORIGIN,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      STRK20_CONTENT_SENDER,
    );
    expect(result).toEqual({ error: "Request too large to review" });
  });
});
