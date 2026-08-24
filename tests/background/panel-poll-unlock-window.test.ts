/**
 * No message the side panel issues on its own may extend the inactivity window
 * (MCW-V09-105).
 *
 * The dapp half of this rule is pinned next door in
 * dapp-poll-unlock-window.test.ts. This is the other half, and it is the one
 * that survived round one: the panel's own refresh loop re-reads state every
 * fifteen seconds while it is visible, hydration re-reads a view's network data
 * on every one of those ticks, and a settling privacy registration adds a
 * three-second poll of its own. None of that is the user doing anything. If any
 * of those reads renews the unlock, an open side panel keeps the wallet
 * unlocked forever, which is the same defeat a polling dapp page gave us.
 *
 * The rule this suite enforces is therefore about the *trigger*, not the
 * message: a read the panel issues with no user action behind it observes the
 * session (`peekPassphrase`), and only a read the user asked for renews it
 * (`getPassphrase`). The counterpart assertions — that the user-initiated
 * routes still renew — are here too, because a fix that simply stopped renewing
 * everywhere would lock a user out mid-transaction and would also pass a
 * "nothing renews" test.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createUnlockSession,
  type UnlockSession,
} from "../../apps/extension/src/background/runtime/session";
import { makeKeyBoundaryHarness } from "../support/key-boundary-harness";
import { KEY_BOUNDARY_MESSAGES } from "../support/key-boundary-messages";
import { MULTISIG_KEY_BOUNDARY_MESSAGES } from "../support/key-boundary-multisig-messages";
import { STRK20_KEY_BOUNDARY_MESSAGES } from "../support/key-boundary-strk20-messages";
import type { KeyBoundaryLiveIds } from "../support/key-boundary-types";
import { REPO_DIR } from "../support/workspace-sources";

const HYDRATE_SOURCE = join(
  REPO_DIR,
  "packages/presentation/wallet-ui/src/sidepanel/app/sync/hydrate.ts",
);
const LIFECYCLE_SOURCE = join(
  REPO_DIR,
  "packages/presentation/wallet-ui/src/sidepanel/app/sync/lifecycle.ts",
);
const PRIVACY_SOURCE = join(
  REPO_DIR,
  "packages/presentation/wallet-ui/src/sidepanel/journeys/privacy/privacy-ui.ts",
);
const TRANSACTION_ALERTS_SOURCE = join(
  REPO_DIR,
  "packages/presentation/wallet-ui/src/sidepanel/journeys/approvals/tx-alerts-ui.ts",
);

const TTL_MS = 60_000;
const UNLOCKED_AT = 1_000;
const EXPIRES_AT = UNLOCKED_AT + TTL_MS;

/**
 * Every wallet-client call the panel's `app/sync/hydrate.ts` makes, and the
 * background message each one sends. Hydration runs on every refresh tick, so this
 * whole column is panel-poll traffic. A guard below re-derives the left column
 * from the hydrate source, so adding a loader there without deciding how it
 * reads the session fails this suite rather than quietly renewing.
 */
const HYDRATED_CALL_MESSAGES: Readonly<Record<string, string>> = {
  "deployment.load": "wallet.deploymentStatus",
  "multisig.loadBalances": "wallet.multisigBalances",
  "multisig.loadClassStatus": "wallet.argentMultisigClassStatus",
  "multisig.loadMultisigs": "wallet.multisigs",
  "multisig.refreshMultisig": "wallet.refreshMultisig",
  "wallet.connectedSites": "wallet.connectedSites",
  "wallet.discoverNfts": "wallet.discoverNfts",
  "wallet.loadActivity": "wallet.activity",
  "wallet.loadAllowances": "wallet.allowances",
  "wallet.loadBalances": "wallet.getBalances",
  "wallet.loadClassHashVerification": "wallet.verifyClassHash",
  "wallet.loadPrices": "wallet.prices",
  "wallet.loadTokenChart": "wallet.tokenChart",
  "wallet.loadWatchedNfts": "wallet.loadWatchedNfts",
};

// The two ambient readers that live outside hydration: the always-on refresh in
// the panel lifecycle (status, then the queued failure notices that
// journeys/approvals/tx-alerts-ui.ts drains behind it), and the three-second
// disclosure poll journeys/privacy/privacy-pending-poll.ts runs while a
// registration settles.
const POLLED_OUTSIDE_HYDRATION: readonly string[] = [
  "wallet.status",
  "wallet.transactionAlerts",
  "wallet.strk20State",
];

const AMBIENT_MESSAGES: readonly string[] = [
  ...new Set([...Object.values(HYDRATED_CALL_MESSAGES), ...POLLED_OUTSIDE_HYDRATION]),
];

// Ambient reads that answer without ever consulting the session: prices and
// charts are network data cached per network, not per account. Listing them
// keeps the "this handler actually reached the session" assertion honest for
// everything else.
const SESSION_FREE = new Set(["wallet.prices", "wallet.tokenChart"]);

// One user-initiated read per product line, to prove the narrowing did not
// simply switch everything to peeking. Each is reached only by a click or a
// typed value in the panel.
const USER_INITIATED: readonly string[] = [
  "wallet.detectTokens",
  "wallet.strk20PrepareRegistration",
  "wallet.reviewTransfer",
];

const CATALOG = [
  ...KEY_BOUNDARY_MESSAGES,
  ...MULTISIG_KEY_BOUNDARY_MESSAGES,
  ...STRK20_KEY_BOUNDARY_MESSAGES,
];

const catalogEntry = (type: string) => {
  const entry = CATALOG.find(
    (candidate) => candidate.message["type"] === type && candidate.negative === undefined,
  );
  if (!entry) {
    throw new Error(`no key-boundary catalog entry for ${type}`);
  }
  return entry;
};

/** How one request read the session: observations versus window renewals. */
type SessionCounts = { readonly peeks: number; readonly renewals: number };

type CountingSession = UnlockSession & {
  readonly counts: () => SessionCounts;
  readonly resetCounts: () => void;
};

// The production session, wrapped so the suite can tell the two reads apart.
// The wrapper delegates rather than reimplements, so expiry, the mirror, and
// the generation counter all behave exactly as they do in the worker.
const countingSession = (now: () => number): CountingSession => {
  const inner = createUnlockSession({ now, ttlMs: TTL_MS });
  let peeks = 0;
  let renewals = 0;
  return {
    ...inner,
    counts: () => ({ peeks, renewals }),
    getPassphrase() {
      renewals += 1;
      return inner.getPassphrase();
    },
    peekPassphrase() {
      peeks += 1;
      return inner.peekPassphrase();
    },
    resetCounts() {
      peeks = 0;
      renewals = 0;
    },
  };
};

type Probe = {
  readonly drive: (type: string) => Promise<SessionCounts>;
  readonly session: UnlockSession;
  readonly setNow: (value: number) => void;
};

const makeProbe = async (): Promise<Probe> => {
  let now = UNLOCKED_AT;
  const session = countingSession(() => now);
  // The harness unlocks and seeds its stores through the real handler before
  // returning, so the session is live by the time the counters matter; every
  // `drive` zeroes them first.
  const harness = await makeKeyBoundaryHarness({ session });
  const liveIds: KeyBoundaryLiveIds = harness.liveIds;
  return {
    async drive(type) {
      const entry = catalogEntry(type);
      const message = { ...entry.message, ...(await entry.live?.(liveIds)) };
      session.resetCounts();
      await harness.handler(message, entry.sender);
      return session.counts();
    },
    session,
    setNow(value) {
      now = value;
    },
  };
};

let probe: Probe;

beforeAll(async () => {
  probe = await makeProbe();
});

describe("panel polling cannot hold the wallet unlocked", () => {
  for (const type of AMBIENT_MESSAGES) {
    test(`${type} observes the unlock window without extending it`, async () => {
      probe.setNow(UNLOCKED_AT);
      const counts = await probe.drive(type);

      expect(counts.renewals).toBe(0);
      if (!SESSION_FREE.has(type)) {
        // Not a vacuous pass: the handler really reached the session.
        expect(counts.peeks).toBeGreaterThan(0);
      }
    });
  }

  test("a panel left open across many full inactivity windows still locks", async () => {
    const fresh = await makeProbe();

    // Ten consecutive TTL windows of pure hydration: the exact shape of a side
    // panel left visible on a desk while its owner is elsewhere.
    for (let window = 1; window <= 10; window += 1) {
      fresh.setNow(UNLOCKED_AT + window * TTL_MS - 1);
      for (const type of AMBIENT_MESSAGES) {
        await fresh.drive(type);
      }
    }

    fresh.setNow(EXPIRES_AT + 1);
    expect(fresh.session.isUnlocked()).toBe(false);
  });

  test("hydration has no loader this suite does not classify", async () => {
    const source = await readFile(HYDRATE_SOURCE, "utf8");
    const called = new Set(
      [...source.matchAll(/\b(wallet|multisig|deployment)\.([a-zA-Z]+)\(/g)].map(
        (match) => `${match[1]}.${match[2]}`,
      ),
    );

    expect([...called].filter((call) => HYDRATED_CALL_MESSAGES[call] === undefined)).toEqual([]);
  });

  test("the three ambient readers outside hydration remain classified", async () => {
    const [lifecycle, privacy, transactionAlerts] = await Promise.all([
      readFile(LIFECYCLE_SOURCE, "utf8"),
      readFile(PRIVACY_SOURCE, "utf8"),
      readFile(TRANSACTION_ALERTS_SOURCE, "utf8"),
    ]);

    expect(lifecycle.split("\n").filter((line) => line.includes("wallet.loadStatus"))).toEqual([
      "    refresh: withTransactionAlerts(document, wallet, async () => render(await wallet.loadStatus())),",
    ]);
    expect(
      transactionAlerts.split("\n").filter((line) => line.includes("wallet.loadTransactionAlerts")),
    ).toEqual(["    const alerts = await wallet.loadTransactionAlerts().catch(() => []);"]);
    expect(
      privacy.split("\n").filter((line) => line.includes("deps.wallet.loadPrivacyState")),
    ).toEqual([
      "    const value = await deps.wallet.loadPrivacyState();",
      "    load: () => deps.wallet.loadPrivacyState(),",
    ]);
  });
});

describe("the user's own actions still renew the window", () => {
  for (const type of USER_INITIATED) {
    test(`${type} extends the inactivity window`, async () => {
      probe.setNow(UNLOCKED_AT);
      const counts = await probe.drive(type);

      expect(counts.renewals).toBeGreaterThan(0);
    });
  }
});
