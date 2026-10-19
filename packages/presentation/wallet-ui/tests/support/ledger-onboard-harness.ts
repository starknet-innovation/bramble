/**
 * Shared deterministic harness for Ledger onboarding controller suites: a fake
 * device whose pubkey per index is deterministic, contract-aware candidate
 * fixtures (a Ready twin carries its required deployment salt and a distinct
 * address), and the capturing controller-deps factory. Test-only.
 */
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import type { AccountContractType, LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountIndexOfPath, ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type {
  LedgerOnboardControllerDeps,
  LedgerOnboardView,
} from "../../src/sidepanel/journeys/ledger/onboard-session";
import type { LedgerConnector } from "../../src/sidepanel/journeys/ledger/sign-session";

const version = (major: number) => ({
  errorMessage: "No errors",
  major,
  minor: major === 2 ? 4 : 0,
  patch: 0,
  returnCode: 0x9000,
});

// A device whose pubkey per index is deterministic (0x1, 0x2, …) under either
// path scheme, so the test can assert the enumerated entries and that paths
// track their index. A path neither scheme built reads as index 0 — the shared
// parser is the same one production validates with.
export const enumerateClient = (appMajor: number): LedgerDeviceClient => ({
  getOsVersion: () => Promise.resolve({ targetId: 0x33000004, version: "2.7.1" }),
  getAppVersion: () => Promise.resolve(version(appMajor)),
  getPubKey: (path: string) => {
    const index = ledgerAccountIndexOfPath(path) ?? 0;
    return Promise.resolve({
      errorMessage: "No errors",
      publicKey: new Uint8Array([...new Array(31).fill(0), index + 1, ...new Array(32).fill(0)]),
      returnCode: 0x9000,
    });
  },
  signHash: () => Promise.reject(new Error("unused")),
});

export const candidateAccount = (
  index: number,
  accountContractType: AccountContractType = "openzeppelin",
): LedgerAccountRef => {
  const prefix =
    accountContractType === "argent" ? "e" : accountContractType === "braavos" ? "b" : "";
  const address = `0x${prefix}${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`;
  return {
    // A Ledger account is this wallet's own OpenZeppelin (no deployment salt),
    // Argent (Bramble's own and Ready's), or Braavos (which owns it with a
    // device key at Ready's scheme); the salted families carry a salt.
    ...(accountContractType === "openzeppelin"
      ? ({ accountContractType: "openzeppelin" } as const)
      : ({ accountContractType, deploymentSalt: "0x1" } as const)),
    address,
    classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    derivation: {
      accountIndex: index,
      eip2645application: "LedgerW",
      kind: "ledger",
      path: ledgerAccountPath(index),
    },
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX: `0x${index + 1}`,
  };
};

// Selection is keyed on the candidate's account id (unique across the two
// contract families derived from the same device key).
export const idOf = (index: number, accountContractType: AccountContractType = "openzeppelin") =>
  candidateAccount(index, accountContractType).id;

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export const onboardHarness = (overrides: Partial<LedgerOnboardControllerDeps> = {}) => {
  const views: (LedgerOnboardView | null)[] = [];
  const created: number[] = [];
  let refreshed = 0;
  let closed = 0;
  let cancels = 0;
  let hdAdds = 0;
  let imports = 0;
  let seedImports = 0;
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
    derive: (entries, accountContractType) =>
      Promise.resolve(
        entries.map((entry) => candidateAccount(entry.accountIndex, accountContractType)),
      ),
    // Inactive by default ("0" balance, undeployed) so nothing is auto-selected
    // and each test's selection stays deliberate; auto-selection has its own test.
    describe: () => Promise.resolve({ balance: "0 STRK", deployed: false, funded: false }),
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
    openFindAccounts: () => undefined,
    openImportSeed: () => {
      seedImports += 1;
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
    seedImports: () => seedImports,
    multisigs: () => multisigs,
    refreshed: () => refreshed,
    views,
  };
};

export const kinds = (views: readonly (LedgerOnboardView | null)[]): readonly (string | null)[] =>
  views.map((view) => (view === null ? null : view.kind));

export const pickerIndexes = (
  view: LedgerOnboardView | null | undefined,
  accountContractType: AccountContractType = "openzeppelin",
): readonly number[] => {
  if (view?.kind !== "picker") {
    throw new Error("expected a picker view");
  }
  return view.candidates
    .filter((candidate) => candidate.account.accountContractType === accountContractType)
    .map((candidate) => candidate.account.derivation.accountIndex);
};
