/**
 * Pure orchestration for Ledger onboarding: the version gate plus the silent
 * multi-index public-key enumeration that backs the account picker. The device
 * client is injected (the structural {@link LedgerDeviceClient}), so this runs
 * without hardware. It reads no secrets and derives no key material — it only
 * reads public keys the device already holds and rebuilds each EIP-2645 path
 * deterministically from its index (one source of truth with sign-time), so a
 * stored path always matches the one used to enumerate and sign.
 */
import { ledgerAccountPath } from "../../starknet/ledger-path";
import type { LedgerAccountRef } from "../../storage/vault-schema";
import type { LedgerPubKeyEntry } from "../../wallet/accounts";
import { assertLedgerAppReady, type LedgerDeviceClient, ledgerPublicKeyX } from "./client";
import { asLedgerRejection, ledgerMessage } from "./errors";
import {
  closeLedgerSessionQuietly,
  type LedgerConnector,
  type LedgerDeviceSession,
} from "./sign-session";

/**
 * Default number of account indices to enumerate for the picker (indices
 * `0..N-1`). The device app only needs to be open and unlocked; enumeration is
 * silent (no per-index on-device button press).
 */
export const LEDGER_ENUMERATION_COUNT = 5;

/**
 * Reads the app version (rejecting a below-minimum app with `app-below-minimum`),
 * then reads the public-key x-coordinate for account indices `0..count-1`,
 * SILENTLY and one round-trip at a time (WebHID is a serial pipe). Returns the
 * enumerated `(index, publicKeyX)` pairs for {@link deriveLedgerAccountRefs} to
 * turn into candidate accounts. Any device/transport failure propagates as a
 * typed {@link LedgerRejection} so the caller aborts cleanly.
 */
export const enumerateLedgerPubKeys = async (
  client: LedgerDeviceClient,
  count: number = LEDGER_ENUMERATION_COUNT,
): Promise<readonly LedgerPubKeyEntry[]> => {
  await assertLedgerAppReady(client);
  const entries: LedgerPubKeyEntry[] = [];
  for (let accountIndex = 0; accountIndex < count; accountIndex += 1) {
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
 * The onboarding device-prompt view the binder renders: connect gesture, silent
 * read, the account picker, or a typed error.
 */
export type LedgerOnboardView =
  | { readonly kind: "connect" }
  | { readonly kind: "reading" }
  | { readonly kind: "picker"; readonly candidates: readonly LedgerCandidate[] }
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
 * Collaborators the onboarding controller drives, all injected so the connect →
 * enumerate → derive → describe → create flow runs without hardware or a live
 * background: the device connector, the enumeration reader, the address
 * derivation (background `deriveLedgerAccounts`), the per-candidate on-chain
 * `describe`, the set of ids already in the vault (duplicate detection), the
 * `create` call (background `addLedgerAccount`), a `render` sink, a `refresh`
 * run after a successful add, and an `onCancel` hook run when the user dismisses
 * the flow (the first-run entry uses it to clear the captured setup secret).
 */
export type LedgerOnboardControllerDeps = {
  readonly connector: LedgerConnector;
  readonly create: (accountIndex: number, publicKeyX: string) => Promise<void>;
  readonly derive: (entries: readonly LedgerPubKeyEntry[]) => Promise<readonly LedgerAccountRef[]>;
  readonly describe: (account: LedgerAccountRef) => Promise<LedgerCandidateState>;
  readonly enumerate: (client: LedgerDeviceClient) => Promise<readonly LedgerPubKeyEntry[]>;
  readonly existingIds: () => ReadonlySet<string>;
  readonly onCancel: () => void;
  readonly refresh: () => Promise<void>;
  readonly render: (view: LedgerOnboardView | null) => void;
};

/**
 * Drives the Ledger onboarding subflow. Returned by
 * {@link createLedgerOnboardController}.
 */
export type LedgerOnboardController = {
  readonly cancel: () => void;
  readonly connect: () => void;
  readonly select: (accountIndex: number) => void;
  readonly start: () => void;
};

/**
 * Creates the Ledger onboarding controller. `start` shows the connect gesture;
 * `connect` runs the picker, enumerating the device, deriving addresses through
 * the background, and fetching each candidate's on-chain state in parallel (a
 * degraded RPC yields "unavailable" rather than blocking); `select` creates the
 * chosen keyless account and refreshes. Every device/transport failure maps to
 * the typed rejection catalog and shows an actionable retry — no partial state.
 */
export const createLedgerOnboardController = (
  deps: LedgerOnboardControllerDeps,
): LedgerOnboardController => {
  let candidates: readonly LedgerCandidate[] = [];
  let busy = false;

  const toCandidate = (account: LedgerAccountRef): LedgerCandidate => ({
    account,
    balance: null,
    deployed: null,
    duplicate: deps.existingIds().has(account.id),
  });

  const withState = (account: LedgerAccountRef, state: LedgerCandidateState): LedgerCandidate => ({
    ...toCandidate(account),
    balance: state.balance,
    deployed: state.deployed,
  });

  const runConnect = async (): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    deps.render({ kind: "reading" });
    // The session owns the WebHID transport; the device is only needed for the
    // silent enumeration (account creation is a background op), so it is closed
    // in the `finally` on every outcome — read, error, or nothing granted.
    let session: LedgerDeviceSession | null = null;
    try {
      session = await deps.connector.request();
      const entries = await deps.enumerate(session.client);
      const accounts = await deps.derive(entries);
      candidates = accounts.map(toCandidate);
      deps.render({ candidates, kind: "picker" });
      const described = await Promise.all(
        accounts.map(async (account) =>
          withState(
            account,
            await deps.describe(account).catch(() => ({ balance: null, deployed: null })),
          ),
        ),
      );
      candidates = described;
      deps.render({ candidates, kind: "picker" });
    } catch (error) {
      deps.render({ kind: "error", message: ledgerMessage(asLedgerRejection(error).code) });
    } finally {
      if (session) {
        await closeLedgerSessionQuietly(session);
      }
      busy = false;
    }
  };

  const runSelect = async (accountIndex: number): Promise<void> => {
    const candidate = candidates.find(
      (item) => item.account.derivation.accountIndex === accountIndex,
    );
    if (!candidate || candidate.duplicate || busy) {
      return;
    }
    busy = true;
    try {
      await deps.create(accountIndex, candidate.account.publicKeyX);
      deps.render(null);
      await deps.refresh();
    } catch (error) {
      // Creating a keyless account is a background op (no device), so a failure
      // here is a wallet error (duplicate, locked) — surface its message, not a
      // device-catalog message.
      const message = error instanceof Error ? error.message : "Could not add the account.";
      deps.render({ kind: "error", message });
    } finally {
      busy = false;
    }
  };

  return {
    cancel() {
      candidates = [];
      deps.onCancel();
      deps.render(null);
    },
    connect() {
      void runConnect();
    },
    select(accountIndex) {
      void runSelect(accountIndex);
    },
    start() {
      candidates = [];
      deps.render({ kind: "connect" });
    },
  };
};
