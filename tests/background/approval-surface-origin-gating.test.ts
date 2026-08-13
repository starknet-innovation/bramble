/**
 * MCW-V09-117 regression: opening the wallet approval surface is a UI action a
 * page triggers with no approval of its own, so it must be gated before it runs
 * — not only by the async message handler that runs after it. A blocklisted
 * phishing origin must never force the wallet UI open, and one tab must not be
 * able to re-open it on every message it sends.
 */
import { describe, expect, test } from "bun:test";
import { createOriginGuard, DEFAULT_ORIGIN_GUARD } from "@mc-wallet/permissions/blocklist";
import {
  type ApprovalSurfaceDeps,
  createApprovalSurfaceOpener,
} from "../../apps/extension/src/background/approvals/approval-surface";

// A domain on the bundled baseline blocklist in @mc-wallet/permissions/blocklist.
const BLOCKED_BASELINE = "https://starknet-airdrop.com";
const HONEST_ORIGIN = "https://dapp.example";

const openerWith = (deps: Partial<ApprovalSurfaceDeps>) => {
  const opened: number[] = [];
  const open = createApprovalSurfaceOpener({
    browser: {
      sidePanel: {
        async open({ tabId }) {
          opened.push(tabId);
        },
      },
    },
    extensionId: "extension-id",
    guard: DEFAULT_ORIGIN_GUARD,
    now: () => 0,
    preference: () => "side-panel",
    ...deps,
  });
  return { open, opened };
};

const senderFor = (origin: string, tabId: number) => ({
  id: "extension-id",
  origin,
  tab: { id: tabId },
  url: `${origin}/app`,
});

describe("approval surface origin gating", () => {
  test("a blocklisted origin cannot force the wallet UI open", () => {
    const { open, opened } = openerWith({});

    open(
      { origin: BLOCKED_BASELINE, type: "wallet.requestAccounts" },
      senderFor(BLOCKED_BASELINE, 1),
    );

    expect(opened).toEqual([]);
  });

  test("a domain blocked only by the live feed is gated too", () => {
    const feed = new Set(["drainer.example"]);
    const { open, opened } = openerWith({ guard: createOriginGuard(() => feed) });

    // Subdomains of a feed entry are blocked by the same guard the message
    // handlers use, so the surface must honour them as well.
    open(
      { origin: "https://login.drainer.example", type: "wallet.signTypedData" },
      senderFor("https://login.drainer.example", 2),
    );
    open({ type: "wallet.signTypedData" }, senderFor(HONEST_ORIGIN, 3));

    expect(opened).toEqual([3]);
  });

  test("a spoofed origin in the message body cannot unblock a blocklisted sender", () => {
    const { open, opened } = openerWith({});

    // The gate reads the browser-supplied sender origins, never the body.
    open({ origin: HONEST_ORIGIN, type: "wallet.requestAccounts" }, senderFor(BLOCKED_BASELINE, 4));

    expect(opened).toEqual([]);
  });

  test("a tab cannot re-open the surface on every message it sends", () => {
    let now = 10_000;
    const { open, opened } = openerWith({ now: () => now });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      open({ type: "wallet.requestAccounts" }, senderFor(HONEST_ORIGIN, 5));
      now += 25;
    }

    expect(opened).toEqual([5]);
  });

  test("the cooldown expires so a later genuine request still opens", () => {
    let now = 10_000;
    const { open, opened } = openerWith({ now: () => now });

    open({ type: "wallet.requestAccounts" }, senderFor(HONEST_ORIGIN, 6));
    now += 1_000;
    open({ type: "wallet.signTypedData" }, senderFor(HONEST_ORIGIN, 6));

    expect(opened).toEqual([6, 6]);
  });

  test("a clock that jumps backwards does not wedge the cooldown shut", () => {
    let now = 10_000;
    const { open, opened } = openerWith({ now: () => now });

    open({ type: "wallet.requestAccounts" }, senderFor(HONEST_ORIGIN, 7));
    now = 500;
    open({ type: "wallet.requestAccounts" }, senderFor(HONEST_ORIGIN, 7));

    expect(opened).toEqual([7, 7]);
  });

  test("a sender the browser gave no origin for is treated as untrusted", () => {
    const { open, opened } = openerWith({});

    // No `origin` and no `url`: there is nothing to check against the
    // blocklist, so the gate must fail closed rather than read the empty list
    // as "no blocked origin found". Same for a `url` that will not parse.
    open({ type: "wallet.requestAccounts" }, { id: "extension-id", tab: { id: 10 } });
    open(
      { type: "wallet.requestAccounts" },
      { id: "extension-id", tab: { id: 11 }, url: "not-a-url" },
    );

    expect(opened).toEqual([]);
  });

  test("a two-step dapp flow inside the cooldown reuses the surface it already opened", () => {
    const { open, opened } = openerWith({ now: () => 10_000 });

    // The STRK20 prepare/invoke pair arrives back to back from one tab. The
    // first message opens the surface; the second is inside the cooldown and
    // deliberately does not re-open it, because the surface it needs is already
    // up and the queued approval — not this call — is what the user acts on.
    open({ type: "wallet.strk20PrepareInvoke" }, senderFor(HONEST_ORIGIN, 12));
    open({ type: "wallet.strk20InvokeTransaction" }, senderFor(HONEST_ORIGIN, 12));

    expect(opened).toEqual([12]);
  });

  test("one tab's cooldown never suppresses another tab's request", () => {
    const { open, opened } = openerWith({ now: () => 10_000 });

    open({ type: "wallet.requestAccounts" }, senderFor(HONEST_ORIGIN, 8));
    open({ type: "wallet.requestAccounts" }, senderFor(HONEST_ORIGIN, 8));
    open({ type: "wallet.requestAccounts" }, senderFor("https://other.example", 9));

    expect(opened).toEqual([8, 9]);
  });
});
