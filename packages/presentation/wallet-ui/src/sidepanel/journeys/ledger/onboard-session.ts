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

import {
  asLedgerRejection,
  LedgerRejection,
  ledgerErrorSupportCode,
} from "@bramble/ledger-protocol/errors";
import { ledgerMessageIn } from "@bramble/ledger-protocol/errors-i18n";
import type { LedgerDeviceChoice, LedgerDeviceSession } from "@bramble/ledger-protocol/session";
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
import { localizeErrorCopy } from "../../../i18n/error-copy";
import { uiLocale } from "../../../i18n/locale";
import { friendlyError } from "../../runtime/friendly-error";
import { ADD_ACCOUNT_FAILED, isPhraselessAddRefusal } from "../../runtime/friendly-error-shared";
import { createLedgerDeviceGate, isLedgerReadAborted } from "./device-gate";
import {
  type LedgerCandidate,
  type LedgerCandidateState,
  type LedgerOnboardAddKind,
  type LedgerOnboardController,
  type LedgerOnboardControllerDeps,
  type LedgerOnboardView,
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
  let pageLoading = false;
  let readingMore = false;
  let moreQueued = false; // "Show more" mid-page is queued; the button stays busy.
  let pendingConnect = false;
  let listTicket = 0;
  let listing = false; // `busy` held only by a listing; Cancel/Connect may drop it.
  const gate = createLedgerDeviceGate();

  const deviceError = (error: unknown): Extract<LedgerOnboardView, { kind: "error" }> => {
    const rejection = asLedgerRejection(error);
    const supportCode = ledgerErrorSupportCode(rejection);
    return {
      kind: "error",
      message: ledgerMessageIn(rejection.code, uiLocale()),
      ...(supportCode ? { supportCode } : {}),
    };
  };

  const flushConnect = (): void => {
    if (!pendingConnect || busy || gate.isBusy()) return;
    pendingConnect = false;
    startConnect();
  };

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

  // One page: the gate opens, reads, and closes the device before derivation.
  const loadPage = async (
    obtain: () => Promise<LedgerDeviceSession>,
    startIndex: number,
    initial: boolean,
  ): Promise<void> => {
    if (busy || gate.isBusy()) {
      return;
    }
    const epoch = flowEpoch;
    busy = true;
    pageLoading = true;
    readingMore = !initial;
    if (initial) {
      deps.render({ kind: "reading" });
    }
    try {
      const pages = await gate.read(obtain, async (session) => {
        const read: (readonly [LedgerEip2645Application, readonly LedgerPubKeyEntry[]])[] = [];
        for (const scheme of schemes) {
          read.push([
            scheme,
            await deps.enumerate(session.client, startIndex, session.readiness, scheme),
          ]);
        }
        return read;
      });
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
      if (!isLedgerReadAborted(error) && epoch === flowEpoch) {
        deps.render(deviceError(error));
      }
    } finally {
      busy = false;
      pageLoading = false;
      readingMore = false;
      if (moreQueued && epoch === flowEpoch) {
        moreQueued = false;
        void loadPage(obtainMore, nextIndex, false);
      } else {
        flushConnect();
      }
    }
  };

  // Further pages reconnect silently; the "Show more" click is the gesture.
  const obtainConnected = async (deviceId?: string): Promise<LedgerDeviceSession> =>
    (await deps.connector.openConnected(deviceId)) ?? deps.connector.request();

  const obtainMore = async (): Promise<LedgerDeviceSession> =>
    obtainConnected(selectedDeviceId ?? undefined);

  const startConnect = (): void => {
    pendingConnect = false;
    resetState();
    const epoch = flowEpoch;
    const ticket = ++listTicket;
    const list = deps.connector.listConnected;
    if (!list) {
      void loadPage(() => deps.connector.request(), 0, true);
      return;
    }
    busy = listing = true;
    deps.render({ kind: "reading" });
    const settleList = (): boolean => {
      if (ticket !== listTicket) return false;
      busy = listing = false;
      if (epoch === flowEpoch) return true;
      flushConnect();
      return false;
    };
    void list().then(
      (connected) => {
        if (!settleList()) return;
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
        if (settleList()) deps.render(deviceError(error));
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
      const message = localizeErrorCopy(
        friendlyError(error instanceof Error ? error.message : "", ADD_ACCOUNT_FAILED).message,
      );
      await deps.refresh().catch(() => undefined);
      if (epoch === flowEpoch) {
        renderPicker(message);
      }
    } finally {
      busy = false;
      flushConnect();
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
      const raw = error instanceof Error ? error.message : "";
      const message = localizeErrorCopy(friendlyError(raw, ADD_ACCOUNT_FAILED).message);
      // No phrase to derive from: land on import, not on a Ledger "Try again".
      deps.render(
        isPhraselessAddRefusal(raw)
          ? { kind: "import-chooser", phraselessNote: message }
          : { kind: "error", message },
      );
    } finally {
      busy = false;
      flushConnect();
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
      pendingConnect = false;
      resetState();
      listTicket += 1;
      deps.onCancel();
      deps.render(null);
      void gate.release();
      if (listing) busy = listing = false; // A read or add clears its own `busy`.
    },
    choose,
    chooseDevice,
    connect() {
      // A hung list is restarted; any other run queues this for its finally.
      if ((busy && !listing) || gate.isBusy()) {
        pendingConnect = true;
        return;
      }
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
