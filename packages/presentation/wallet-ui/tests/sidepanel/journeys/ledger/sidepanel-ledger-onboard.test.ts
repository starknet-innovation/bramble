/**
 * Coverage for the Ledger onboarding controller: connect reads the first
 * page, "Show more" appends the next, toggling selects account ids, "Add
 * selected" adds exactly those, and active accounts self-select. Enumeration
 * is covered in `sidepanel-ledger-enumerate.test.ts`, the chooser routes in
 * `sidepanel-ledger-chooser.test.ts`, and pure templates in
 * `sidepanel-ledger-onboard-views.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { LedgerRejection } from "@bramble/ledger-protocol/errors";
import { createLedgerOnboardController } from "../../../../src/sidepanel/journeys/ledger/onboard-session";
import type { LedgerConnector } from "../../../../src/sidepanel/journeys/ledger/sign-session";
import {
  candidateAccount,
  enumerateClient,
  idOf,
  kinds,
  onboardHarness,
  pickerIndexes,
  tick,
} from "../../../support/ledger-onboard-harness";

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
      expect(final.candidates[0]?.deployed).toBe(false);
      expect(final.candidates[0]?.balance).toBe("0 STRK");
      // Both contract families derive from the same device keys.
      expect(pickerIndexes(final, "openzeppelin")).toEqual([0, 1]);
      expect(pickerIndexes(final, "argent")).toEqual([0, 1]);
    }
  });

  test("active accounts are selected automatically once described", async () => {
    const h = onboardHarness({
      describe: (account) =>
        Promise.resolve(
          account.derivation.accountIndex === 0
            ? { balance: "1.5 STRK", deployed: true, funded: true }
            : { balance: "0 STRK", deployed: false, funded: false },
        ),
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    const final = h.views.at(-1);
    expect(final?.kind === "picker" && [...final.selected].sort()).toEqual(
      [idOf(0), idOf(0, "argent")].sort(),
    );
  });

  test("an inactive Ready candidate cannot be selected", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.toggle(idOf(0, "argent"));
    const final = h.views.at(-1);
    // Importing an idle Ready account would deploy a brand-new Ready account.
    expect(final?.kind === "picker" && final.selected).toEqual([]);
    // An active Ready candidate stays importable.
    const active = onboardHarness({
      describe: () => Promise.resolve({ balance: "2 STRK", deployed: true, funded: true }),
    });
    const activeController = createLedgerOnboardController(active.deps);
    activeController.connect();
    await tick();
    const view = active.views.at(-1);
    expect(view?.kind === "picker" && view.selected.includes(idOf(1, "argent"))).toBe(true);
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

  test('"Show more" while a page is still being described is queued, not dropped', async () => {
    // The device read finishes before the on-chain lookups do; a click in that
    // window used to hit the busy guard and vanish after the button showed it.
    const pending: (() => void)[] = [];
    const starts: number[] = [];
    const h = onboardHarness({
      describe: () =>
        new Promise((resolve) => {
          pending.push(() => resolve({ balance: "0 STRK", deployed: false, funded: false }));
        }),
      enumerate: (_client, startIndex) => {
        starts.push(startIndex);
        return Promise.resolve(
          [0, 1].map((offset) => ({
            accountIndex: startIndex + offset,
            publicKeyX: candidateAccount(startIndex + offset).publicKeyX,
          })),
        );
      },
    });
    const controller = createLedgerOnboardController(h.deps);
    const loadingMore = (): boolean | undefined => {
      const view = h.views.at(-1);
      return view?.kind === "picker" ? view.loadingMore : undefined;
    };
    controller.connect();
    await tick();
    controller.loadMore();
    expect(starts).toEqual([0]);
    expect(loadingMore()).toBe(true);

    for (const resolve of pending.splice(0)) resolve();
    await tick();
    // The queued page is read as soon as the first settles; still busy until it lands.
    expect(starts).toEqual([0, 2]);
    for (const resolve of pending.splice(0)) resolve();
    await tick();
    expect(pickerIndexes(h.views.at(-1))).toEqual([0, 1, 2, 3]);
    expect(loadingMore()).toBe(false);
  });

  test("toggle selects indexes and addSelected adds exactly those, then refreshes", async () => {
    const h = onboardHarness();
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.toggle(idOf(0));
    controller.toggle(idOf(1));
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
    controller.toggle(idOf(0)); // duplicate — ignored
    controller.toggle(idOf(1));
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
    controller.toggle(idOf(1));
    controller.toggle(idOf(1));
    const final = h.views.at(-1);
    expect(final?.kind === "picker" && final.selected).toEqual([]);
  });

  test("a create failure stays on the picker with the wallet error message", async () => {
    const h = onboardHarness({ create: () => Promise.reject(new Error("Account already exists")) });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    await tick();
    controller.toggle(idOf(1));
    controller.addSelected();
    await tick();
    const final = h.views.at(-1);
    expect(final?.kind).toBe("picker");
    expect(final?.kind === "picker" && final.message).toBe("Account already exists");
    expect(h.refreshed()).toBe(1);
  });

  test("a vault input check reads as the add-account sentence, a bad device key keeps its fact (#652)", async () => {
    for (const [raw, shown] of [
      ["Invalid Ledger account index", "Couldn't add that account. Try again."],
      ["Invalid Ledger path application", "Couldn't add that account. Try again."],
      ["Invalid Starknet network", "Couldn't add that account. Try again."],
      [
        "Invalid Ledger public key",
        "Your Ledger returned a public key Bramble can't use. Nothing was added.",
      ],
    ] as const) {
      const h = onboardHarness({ create: () => Promise.reject(new Error(raw)) });
      const controller = createLedgerOnboardController(h.deps);
      controller.connect();
      await tick();
      controller.toggle(idOf(0));
      controller.addSelected();
      await tick();
      const final = h.views.at(-1);
      expect(final?.kind === "picker" && final.message).toBe(shown);
    }
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
    controller.toggle(idOf(0));
    controller.toggle(idOf(1));
    controller.addSelected();
    await tick();

    const final = h.views.at(-1);
    expect(h.created).toEqual([0]);
    expect(final?.kind).toBe("picker");
    if (final?.kind === "picker") {
      // An unmapped lowercase diagnostic is never shown raw in the picker.
      expect(final.message).toBe("Couldn't add that account. Try again.");
      expect(final.selected).toEqual([idOf(1)]);
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
