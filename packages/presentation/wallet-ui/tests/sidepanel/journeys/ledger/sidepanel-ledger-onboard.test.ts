/**
 * Coverage for Ledger onboarding: the silent PAGINATED multi-index enumeration
 * (version gate + serial getPubKey per page) against an injected fake device
 * client and the controller: connect reads the first page, "Show more" appends
 * the next, toggling selects indexes, "Add selected" adds exactly those, and
 * the chooser routes HD/import/ledger. Pure template coverage lives in
 * `sidepanel-ledger-onboard-views.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import type { LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import {
  createLedgerOnboardController,
  enumerateLedgerPubKeys,
  type LedgerOnboardControllerDeps,
  type LedgerOnboardView,
} from "../../../../src/sidepanel/journeys/ledger/onboard-session";
import type { LedgerConnector } from "../../../../src/sidepanel/journeys/ledger/sign-session";

const version = (major: number) => ({
  errorMessage: "No errors",
  major,
  minor: major === 2 ? 4 : 0,
  patch: 0,
  returnCode: 0x9000,
});

// A device whose pubkey per index is deterministic (0x1, 0x2, …), so the test
// can assert the enumerated entries and that paths track their index.
const enumerateClient = (appMajor: number): LedgerDeviceClient => ({
  getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
  getAppVersion: () => Promise.resolve(version(appMajor)),
  getPubKey: (path: string) => {
    const index = Number(path.split("/").at(-1)?.replace(/'.*$/, "") ?? "0");
    return Promise.resolve({
      errorMessage: "No errors",
      publicKey: new Uint8Array([...new Array(31).fill(0), index + 1, ...new Array(32).fill(0)]),
      returnCode: 0x9000,
    });
  },
  signHash: () => Promise.reject(new Error("unused")),
});

describe("enumerateLedgerPubKeys", () => {
  test("reads a page of indices silently after the version gate", async () => {
    const entries = await enumerateLedgerPubKeys(enumerateClient(2), 0, 3);
    expect(entries.map((entry) => entry.accountIndex)).toEqual([0, 1, 2]);
    // Each pubkey X is a non-zero felt derived from the device bytes.
    expect(entries.every((entry) => entry.publicKeyX.startsWith("0x"))).toBe(true);
  });

  test("a later page reads the next slice of indices (5-9)", async () => {
    const entries = await enumerateLedgerPubKeys(enumerateClient(2), 5, 5);
    expect(entries.map((entry) => entry.accountIndex)).toEqual([5, 6, 7, 8, 9]);
  });

  test("rejects a below-minimum app before reading any key", async () => {
    let reads = 0;
    const client: LedgerDeviceClient = {
      getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
      getAppVersion: () => Promise.resolve(version(1)),
      getPubKey: () => {
        reads += 1;
        return Promise.reject(new Error("unused"));
      },
      signHash: () => Promise.reject(new Error("unused")),
    };
    await expect(enumerateLedgerPubKeys(client, 0, 3)).rejects.toMatchObject({
      code: "app-below-minimum",
    });
    expect(reads).toBe(0);
  });
});

const candidateAccount = (index: number): LedgerAccountRef => ({
  accountContractType: "openzeppelin",
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
  publicKeyX: `0x${index + 1}`,
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const onboardHarness = (overrides: Partial<LedgerOnboardControllerDeps> = {}) => {
  const views: (LedgerOnboardView | null)[] = [];
  const created: number[] = [];
  let refreshed = 0;
  let closed = 0;
  let cancels = 0;
  let hdAdds = 0;
  let imports = 0;
  let multisigs = 0;
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
    addHd: () => {
      hdAdds += 1;
      return Promise.resolve();
    },
    connector,
    create: (account) => {
      created.push(account.derivation.accountIndex);
      return Promise.resolve();
    },
    derive: (entries) =>
      Promise.resolve(entries.map((entry) => candidateAccount(entry.accountIndex))),
    describe: (account) =>
      Promise.resolve({ balance: "1 STRK", deployed: account.derivation.accountIndex === 0 }),
    enumerate: (_client, startIndex) =>
      Promise.resolve([0, 1].map((offset) => candidateAccount(startIndex + offset))).then(
        (accounts) =>
          accounts.map((account) => ({
            accountIndex: account.derivation.accountIndex,
            publicKeyX: account.publicKeyX,
          })),
      ),
    existingIds: () => new Set<string>(),
    onCancel: () => {
      cancels += 1;
    },
    openImport: () => {
      imports += 1;
    },
    openMultisig: () => {
      multisigs += 1;
    },
    refresh: () => {
      refreshed += 1;
      return Promise.resolve();
    },
    render: (view) => views.push(view),
    ...overrides,
  };
  return {
    cancels: () => cancels,
    closed: () => closed,
    created,
    deps,
    hdAdds: () => hdAdds,
    imports: () => imports,
    multisigs: () => multisigs,
    refreshed: () => refreshed,
    views,
  };
};

const kinds = (views: readonly (LedgerOnboardView | null)[]): readonly (string | null)[] =>
  views.map((view) => (view === null ? null : view.kind));

const pickerIndexes = (view: LedgerOnboardView | null | undefined): readonly number[] => {
  if (view?.kind !== "picker") {
    throw new Error("expected a picker view");
  }
  return view.candidates.map((candidate) => candidate.account.derivation.accountIndex);
};

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

  test("multiple granted devices require an explicit choice before enumeration", async () => {
    let openedId: string | undefined;
    const h = onboardHarness({
      connector: {
        listConnected: () =>
          Promise.resolve([
            { id: "first", label: "Ledger Nano X 1" },
            { id: "second", label: "Ledger Nano X 2" },
          ]),
        openConnected: (deviceId) => {
          openedId = deviceId;
          return Promise.resolve({ client: enumerateClient(2), close: () => Promise.resolve() });
        },
        request: () => Promise.reject(new Error("no picker expected")),
      },
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();

    expect(h.views.at(-1)?.kind).toBe("devices");
    expect(openedId).toBeUndefined();

    controller.chooseDevice("second");
    await tick();
    expect(openedId).toBe("second");
    expect(h.views.at(-1)?.kind).toBe("picker");
  });

  test("loadMore appends the next page of indexes (5-9) without refetching", async () => {
    let reconnects = 0;
    const connector: LedgerConnector = {
      openConnected: () => {
        reconnects += 1;
        return Promise.resolve({ client: enumerateClient(2), close: () => Promise.resolve() });
      },
      request: () =>
        Promise.resolve({ client: enumerateClient(2), close: () => Promise.resolve() }),
    };
    const h = onboardHarness({
      connector,
      enumerate: (_client, startIndex) =>
        Promise.resolve(
          Array.from({ length: 5 }, (_unused, offset) => ({
            accountIndex: startIndex + offset,
            publicKeyX: candidateAccount(startIndex + offset).publicKeyX,
          })),
        ),
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    expect(pickerIndexes(h.views.at(-1))).toEqual([0, 1, 2, 3, 4]);

    controller.loadMore();
    await tick();
    // The next page is appended to the first, not refetched from index 0.
    expect(pickerIndexes(h.views.at(-1))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // "Show more" reconnected the already-granted device silently.
    expect(reconnects).toBe(1);
  });

  test("toggle selects indexes and addSelected adds exactly those, then refreshes", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.toggle(0);
    controller.toggle(1);
    controller.addSelected();
    await tick();
    expect(h.created).toEqual([0, 1]);
    expect(h.views.at(-1)).toBeNull();
    expect(h.refreshed()).toBe(1);
  });

  test("addSelected skips a duplicate and adds only the selectable pick", async () => {
    const h = onboardHarness({ existingIds: () => new Set([candidateAccount(0).id]) });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.toggle(0); // duplicate — ignored
    controller.toggle(1);
    controller.addSelected();
    await tick();
    expect(h.created).toEqual([1]);
  });

  test("addSelected with nothing selected is a no-op that stays on the picker", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.addSelected();
    await tick();
    expect(h.created).toEqual([]);
    expect(h.views.at(-1)?.kind).toBe("picker");
  });

  test("toggling an index twice deselects it", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.toggle(1);
    controller.toggle(1);
    const final = h.views.at(-1);
    expect(final?.kind === "picker" && final.selected).toEqual([]);
  });

  test("a create failure stays on the picker with the wallet error message", async () => {
    const h = onboardHarness({ create: () => Promise.reject(new Error("Account already exists")) });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.toggle(1);
    controller.addSelected();
    await tick();
    const final = h.views.at(-1);
    expect(final?.kind).toBe("picker");
    expect(final?.kind === "picker" && final.message).toBe("Account already exists");
    expect(h.refreshed()).toBe(1);
  });

  test("a partial batch marks completed accounts and leaves only the failed remainder retryable", async () => {
    let attempts = 0;
    const h = onboardHarness({
      create: (account) => {
        attempts += 1;
        if (attempts === 2) {
          return Promise.reject(new Error("temporary write failure"));
        }
        h.created.push(account.derivation.accountIndex);
        return Promise.resolve();
      },
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.toggle(0);
    controller.toggle(1);
    controller.addSelected();
    await tick();

    const final = h.views.at(-1);
    expect(h.created).toEqual([0]);
    expect(final?.kind).toBe("picker");
    if (final?.kind === "picker") {
      expect(final.message).toBe("temporary write failure");
      expect(final.selected).toEqual([1]);
      expect(final.candidates[0]?.duplicate).toBe(true);
      expect(final.candidates[1]?.duplicate).toBe(false);
    }

    controller.addSelected();
    await tick();
    expect(h.created).toEqual([0, 1]);
    expect(h.views.at(-1)).toBeNull();
  });

  test("cancel ignores a late enumeration result and never resurrects the overlay", async () => {
    let resolveEntries: (entries: readonly { accountIndex: number; publicKeyX: string }[]) => void =
      () => undefined;
    const h = onboardHarness({
      enumerate: () =>
        new Promise((resolve) => {
          resolveEntries = resolve;
        }),
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.cancel();
    resolveEntries([{ accountIndex: 0, publicKeyX: "0x1" }]);
    await tick();

    expect(h.views.at(-1)).toBeNull();
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
    // once the page is read.
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

describe("add-account chooser routing", () => {
  test("showChooser renders the chooser and a Ledger choice opens connect", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    expect(h.views.at(-1)).toEqual({ kind: "chooser", selected: null });
    controller.choose("ledger-openzeppelin");
    expect(h.views.at(-1)?.kind).toBe("connect");
  });

  test("selection requires Continue and routes Multisig without mutating the wallet", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.select("multisig");
    expect(h.views.at(-1)).toEqual({ kind: "chooser", selected: "multisig" });
    expect(h.multisigs()).toBe(0);
    controller.continueChoice();
    expect(h.views.at(-1)).toBeNull();
    expect(h.multisigs()).toBe(1);
    expect(h.hdAdds()).toBe(0);
  });

  test("choose('import') dismisses the overlay and routes to the import form", () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.choose("import");
    expect(h.views.at(-1)).toBeNull();
    expect(h.imports()).toBe(1);
  });

  test("an OpenZeppelin choice derives an HD account, dismisses, and refreshes", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.choose("openzeppelin");
    await tick();
    expect(h.hdAdds()).toBe(1);
    expect(h.views.at(-1)).toBeNull();
    expect(h.refreshed()).toBe(1);
  });

  test("an OpenZeppelin choice surfaces the wallet error when derivation fails", async () => {
    const h = onboardHarness({ addHd: () => Promise.reject(new Error("wallet locked")) });
    const controller = createLedgerOnboardController(h.deps);
    controller.showChooser();
    controller.choose("openzeppelin");
    await tick();
    const final = h.views.at(-1);
    expect(final?.kind === "error" && final.message).toBe("wallet locked");
  });
});
