/**
 * Pure orchestration for Ledger onboarding: the version gate, the silent
 * PAGINATED public-key enumeration that backs the account picker, and the
 * add-account chooser dispatch. The device client is injected (the structural
 * {@link LedgerDeviceClient}), so this runs without hardware. It reads no
 * secrets and derives no key material — it only reads public keys the device
 * already holds and rebuilds each EIP-2645 path deterministically from its
 * index (one source of truth with sign-time), so a stored path always matches
 * the one used to enumerate and sign.
 * Enumeration is paginated: each device round reads one PAGE of indices and the
 * controller accumulates pages, exposing `loadMore` to fetch the next page
 * (append, never refetch). The account-contract-aware routes let this one
 * controller back the complete add-account entry.
 */

import {
  assertLedgerDeviceReady,
  type LedgerDeviceClient,
  ledgerPublicKeyX,
} from "@bramble/ledger-protocol/client";
import { asLedgerRejection, LedgerRejection, ledgerMessage } from "@bramble/ledger-protocol/errors";
import {
  closeLedgerSessionQuietly,
  type LedgerDeviceChoice,
  type LedgerDeviceSession,
} from "@bramble/ledger-protocol/session";
import type {
  AccountContractType,
  LedgerAccountRef,
  LedgerPubKeyEntry,
} from "@bramble/wallet-model/accounts";
import { ledgerAccountPath, MAX_LEDGER_ACCOUNT_BATCH } from "@bramble/wallet-model/ledger-path";
import {
  type LedgerCandidate,
  type LedgerCandidateState,
  type LedgerOnboardAddKind,
  type LedgerOnboardController,
  type LedgerOnboardControllerDeps,
  ledgerCandidateActive,
  ledgerCandidateSelectable,
} from "./onboard-types";

/** Re-exports the controller's documented type surface from its size-budget split. */
export type {
  LedgerCandidate,
  LedgerCandidateState,
  LedgerOnboardAddKind,
  LedgerOnboardController,
  LedgerOnboardControllerDeps,
  LedgerOnboardView,
} from "./onboard-types";

/**
 * Number of account indices read per enumeration page (a page is `start` …
 * `start + LEDGER_PAGE_SIZE - 1`). The device app only needs to be open and
 * unlocked; every read is silent (no per-index on-device button press).
 */
export const LEDGER_PAGE_SIZE = MAX_LEDGER_ACCOUNT_BATCH;

/**
 * Checks the pinned device OS and Starknet app releases unless this exact live
 * session was already verified by the grant broker, then reads the public-key
 * x-coordinate for one page of account indices — `startIndex … startIndex +
 * count - 1` — SILENTLY and one round-trip at a time (the browser transport is
 * a serial pipe). Returns the enumerated `(index, publicKeyX)` pairs for
 * {@link LedgerOnboardController} to derive into candidates. Any
 * device/transport failure propagates as a typed
 * {@link LedgerRejection} so the caller aborts cleanly.
 */
export const enumerateLedgerPubKeys = async (
  client: LedgerDeviceClient,
  startIndex = 0,
  count: number = LEDGER_PAGE_SIZE,
  readiness?: LedgerDeviceSession["readiness"],
): Promise<readonly LedgerPubKeyEntry[]> => {
  if (readiness !== "verified") {
    await assertLedgerDeviceReady(client);
  }
  const entries: LedgerPubKeyEntry[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const accountIndex = startIndex + offset;
    const publicKeyX = await ledgerPublicKeyX(client, ledgerAccountPath(accountIndex));
    entries.push({ accountIndex, publicKeyX });
  }
  return entries;
};

const EMPTY_STATE: LedgerCandidateState = { balance: null, deployed: null, funded: null };

/**
 * Creates the Ledger onboarding controller. `showChooser` opens the add-account
 * chooser; `choose` routes it (HD derive, import, or the device subflow);
 * `start` shows the connect gesture; `connect` reads the first page, enumerating
 * the device, deriving addresses through the background, and fetching each
 * candidate's on-chain state in parallel (a degraded RPC yields "unavailable"
 * rather than blocking); `loadMore` appends the next page silently; `toggle`
 * selects/deselects a non-duplicate index; `addSelected` creates every selected
 * account and refreshes. Successful items are marked duplicate immediately, so
 * a later batch failure leaves only the uncreated selection retryable instead
 * of wedging duplicate detection. Cancellation invalidates late async results.
 * Every device/transport failure maps to the typed rejection catalog and shows
 * an actionable retry.
 */
export const createLedgerOnboardController = (
  deps: LedgerOnboardControllerDeps,
): LedgerOnboardController => {
  let candidates: readonly LedgerCandidate[] = [];
  const createdIds = new Set<string>();
  let devices: readonly LedgerDeviceChoice[] = [];
  let selectedDeviceId: string | null = null;
  let selectedAddKind: LedgerOnboardAddKind | null = null;
  const selected = new Set<string>();
  let nextIndex = 0;
  let busy = false;
  let flowEpoch = 0;

  const resetState = (): void => {
    flowEpoch += 1;
    candidates = [];
    createdIds.clear();
    devices = [];
    selectedDeviceId = null;
    selectedAddKind = null;
    selected.clear();
    nextIndex = 0;
  };

  const toCandidate = (account: LedgerAccountRef): LedgerCandidate => ({
    account,
    balance: null,
    deployed: null,
    duplicate: createdIds.has(account.id) || deps.existingIds().has(account.id),
    funded: null,
  });

  const withState = (account: LedgerAccountRef, state: LedgerCandidateState): LedgerCandidate => ({
    ...toCandidate(account),
    balance: state.balance,
    deployed: state.deployed,
    funded: state.funded,
  });

  const renderPicker = (message?: string): void => {
    deps.render({
      candidates,
      kind: "picker",
      ...(message ? { message } : {}),
      selected: [...selected],
    });
  };

  // Append a freshly derived page as pending (Checking…) rows and advance the
  // page cursor, then paint so new indices appear before their on-chain state.
  const appendPage = (accounts: readonly LedgerAccountRef[], nextStartIndex: number): void => {
    candidates = [...candidates, ...accounts.map(toCandidate)];
    nextIndex = nextStartIndex;
    renderPicker();
  };

  // Fold resolved on-chain state back into the accumulated list by account id,
  // leaving other pages untouched, then repaint.
  const applyDescribed = (described: readonly LedgerCandidate[]): void => {
    const byId = new Map(described.map((item) => [item.account.id, item] as const));
    candidates = candidates.map((item) => byId.get(item.account.id) ?? item);
    // Every active account is selected by default; the user deselects rather
    // than hunts. Runs once per candidate (when its on-chain state resolves).
    for (const item of described) {
      if (ledgerCandidateActive(item) && ledgerCandidateSelectable(item)) {
        selected.add(item.account.id);
      }
    }
    renderPicker();
  };

  const describePage = async (
    accounts: readonly LedgerAccountRef[],
  ): Promise<readonly LedgerCandidate[]> =>
    Promise.all(
      accounts.map(async (account) =>
        withState(account, await deps.describe(account).catch(() => EMPTY_STATE)),
      ),
    );

  // Reads one page end to end: obtain a session, enumerate the page SILENTLY,
  // release the transport (account state + creation are background ops, no
  // device), derive addresses, append them pending, then fold in on-chain state.
  // The session owns the browser transport so it is closed on every outcome — the
  // device is never left claimed — and any failure maps to a typed error state.
  const loadPage = async (
    obtain: () => Promise<LedgerDeviceSession>,
    startIndex: number,
    initial: boolean,
  ): Promise<void> => {
    if (busy) {
      return;
    }
    const epoch = flowEpoch;
    busy = true;
    if (initial) {
      deps.render({ kind: "reading" });
    }
    let session: LedgerDeviceSession | null = null;
    try {
      session = await obtain();
      const entries = await deps.enumerate(session.client, startIndex, session.readiness);
      await closeLedgerSessionQuietly(session);
      session = null;
      // Both contract families derive from the same device keys, so the picker
      // can group existing Bramble and Ready accounts side by side.
      const [bramble, ready] = await Promise.all([
        deps.derive(entries, "openzeppelin"),
        deps.derive(entries, "argent"),
      ]);
      const accounts = [...bramble, ...ready];
      if (epoch !== flowEpoch) {
        return;
      }
      appendPage(accounts, startIndex + entries.length);
      const described = await describePage(accounts);
      if (epoch === flowEpoch) {
        applyDescribed(described);
      }
    } catch (error) {
      if (epoch === flowEpoch) {
        deps.render({ kind: "error", message: ledgerMessage(asLedgerRejection(error).code) });
      }
    } finally {
      if (session) {
        await closeLedgerSessionQuietly(session);
      }
      busy = false;
    }
  };

  // The first page runs the gesture-gated picker; further pages reconnect the
  // already-granted device SILENTLY, falling back to the picker only if the
  // device is no longer connected (the "Show more" click supplies the gesture).
  const obtainConnected = async (deviceId?: string): Promise<LedgerDeviceSession> =>
    (await deps.connector.openConnected(deviceId)) ?? deps.connector.request();

  const obtainMore = async (): Promise<LedgerDeviceSession> =>
    obtainConnected(selectedDeviceId ?? undefined);

  const startConnect = (): void => {
    resetState();
    const epoch = flowEpoch;
    const list = deps.connector.listConnected;
    if (!list) {
      void loadPage(() => deps.connector.request(), 0, true);
      return;
    }
    busy = true;
    deps.render({ kind: "reading" });
    void list().then(
      (connected) => {
        busy = false;
        if (epoch !== flowEpoch) {
          return;
        }
        devices = connected;
        if (connected.length > 1) {
          deps.render({ devices: connected, kind: "devices" });
          return;
        }
        selectedDeviceId = connected[0]?.id ?? null;
        void loadPage(
          () => (selectedDeviceId ? obtainConnected(selectedDeviceId) : deps.connector.request()),
          0,
          true,
        );
      },
      (error) => {
        busy = false;
        if (epoch === flowEpoch) {
          deps.render({ kind: "error", message: ledgerMessage(asLedgerRejection(error).code) });
        }
      },
    );
  };

  const chooseDevice = (deviceId: string): void => {
    if (busy || !devices.some((device) => device.id === deviceId)) {
      return;
    }
    selectedDeviceId = deviceId;
    void loadPage(
      async () => {
        const session = await deps.connector.openConnected(deviceId);
        if (!session) {
          throw new LedgerRejection("disconnected-mid-sign");
        }
        return session;
      },
      0,
      true,
    );
  };

  const runToggle = (accountId: string): void => {
    const candidate = candidates.find((item) => item.account.id === accountId);
    if (!candidate || !ledgerCandidateSelectable(candidate)) {
      return;
    }
    if (selected.has(accountId)) {
      selected.delete(accountId);
    } else {
      selected.add(accountId);
    }
    renderPicker();
  };

  const runAddSelected = async (): Promise<void> => {
    const chosen = candidates.filter((item) => !item.duplicate && selected.has(item.account.id));
    if (busy || chosen.length === 0) {
      return;
    }
    const epoch = flowEpoch;
    busy = true;
    try {
      for (const candidate of chosen) {
        await deps.create(candidate.account);
        createdIds.add(candidate.account.id);
        selected.delete(candidate.account.id);
        candidates = candidates.map((item) =>
          item.account.id === candidate.account.id ? { ...item, duplicate: true } : item,
        );
        if (epoch !== flowEpoch) {
          await deps.refresh();
          return;
        }
        renderPicker();
      }
      resetState();
      deps.render(null);
      await deps.refresh();
    } catch (error) {
      // Creating a keyless account is a background op (no device), so a failure
      // here is a wallet error (duplicate, locked) — surface its message, not a
      // device-catalog message.
      const message = error instanceof Error ? error.message : "Could not add the account.";
      await deps.refresh().catch(() => undefined);
      if (epoch === flowEpoch) {
        renderPicker(message);
      }
    } finally {
      busy = false;
    }
  };

  const runChooseHd = async (contractType: AccountContractType): Promise<void> => {
    if (busy) {
      return;
    }
    const epoch = flowEpoch;
    busy = true;
    try {
      await deps.addHd(contractType);
      if (epoch !== flowEpoch) {
        await deps.refresh();
        return;
      }
      resetState();
      deps.render(null);
      await deps.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not add the account.";
      deps.render({ kind: "error", message });
    } finally {
      busy = false;
    }
  };

  const choose = (kind: LedgerOnboardAddKind): void => {
    if (kind === "ledger") {
      // The Ledger route serves creation and import alike: the picker lists
      // what the device key derives, existing accounts included.
      resetState();
      deps.render({ kind: "connect" });
    } else if (kind === "regular") {
      void runChooseHd("openzeppelin");
    } else if (kind === "import") {
      deps.render(null);
      deps.openImport();
    } else {
      deps.render(null);
      deps.openMultisig();
    }
  };

  return {
    addSelected() {
      void runAddSelected();
    },
    cancel() {
      resetState();
      deps.onCancel();
      deps.render(null);
    },
    choose,
    chooseDevice,
    connect() {
      startConnect();
    },
    continueChoice() {
      if (selectedAddKind) {
        choose(selectedAddKind);
      }
    },
    loadMore() {
      void loadPage(obtainMore, nextIndex, false);
    },
    select(kind) {
      selectedAddKind = kind;
      deps.render({ kind: "chooser", selected: kind });
    },
    showChooser() {
      resetState();
      deps.render({ kind: "chooser", selected: null });
    },
    start() {
      resetState();
      deps.render({ kind: "connect" });
    },
    toggle(accountId) {
      runToggle(accountId);
    },
  };
};
