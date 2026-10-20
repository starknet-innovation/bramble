/**
 * Pure orchestration for Ledger onboarding: the version gate, the silent
 * PAGINATED public-key enumeration that backs the account picker, and the
 * add-account chooser dispatch. The device client is injected (the structural
 * {@link LedgerDeviceClient}), so this runs without hardware. It reads no
 * secrets and derives no key material — it only reads public keys the device
 * already holds and rebuilds each EIP-2645 path deterministically from its
 * index and path scheme (one source of truth with sign-time), so a stored path
 * always matches the one used to enumerate and sign.
 * Enumeration is paginated: each device round reads one PAGE of indices and the
 * controller accumulates pages, exposing `loadMore` to fetch the next page
 * (append, never refetch). The route picks the path schemes: the Ledger route
 * reads Bramble's own `LedgerW` scheme and derives Bramble and Argent accounts
 * from those keys; the Ready-restore route reads Ready's `argentx` scheme — a
 * different device key per index — where both Ready and Braavos keep their
 * Ledger accounts; first-run setup reads both, so a new Ledger wallet finds
 * every family the recovery-phrase scan does. Each candidate stores the scheme
 * it was read at, so a picker spanning two schemes still creates (and later
 * signs) every account at its own path.
 */

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
import {
  LEDGER_EIP2645_APPLICATION,
  type LedgerEip2645Application,
  READY_EIP2645_APPLICATION,
} from "@bramble/wallet-model/ledger-path";
import { friendlyError } from "../../runtime/friendly-error";
import { ADD_ACCOUNT_FAILED } from "../../runtime/friendly-error-shared";
import {
  type LedgerCandidate,
  type LedgerCandidateState,
  type LedgerOnboardAddKind,
  type LedgerOnboardController,
  type LedgerOnboardControllerDeps,
  ledgerCandidateActive,
  ledgerCandidateSelectable,
} from "./onboard-types";

/** Re-exports device enumeration from its size-budget split. */
export { enumerateLedgerPubKeys, LEDGER_PAGE_SIZE } from "./onboard-enumerate";
/** Re-exports the controller's documented type surface from its size-budget split. */
export type {
  LedgerCandidate,
  LedgerCandidateState,
  LedgerOnboardAddKind,
  LedgerOnboardController,
  LedgerOnboardControllerDeps,
  LedgerOnboardView,
} from "./onboard-types";

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
 * an actionable retry. The chosen route fixes the path schemes for the whole
 * flow (every page, every derived candidate, every created account).
 */
export const createLedgerOnboardController = (
  deps: LedgerOnboardControllerDeps,
): LedgerOnboardController => {
  let candidates: readonly LedgerCandidate[] = [];
  const createdIds = new Set<string>();
  let devices: readonly LedgerDeviceChoice[] = [];
  let selectedDeviceId: string | null = null;
  // Set by the route that opens the connect prompt, deliberately outside
  // resetState so a reconnect or a "Show more" page keeps reading the schemes
  // the user chose. `application` picks the picker's layout; `schemes` lists
  // every path each page is read at.
  let application: LedgerEip2645Application = LEDGER_EIP2645_APPLICATION;
  let schemes: readonly LedgerEip2645Application[] = [LEDGER_EIP2645_APPLICATION];

  const selected = new Set<string>();
  let nextIndex = 0;
  let busy = false;
  let flowEpoch = 0;
  // "Show more" while a page is still read or described is queued, not dropped
  // by the busy guard; the button stays busy until the next page is in.
  let pageLoading = false;
  let readingMore = false;
  let moreQueued = false;

  const resetState = (): void => {
    flowEpoch += 1;
    candidates = [];
    createdIds.clear();
    devices = [];
    selectedDeviceId = null;
    selected.clear();
    nextIndex = 0;
    moreQueued = false;
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
      application,
      candidates,
      kind: "picker",
      loadingMore: moreQueued || readingMore,
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
    pageLoading = true;
    readingMore = !initial;
    if (initial) {
      deps.render({ kind: "reading" });
    }
    let session: LedgerDeviceSession | null = null;
    try {
      session = await obtain();
      // One device round per scheme, in order: the transport is a serial pipe.
      const pages: (readonly [LedgerEip2645Application, readonly LedgerPubKeyEntry[]])[] = [];
      for (const scheme of schemes) {
        pages.push([
          scheme,
          await deps.enumerate(session.client, startIndex, session.readiness, scheme),
        ]);
      }
      await closeLedgerSessionQuietly(session);
      session = null;
      // Ready and Braavos both own their Ledger accounts at the `argentx`
      // scheme, so a key read there derives one account of each family — the
      // same device key, two classes, two addresses — and the on-chain probe
      // reveals which is live. Under Bramble's scheme the device key derives an
      // OpenZeppelin and an Argent account, grouped side by side.
      const accounts = (
        await Promise.all(
          pages.flatMap(([scheme, entries]) =>
            (scheme === READY_EIP2645_APPLICATION
              ? (["argent", "braavos"] as const)
              : (["openzeppelin", "argent"] as const)
            ).map((family) => deps.derive(entries, family, scheme)),
          ),
        )
      ).flat();
      if (epoch !== flowEpoch) {
        return;
      }
      readingMore = false;
      appendPage(accounts, startIndex + (pages[0]?.[1].length ?? 0));
      const described = await describePage(accounts);
      if (epoch === flowEpoch) {
        applyDescribed(described);
      }
    } catch (error) {
      moreQueued = false;
      if (epoch === flowEpoch) {
        deps.render({ kind: "error", message: ledgerMessage(asLedgerRejection(error).code) });
      }
    } finally {
      if (session) {
        await closeLedgerSessionQuietly(session);
      }
      busy = false;
      pageLoading = false;
      readingMore = false;
      if (moreQueued && epoch === flowEpoch) {
        moreQueued = false;
        void loadPage(obtainMore, nextIndex, false);
      }
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
      // here is a wallet error (duplicate, locked, a Braavos key with no
      // account), never a device-catalog message. The background replies with
      // a raw diagnostic, so it is translated before it reaches the picker;
      // the wallet's own plumbing reads as "couldn't add that account".
      const message = friendlyError(
        error instanceof Error ? error.message : "",
        ADD_ACCOUNT_FAILED,
      ).message;
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
      const message = friendlyError(
        error instanceof Error ? error.message : "",
        ADD_ACCOUNT_FAILED,
      ).message;
      deps.render({ kind: "error", message });
    } finally {
      busy = false;
    }
  };

  const openConnect = (
    scheme: LedgerEip2645Application,
    read: readonly LedgerEip2645Application[] = [scheme],
  ): void => {
    resetState();
    application = scheme;
    schemes = read;
    deps.render({ kind: "connect" });
  };

  const choose = (kind: LedgerOnboardAddKind): void => {
    if (kind === "ledger") {
      // The Ledger route serves creation and import alike: the picker lists
      // what the device key derives, existing accounts included.
      openConnect(LEDGER_EIP2645_APPLICATION);
    } else if (kind === "restore-ready-ledger") {
      // Ready reads the same device at its own path, so its accounts are
      // invisible under Bramble's scheme; this route reads Ready's instead.
      openConnect(READY_EIP2645_APPLICATION);
    } else if (kind === "regular") {
      void runChooseHd("openzeppelin");
    } else if (kind === "import") {
      deps.render({ kind: "import-chooser" });
    } else if (kind === "find-accounts") {
      // Rescans the phrase this wallet already holds; the panel types nothing.
      deps.render(null);
      deps.openFindAccounts();
    } else if (kind === "import-phrase") {
      deps.render(null);
      deps.openImportSeed();
    } else if (kind === "import-key") {
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
    loadMore() {
      if (pageLoading) {
        moreQueued = true;
        renderPicker();
        return;
      }
      void loadPage(obtainMore, nextIndex, false);
    },
    showChooser() {
      resetState();
      deps.render({ kind: "chooser" });
    },
    start() {
      // First-run "Set up with a Ledger" creates Bramble accounts and finds
      // existing Ready and Braavos ones, as a recovery-phrase setup does.
      openConnect(LEDGER_EIP2645_APPLICATION, [
        LEDGER_EIP2645_APPLICATION,
        READY_EIP2645_APPLICATION,
      ]);
    },
    toggle(accountId) {
      runToggle(accountId);
    },
  };
};
