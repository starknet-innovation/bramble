/**
 * Types for the Ledger onboarding subflow, split from onboard-session.ts on
 * the size budget. Pure declarations: no device, vault, or DOM access.
 */

import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import type {
  LedgerConnector,
  LedgerDeviceChoice,
  LedgerDeviceSession,
} from "@bramble/ledger-protocol/session";
import type {
  AccountContractType,
  LedgerAccountRef,
  LedgerPubKeyEntry,
} from "@bramble/wallet-model/accounts";

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
  readonly funded: boolean | null;
};

/**
 * Account-contract-aware routes dispatched by the add-account chooser.
 */
export type LedgerOnboardAddKind =
  | "import"
  | "import-key"
  | "import-phrase"
  | "ledger"
  | "multisig"
  | "regular";

/**
 * The onboarding device-prompt view the binder renders: the add-account
 * chooser, the connect gesture, the silent read, the multi-select account
 * picker (with the currently-selected indices), or a typed error.
 */
export type LedgerOnboardView =
  | { readonly kind: "chooser" }
  | { readonly kind: "import-chooser" }
  | { readonly kind: "connect" }
  | { readonly kind: "devices"; readonly devices: readonly LedgerDeviceChoice[] }
  | { readonly kind: "reading" }
  | {
      readonly kind: "picker";
      readonly candidates: readonly LedgerCandidate[];
      readonly message?: string;
      readonly selected: readonly string[];
    }
  | { readonly kind: "error"; readonly message: string };

/**
 * Best-effort on-chain state; `null` degrades to unavailable without blocking.
 */
export type LedgerCandidateState = {
  readonly balance: string | null;
  readonly deployed: boolean | null;
  readonly funded: boolean | null;
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
  readonly openImportSeed: () => void;
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
  readonly loadMore: () => void;
  readonly showChooser: () => void;
  readonly start: () => void;
  readonly toggle: (accountId: string) => void;
};

/**
 * Whether a candidate shows on-chain activity: deployed, or holding a non-zero
 * balance in any known token (a funded counterfactual address) — the same
 * definition the recovery scan uses. `null` state — still loading or degraded
 * RPC — counts as inactive until proven otherwise.
 */
export const ledgerCandidateActive = (candidate: LedgerCandidate): boolean =>
  candidate.deployed === true || candidate.funded === true;

/**
 * Whether a candidate may be selected. Duplicates never are, and a Ready
 * candidate with no on-chain activity is listed but not selectable — importing
 * it would deploy a brand-new Ready account, and Bramble only creates Bramble
 * accounts.
 */
export const ledgerCandidateSelectable = (candidate: LedgerCandidate): boolean =>
  !candidate.duplicate &&
  (candidate.account.accountContractType !== "argent" || ledgerCandidateActive(candidate));
