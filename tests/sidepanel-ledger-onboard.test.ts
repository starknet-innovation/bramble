/**
 * Coverage for Ledger onboarding: the silent multi-index enumeration (version
 * gate + serial getPubKey) against an injected fake device client, and the pure
 * onboarding view templates — the add-account chooser, connect/reading/error
 * device states, and the account picker with deployed status, balance, and
 * duplicate handling.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "../src/sidepanel/ledger/client";
import { LedgerRejection } from "../src/sidepanel/ledger/errors";
import {
  createLedgerOnboardController,
  enumerateLedgerPubKeys,
  type LedgerCandidate,
  type LedgerOnboardControllerDeps,
  type LedgerOnboardView,
} from "../src/sidepanel/ledger/onboard-session";
import {
  addAccountChooser,
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerOnboardError,
  ledgerReadingPrompt,
} from "../src/sidepanel/ledger/onboard-views";
import type { LedgerConnector } from "../src/sidepanel/ledger/sign-session";
import { ledgerAccountPath } from "../src/starknet/ledger-path";
import type { LedgerAccountRef } from "../src/storage/vault-schema";
import type { LedgerPubKeyEntry } from "../src/wallet/accounts";

const version = (major: number) => ({
  errorMessage: "No errors",
  major,
  minor: 0,
  patch: 0,
  returnCode: 0x9000,
});

// A device whose pubkey per index is deterministic (0x1, 0x2, …), so the test
// can assert the enumerated entries and that paths track their index.
const enumerateClient = (appMajor: number): LedgerDeviceClient => ({
  getAppVersion: () => Promise.resolve(version(appMajor)),
  getPubKey: (path: string) => {
    const index = Number(path.split("/").at(-1)?.replace(/'.*$/, "") ?? "0");
    return Promise.resolve({
      errorMessage: "No errors",
      publicKey: new Uint8Array([4, ...new Array(31).fill(0), index + 1, ...new Array(32).fill(0)]),
      returnCode: 0x9000,
    });
  },
  signHash: () => Promise.reject(new Error("unused")),
});

describe("enumerateLedgerPubKeys", () => {
  test("reads N indices silently after the version gate", async () => {
    const entries = await enumerateLedgerPubKeys(enumerateClient(2), 3);
    expect(entries.map((entry) => entry.accountIndex)).toEqual([0, 1, 2]);
    // Each pubkey X is a non-zero felt derived from the device bytes.
    expect(entries.every((entry) => entry.publicKeyX.startsWith("0x"))).toBe(true);
  });

  test("rejects a below-minimum app before reading any key", async () => {
    let reads = 0;
    const client: LedgerDeviceClient = {
      getAppVersion: () => Promise.resolve(version(1)),
      getPubKey: () => {
        reads += 1;
        return Promise.reject(new Error("unused"));
      },
      signHash: () => Promise.reject(new Error("unused")),
    };
    await expect(enumerateLedgerPubKeys(client, 3)).rejects.toMatchObject({
      code: "app-below-minimum",
    });
    expect(reads).toBe(0);
  });
});

const candidateAccount = (index: number): LedgerAccountRef => ({
  address: `0x${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: {
    accountIndex: index,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(index),
  },
  id: `SN_MAIN:0x${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`,
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
});

describe("onboarding views", () => {
  test("the chooser offers HD, import, and Ledger routes", () => {
    const html = addAccountChooser();
    expect(html).toContain('data-add-kind="hd"');
    expect(html).toContain('data-add-kind="import"');
    expect(html).toContain('data-add-kind="ledger"');
    expect(html).toContain("Connect a Ledger");
  });

  test("connect, reading, and error device states render their controls", () => {
    expect(ledgerConnectPrompt()).toContain("data-ledger-onboard-connect");
    expect(ledgerReadingPrompt()).toContain("Reading accounts");
    expect(ledgerOnboardError("Unlock your Ledger, then try again.")).toContain(
      "Unlock your Ledger",
    );
  });

  test("the picker shows address, deployed status, balance, and an Add control", () => {
    const candidates: LedgerCandidate[] = [
      { account: candidateAccount(0), balance: "1.5 STRK", deployed: true, duplicate: false },
    ];
    const html = ledgerAccountPicker(candidates);
    expect(html).toContain("Account 0");
    expect(html).toContain("Deployed");
    expect(html).toContain("1.5 STRK");
    expect(html).toContain('data-ledger-select="0"');
  });

  test("an undeployed candidate reflects needs-funding, distinct from an error", () => {
    const html = ledgerAccountPicker([
      { account: candidateAccount(1), balance: null, deployed: false, duplicate: false },
    ]);
    expect(html).toContain("needs funding");
    expect(html).toContain("balance unavailable");
  });

  test("a checking candidate and a duplicate render distinctly", () => {
    const checking = ledgerAccountPicker([
      { account: candidateAccount(2), balance: null, deployed: null, duplicate: false },
    ]);
    expect(checking).toContain("Checking…");

    const duplicate = ledgerAccountPicker([
      { account: candidateAccount(3), balance: "0 STRK", deployed: true, duplicate: true },
    ]);
    expect(duplicate).toContain("Already in this wallet");
    expect(duplicate).not.toContain("data-ledger-select");
  });

  test("an empty candidate list renders the empty state", () => {
    expect(ledgerAccountPicker([])).toContain("No accounts read");
  });
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const onboardHarness = (overrides: Partial<LedgerOnboardControllerDeps> = {}) => {
  const views: (LedgerOnboardView | null)[] = [];
  const created: Array<readonly [number, string]> = [];
  let refreshed = 0;
  let closed = 0;
  let cancels = 0;
  const accounts = [candidateAccount(0), candidateAccount(1)];
  // request() hands back an OWNED session; its close bumps a counter so tests
  // assert the enumeration transport is released on every outcome.
  const connector: LedgerConnector = {
    openConnected: () => Promise.resolve(null),
    request: () =>
      Promise.resolve({
        client: enumerateClient(2),
        close: () => {
          closed += 1;
          return Promise.resolve();
        },
      }),
  };
  const deps: LedgerOnboardControllerDeps = {
    connector,
    create: (index, publicKeyX) => {
      created.push([index, publicKeyX]);
      return Promise.resolve();
    },
    derive: () => Promise.resolve(accounts),
    describe: (account) =>
      Promise.resolve({ balance: "1 STRK", deployed: account.derivation.accountIndex === 0 }),
    enumerate: () =>
      Promise.resolve(
        accounts.map(
          (account): LedgerPubKeyEntry => ({
            accountIndex: account.derivation.accountIndex,
            publicKeyX: account.publicKeyX,
          }),
        ),
      ),
    existingIds: () => new Set<string>(),
    onCancel: () => {
      cancels += 1;
    },
    refresh: () => {
      refreshed += 1;
      return Promise.resolve();
    },
    render: (view) => views.push(view),
    ...overrides,
  };
  return {
    accounts,
    cancels: () => cancels,
    closed: () => closed,
    created,
    deps,
    refreshed: () => refreshed,
    views,
  };
};

const kinds = (views: readonly (LedgerOnboardView | null)[]): readonly (string | null)[] =>
  views.map((view) => (view === null ? null : view.kind));

describe("Ledger onboard controller", () => {
  test("start shows connect; connect enumerates, derives, and describes", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.start();
    expect(kinds(h.views)).toEqual(["connect"]);

    controller.connect();
    await tick();
    // reading → picker (pending state) → picker (described state).
    expect(kinds(h.views)).toEqual(["connect", "reading", "picker", "picker"]);
    const final = h.views.at(-1);
    if (final?.kind === "picker") {
      expect(final.candidates[0]?.deployed).toBe(true);
      expect(final.candidates[0]?.balance).toBe("1 STRK");
    }
  });

  test("a describe failure degrades that candidate to unavailable, not a block", async () => {
    const h = onboardHarness({ describe: () => Promise.reject(new Error("rpc down")) });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    const final = h.views.at(-1);
    if (final?.kind === "picker") {
      expect(final.candidates[0]?.balance).toBeNull();
      expect(final.candidates[0]?.deployed).toBeNull();
    }
  });

  test("existing ids mark a candidate as a duplicate", async () => {
    const h = onboardHarness({ existingIds: () => new Set([candidateAccount(0).id]) });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    const final = h.views.at(-1);
    if (final?.kind === "picker") {
      expect(final.candidates[0]?.duplicate).toBe(true);
      expect(final.candidates[1]?.duplicate).toBe(false);
    }
  });

  test("a device failure during connect shows an error state", async () => {
    const h = onboardHarness({
      enumerate: () => Promise.reject(new LedgerRejection("device-locked")),
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    const final = h.views.at(-1);
    expect(final?.kind).toBe("error");
    if (final?.kind === "error") {
      expect(final.message).toContain("Unlock your Ledger");
    }
  });

  test("select creates the chosen account, dismisses, and refreshes", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.select(1);
    await tick();
    expect(h.created).toEqual([[1, candidateAccount(1).publicKeyX]]);
    expect(h.views.at(-1)).toBeNull();
    expect(h.refreshed()).toBe(1);
  });

  test("select ignores a duplicate or an unknown index", async () => {
    const h = onboardHarness({ existingIds: () => new Set([candidateAccount(0).id]) });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.select(0); // duplicate
    controller.select(9); // unknown
    await tick();
    expect(h.created).toEqual([]);
  });

  test("a create failure surfaces the wallet error message", async () => {
    const h = onboardHarness({ create: () => Promise.reject(new Error("Account already exists")) });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.select(1);
    await tick();
    const final = h.views.at(-1);
    expect(final?.kind === "error" && final.message).toBe("Account already exists");
  });

  test("cancel dismisses the overlay and runs the onCancel hook", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.start();
    controller.cancel();
    expect(h.views.at(-1)).toBeNull();
    // The onCancel hook fired (the entry uses it to clear the setup passphrase).
    expect(h.cancels()).toBe(1);
  });

  test("closes the enumeration session after a successful connect", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    // The device is only needed for enumeration, so the transport is released
    // once the picker is populated.
    expect(h.closed()).toBe(1);
  });

  test("closes the enumeration session when enumeration fails", async () => {
    const h = onboardHarness({
      enumerate: () => Promise.reject(new LedgerRejection("device-locked")),
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    expect(h.views.at(-1)?.kind).toBe("error");
    // The transport is released even on the failure path (fail closed).
    expect(h.closed()).toBe(1);
  });
});
