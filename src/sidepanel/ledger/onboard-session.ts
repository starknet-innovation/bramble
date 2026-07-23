/**
 * Pure orchestration for Ledger onboarding: the version gate, the silent
 * PAGINATED public-key enumeration that backs the account picker, and the
 * add-account chooser dispatch. The device client is injected (the structural
 * {@link LedgerDeviceClient}), so this runs without hardware. It reads no
 * secrets and derives no key material — it only reads public keys the device
 * already holds and rebuilds each EIP-2645 path deterministically from its
 * index (one source of truth with sign-time), so a stored path always matches
 * the one used to enumerate and sign.
 *
 * Enumeration is paginated: each device round reads one PAGE of indices and the
 * controller accumulates pages, exposing `loadMore` to fetch the next page
 * (append, never refetch). The picker is multi-select — the user toggles the
 * indices they want and adds them all at once through the injected `create`
 * path. HD/import routing is injected too (`addHd`/`openImport`), so the one
 * controller can back the whole "add an account" entry, not just the device
 * subflow.
 */
import { ledgerAccountPath } from "../../starknet/ledger-path";
import type { LedgerAccountRef } from "../../storage/vault-schema";
import type { LedgerPubKeyEntry } from "../../wallet/accounts";
import { assertLedgerAppReady, type LedgerDeviceClient, ledgerPublicKeyX } from "./client";
import { asLedgerRejection, LedgerRejection, ledgerMessage } from "./errors";
import {
  closeLedgerSessionQuietly,
  type LedgerConnector,
  type LedgerDeviceChoice,
  type LedgerDeviceSession,
} from "./sign-session";

/**
 * Number of account indices read per enumeration page (a page is `start` …
 * `start + LEDGER_PAGE_SIZE - 1`). The device app only needs to be open and
 * unlocked; every read is silent (no per-index on-device button press).
 */
export const LEDGER_PAGE_SIZE = 5;

/**
 * Reads the app version (rejecting a below-minimum app with `app-below-minimum`)
 * on every call, then reads the public-key x-coordinate for one page of account
 * indices — `startIndex … startIndex + count - 1` — SILENTLY and one round-trip
 * at a time (WebHID is a serial pipe). Returns the enumerated `(index,
 * publicKeyX)` pairs for {@link LedgerOnboardController} to derive into
 * candidates. Any device/transport failure propagates as a typed
 * {@link LedgerRejection} so the caller aborts cleanly.
 */
export const enumerateLedgerPubKeys = async (
  client: LedgerDeviceClient,
  startIndex = 0,
  count: number = LEDGER_PAGE_SIZE,
): Promise<readonly LedgerPubKeyEntry[]> => {
  await assertLedgerAppReady(client);
  const entries: LedgerPubKeyEntry[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const accountIndex = startIndex + offset;
    const publicKeyX = await ledgerPublicKeyX(client, ledgerAccountPath(accountIndex));
    entries.push({ accountIndex, publicKeyX });
  }
  return entries;
};

/**
 * One enumerated candidate for the picker: the derived keyless account plus its
 * best-effort on-chain state. `deployed`/`balance` are `null` while still
 * loading or when the RPC degraded; `duplicate` marks an account already in the
 * vault so it cannot be added twice.
 */
export type LedgerCandidate = {
  readonly account: LedgerAccountRef;
  readonly balance: string | null;
  readonly deployed: boolean | null;
  readonly duplicate: boolean;
};

/**
 * The three routes the add-account chooser can dispatch: derive the next HD
 * account, jump to the raw-key import form, or open the Ledger device subflow.
 */
export type LedgerOnboardAddKind = "hd" | "import" | "ledger";

/**
 * The onboarding device-prompt view the binder renders: the add-account
 * chooser, the connect gesture, the silent read, the multi-select account
 * picker (with the currently-selected indices), or a typed error.
 */
export type LedgerOnboardView =
  | { readonly kind: "chooser" }
  | { readonly kind: "connect" }
  | { readonly kind: "devices"; readonly devices: readonly LedgerDeviceChoice[] }
  | { readonly kind: "reading" }
  | {
      readonly kind: "picker";
      readonly candidates: readonly LedgerCandidate[];
      readonly message?: string;
      readonly selected: readonly number[];
    }
  | { readonly kind: "error"; readonly message: string };

/**
 * The on-chain state of one candidate address, fetched best-effort in parallel.
 * A `null` field degrades gracefully (checking/unavailable) rather than blocking.
 */
export type LedgerCandidateState = {
  readonly balance: string | null;
  readonly deployed: boolean | null;
};

/**
 * Collaborators the onboarding controller drives, all injected so the chooser →
 * connect → enumerate → derive → describe → create flow runs without hardware or
 * a live background: the device connector, the paginated enumeration reader
 * (page start injected), the address derivation (background
 * `deriveLedgerAccounts`), the per-candidate on-chain `describe`, the set of ids
 * already in the vault (duplicate detection), the `create` call (background
 * `addLedgerAccount`/`createLedgerVault`, given the whole account so its target
 * network is unambiguous even mid-batch), a `render` sink, a `refresh` run after
 * a successful add, the HD-derive route `addHd`, the import route `openImport`,
 * and an `onCancel` hook run when the user dismisses the flow (the first-run
 * entry uses it to clear the captured setup secret).
 */
export type LedgerOnboardControllerDeps = {
  readonly addHd: () => Promise<void>;
  readonly connector: LedgerConnector;
  readonly create: (account: LedgerAccountRef) => Promise<void>;
  readonly derive: (entries: readonly LedgerPubKeyEntry[]) => Promise<readonly LedgerAccountRef[]>;
  readonly describe: (account: LedgerAccountRef) => Promise<LedgerCandidateState>;
  readonly enumerate: (
    client: LedgerDeviceClient,
    startIndex: number,
  ) => Promise<readonly LedgerPubKeyEntry[]>;
  readonly existingIds: () => ReadonlySet<string>;
  readonly onCancel: () => void;
  readonly openImport: () => void;
  readonly refresh: () => Promise<void>;
  readonly render: (view: LedgerOnboardView | null) => void;
};

/**
 * Drives the Ledger onboarding subflow. Returned by
 * {@link createLedgerOnboardController}.
 */
export type LedgerOnboardController = {
  readonly addSelected: () => void;
  readonly cancel: () => void;
  readonly choose: (kind: LedgerOnboardAddKind) => void;
  readonly chooseDevice: (deviceId: string) => void;
  readonly connect: () => void;
  readonly loadMore: () => void;
  readonly showChooser: () => void;
  readonly start: () => void;
  readonly toggle: (accountIndex: number) => void;
};

const EMPTY_STATE: LedgerCandidateState = { balance: null, deployed: null };

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
  const selected = new Set<number>();
  let nextIndex = 0;
  let busy = false;
  let flowEpoch = 0;

  const resetState = (): void => {
    flowEpoch += 1;
    candidates = [];
    createdIds.clear();
    devices = [];
    selectedDeviceId = null;
    selected.clear();
    nextIndex = 0;
  };

  const toCandidate = (account: LedgerAccountRef): LedgerCandidate => ({
    account,
    balance: null,
    deployed: null,
    duplicate: createdIds.has(account.id) || deps.existingIds().has(account.id),
  });

  const withState = (account: LedgerAccountRef, state: LedgerCandidateState): LedgerCandidate => ({
    ...toCandidate(account),
    balance: state.balance,
    deployed: state.deployed,
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
  const appendPage = (accounts: readonly LedgerAccountRef[], startIndex: number): void => {
    candidates = [...candidates, ...accounts.map(toCandidate)];
    nextIndex = startIndex + accounts.length;
    renderPicker();
  };

  // Fold resolved on-chain state back into the accumulated list by account id,
  // leaving other pages untouched, then repaint.
  const applyDescribed = (described: readonly LedgerCandidate[]): void => {
    const byId = new Map(described.map((item) => [item.account.id, item] as const));
    candidates = candidates.map((item) => byId.get(item.account.id) ?? item);
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
  // The session owns the WebHID transport so it is closed on every outcome — the
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
      const entries = await deps.enumerate(session.client, startIndex);
      await closeLedgerSessionQuietly(session);
      session = null;
      const accounts = await deps.derive(entries);
      if (epoch !== flowEpoch) {
        return;
      }
      appendPage(accounts, startIndex);
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

  const runToggle = (accountIndex: number): void => {
    const candidate = candidates.find(
      (item) => item.account.derivation.accountIndex === accountIndex,
    );
    if (!candidate || candidate.duplicate) {
      return;
    }
    if (selected.has(accountIndex)) {
      selected.delete(accountIndex);
    } else {
      selected.add(accountIndex);
    }
    renderPicker();
  };

  const runAddSelected = async (): Promise<void> => {
    const chosen = candidates.filter(
      (item) => !item.duplicate && selected.has(item.account.derivation.accountIndex),
    );
    if (busy || chosen.length === 0) {
      return;
    }
    const epoch = flowEpoch;
    busy = true;
    try {
      for (const candidate of chosen) {
        await deps.create(candidate.account);
        createdIds.add(candidate.account.id);
        selected.delete(candidate.account.derivation.accountIndex);
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

  const runChooseHd = async (): Promise<void> => {
    if (busy) {
      return;
    }
    const epoch = flowEpoch;
    busy = true;
    try {
      await deps.addHd();
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
      resetState();
      deps.render({ kind: "connect" });
    } else if (kind === "hd") {
      void runChooseHd();
    } else {
      deps.render(null);
      deps.openImport();
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
    loadMore() {
      void loadPage(obtainMore, nextIndex, false);
    },
    showChooser() {
      resetState();
      deps.render({ kind: "chooser" });
    },
    start() {
      resetState();
      deps.render({ kind: "connect" });
    },
    toggle(accountIndex) {
      runToggle(accountIndex);
    },
  };
};
