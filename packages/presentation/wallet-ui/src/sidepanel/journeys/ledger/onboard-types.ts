/**
 * The Ledger onboarding contract: the picker's candidate shape, the views the
 * binder renders, the collaborators the controller drives, and the controller
 * surface itself. Types only — no behavior, no device access, no secrets. It
 * sits beside `onboard-session.ts` (the implementation) and `onboard-views.ts`
 * (the templates) so the view union and the binder cannot drift apart.
 */

import type { LedgerDeviceClient } from "@mc-wallet/ledger-protocol/client";
import type {
  LedgerConnector,
  LedgerDeviceChoice,
  LedgerDeviceSession,
} from "@mc-wallet/ledger-protocol/session";
import type {
  AccountContractType,
  LedgerAccountRef,
  LedgerPubKeyEntry,
} from "@mc-wallet/wallet-model/accounts";

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
 * Account-contract-aware routes dispatched by the add-account chooser.
 */
export type LedgerOnboardAddKind =
  | "argent"
  | "import"
  | "ledger-argent"
  | "ledger-openzeppelin"
  | "multisig"
  | "openzeppelin";

/**
 * The onboarding device-prompt view the binder renders: the add-account
 * chooser, the connect gesture, the silent read, the multi-select account
 * picker (with the currently-selected indices), or a typed error.
 */
export type LedgerOnboardView =
  | { readonly kind: "chooser"; readonly selected: LedgerOnboardAddKind | null }
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
 * Best-effort on-chain state; `null` degrades to unavailable without blocking.
 */
export type LedgerCandidateState = {
  readonly balance: string | null;
  readonly deployed: boolean | null;
};

/**
 * Injected collaborators keep chooser, enumeration, contract-aware derivation,
 * creation, refresh, and cancellation testable without hardware or a live
 * background.
 */
export type LedgerOnboardControllerDeps = {
  readonly addHd: (accountContractType: AccountContractType) => Promise<void>;
  readonly connector: LedgerConnector;
  readonly create: (account: LedgerAccountRef) => Promise<void>;
  readonly derive: (
    entries: readonly LedgerPubKeyEntry[],
    accountContractType: AccountContractType,
  ) => Promise<readonly LedgerAccountRef[]>;
  readonly describe: (account: LedgerAccountRef) => Promise<LedgerCandidateState>;
  readonly enumerate: (
    client: LedgerDeviceClient,
    startIndex: number,
    readiness: LedgerDeviceSession["readiness"],
  ) => Promise<readonly LedgerPubKeyEntry[]>;
  readonly existingIds: () => ReadonlySet<string>;
  readonly onCancel: () => void;
  readonly openImport: () => void;
  readonly openMultisig: () => void;
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
  readonly continueChoice: () => void;
  readonly loadMore: () => void;
  readonly select: (kind: LedgerOnboardAddKind) => void;
  readonly showChooser: () => void;
  readonly start: (accountContractType?: AccountContractType) => void;
  readonly toggle: (accountIndex: number) => void;
};
