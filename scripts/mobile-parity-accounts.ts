/**
 * Account parity vectors for the mobile Rust core, computed by the extension's own code: the
 * address of every account family and deployment class (`deriveAccount` over the real Krusty WASM
 * package), the friendly-name and truncation rules, label normalisation, group ids, and the
 * discovery row wording. `bun run mobile:parity` writes them; `bun run check` fails on drift.
 *
 * The phrase is the repository's published E2E test phrase, so every value here is public.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { type AccountGroups, createGroup } from "@bramble/settings/groups";
import { deriveAccount } from "@bramble/vault/accounts";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import {
  type AccountContractType,
  type AccountRef,
  recoveryLadderIndex,
} from "@bramble/wallet-model/accounts";
import { isLabel } from "@bramble/wallet-model/preferences";
import {
  type RecoveryAccountCandidate,
  recoverySelectionKey,
} from "@bramble/wallet-model/recovery";
// Not package exports: side-panel presentation rules, read here only to pin the mobile port.
import {
  candidateState,
  candidateTitle,
  selectable,
} from "../packages/presentation/wallet-ui/src/sidepanel/journeys/onboarding/recovery-account-ui";
import {
  accountDisplayName,
  accountLabel,
} from "../packages/presentation/wallet-ui/src/sidepanel/shared/parts";
import { PARITY_MNEMONIC } from "./mobile-parity";

/**
 * Committed fixtures the Rust and Swift tests read: the derivation vectors (one file per network,
 * each under the 500-line limit) and the UI rules.
 */
export const ACCOUNTS_PARITY_FIXTURE_PATHS = {
  familiesMainnet: "mobile/core/tests/fixtures/accounts-parity-families-mainnet.json",
  familiesSepolia: "mobile/core/tests/fixtures/accounts-parity-families-sepolia.json",
  rules: "mobile/core/tests/fixtures/accounts-parity-rules.json",
} as const;

const PARITY_PASSPHRASE = "parity passphrase";
const INDICES = [0, 3, 19] as const;
const NETWORKS = ["SN_MAIN", "SN_SEPOLIA"] as const;

type Shape = {
  readonly accountContractType: AccountContractType;
  readonly classHash?: string;
  readonly derivation?: "argentx-bip44";
};

// The discovery shapes, in the order `recoveryScanShapes` scans them (issue 505): OZ and the
// Argent release this wallet creates on its own ladder, every Argent release on Ready's
// ETH-seeded ladder, and every Braavos class, which `deriveAccount` maps to Braavos's address
// ladder by family.
const SHAPES: readonly Shape[] = [
  { accountContractType: "openzeppelin" },
  { accountContractType: "argent", classHash: ARGENT_ACCOUNT_CLASS_HASH },
  ...deploymentClasses("argent").map((entry) => ({
    accountContractType: "argent" as const,
    classHash: entry.classHash,
    derivation: "argentx-bip44" as const,
  })),
  ...deploymentClasses("braavos").map((entry) => ({
    accountContractType: "braavos" as const,
    classHash: entry.classHash,
  })),
];

/** One derived account as the extension stores it. */
export type ParityFamilyVector = {
  readonly accountContractType: AccountContractType;
  readonly accountIndex: number;
  readonly address: string;
  readonly classHash: string;
  readonly deploymentSalt: string | null;
  /** The extension's derivation kind for the stored account. */
  readonly derivation: "argentx-bip44" | "starknet-bip44";
  readonly networkId: string;
  readonly passphrase: string | null;
  readonly publicKeyX: string;
  readonly requestedClassHash: string | null;
};

const familyVectors = async (): Promise<{
  readonly accounts: readonly AccountRef[];
  readonly vectors: readonly ParityFamilyVector[];
}> => {
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const cases = [
    ...INDICES.flatMap((accountIndex) =>
      NETWORKS.map((networkId) => ({ accountIndex, networkId, passphrase: null })),
    ),
    { accountIndex: 0, networkId: "SN_SEPOLIA", passphrase: PARITY_PASSPHRASE },
  ] as const;
  const accounts: AccountRef[] = [];
  const vectors: ParityFamilyVector[] = [];
  for (const { accountIndex, networkId, passphrase } of cases) {
    // Ready takes no BIP-39 passphrase, so its ladder has no vectors under one.
    for (const shape of SHAPES.filter((s) => passphrase === null || s.derivation === undefined)) {
      const { account } = await deriveAccount(kms, {
        ...shape,
        accountIndex,
        mnemonic: PARITY_MNEMONIC,
        ...(passphrase === null ? {} : { mnemonicPassphrase: passphrase }),
        networkId,
      });
      accounts.push(account);
      vectors.push({
        accountContractType: account.accountContractType,
        accountIndex,
        address: account.address,
        classHash: account.classHash,
        deploymentSalt: account.deploymentSalt ?? null,
        derivation: account.derivation.kind,
        networkId,
        passphrase,
        publicKeyX: account.publicKeyX,
        requestedClassHash: shape.classHash ?? null,
      });
    }
  }
  return { accounts, vectors };
};

const NAME_INPUTS = [
  "0x0",
  "0x1",
  "0x1e",
  "0x83",
  "0xf5a",
  "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9",
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "0XABC",
  "1234567",
  "  0x1f  ",
  "",
  "-45",
  "0b101",
  "0o777",
  "not an address",
] as const;

const LABEL_INPUTS = [
  "Savings",
  "  Savings  ",
  "",
  "   ",
  " Trading﻿",
  " line ",
  "a".repeat(64),
  "a".repeat(65),
  ` ${"b".repeat(64)} `,
  "🔥".repeat(32),
  "🔥".repeat(33),
  "é".repeat(64),
  "tab\tinside",
] as const;

const GROUP_NAMES = [
  "Long term",
  "Long term",
  "long-term",
  "  Operations  ",
  "Ops & DeFi!!",
  "🔥🔥",
  "Ünïcode Name",
  "x".repeat(64),
  "y".repeat(80),
  "",
  "   ",
  "-dash-",
] as const;

// Replays `createGroup` over the names in order, recording each resulting id or refusal.
const groupVectors = () => {
  let groups: AccountGroups = [];
  const created = GROUP_NAMES.map((name) => {
    try {
      groups = createGroup(groups, name, "folder");
      const group = groups.at(-1);
      return { id: group?.id ?? null, name, storedName: group?.name ?? null };
    } catch {
      return { id: null, name, storedName: null };
    }
  });
  return created;
};

// Discovery rows for every (shape, deployed, funded) combination.
const recoveryVectors = (accounts: readonly AccountRef[], vectors: readonly ParityFamilyVector[]) =>
  accounts
    .filter((_, position) => {
      const vector = vectors[position];
      return (
        vector?.networkId === "SN_SEPOLIA" &&
        vector.passphrase === null &&
        vector.accountIndex === 3
      );
    })
    .flatMap((account) =>
      [
        [false, false],
        [false, true],
        [true, false],
      ].map(([deployed, funded]) => {
        const candidate = {
          account,
          deployed,
          funded,
        } as RecoveryAccountCandidate;
        // The ladder position the row names, on whichever axis its family walks (issue 505).
        const { derivation } = account;
        if (derivation.kind !== "starknet-bip44" && derivation.kind !== "argentx-bip44") {
          throw new Error(`discovery never derives ${derivation.kind}`);
        }
        const accountIndex = recoveryLadderIndex({ derivation });
        return {
          accountContractType: account.accountContractType,
          accountIndex,
          classHash: account.classHash,
          deployed,
          derivation: account.derivation.kind,
          funded,
          hint: candidateState(candidate, false),
          key: recoverySelectionKey({
            accountContractType: account.accountContractType,
            accountIndex,
            derivation: derivation.kind,
            ...(account.accountContractType === "openzeppelin"
              ? {}
              : { classHash: account.classHash }),
          }),
          selectable: selectable(candidate),
          title: candidateTitle(candidate),
        };
      }),
    );

/** Every account vector set, split into the three committed fixtures (each under 500 lines). */
export const computeAccountParity = async () => {
  const { accounts, vectors } = await familyVectors();
  const named = [...NAME_INPUTS, ...vectors.slice(0, SHAPES.length).map((v) => v.address)];
  const families = (networkId: (typeof NETWORKS)[number]) => ({
    mnemonic: PARITY_MNEMONIC,
    passphrase: PARITY_PASSPHRASE,
    vectors: vectors.filter((vector) => vector.networkId === networkId),
  });
  const rules = {
    groups: groupVectors(),
    labels: LABEL_INPUTS.map((value) => ({
      stored: isLabel(value) ? value.trim() : null,
      valid: isLabel(value),
      value,
    })),
    names: named.map((address) => ({
      address,
      name: accountDisplayName({ address, id: `SN_MAIN:${address}` } as AccountRef, null),
      short: accountLabel(address),
    })),
    recovery: recoveryVectors(accounts, vectors),
  };
  return {
    familiesMainnet: families("SN_MAIN"),
    familiesSepolia: families("SN_SEPOLIA"),
    rules,
  };
};
