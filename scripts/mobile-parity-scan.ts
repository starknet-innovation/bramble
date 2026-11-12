/**
 * Recovery-scan parity vectors for the mobile Rust core, computed by the extension's own code:
 * the shapes the scan walks and which it lists unused (`recoveryScanShapes`,
 * `isCreatableCandidate`, `keepsRecoveryCandidate`), how far it goes (`recoveryScanTarget`,
 * `RECOVERY_SCAN_LIMITS`), the advisory signing verdicts (`argentSigningRestriction`,
 * `braavosSigningRestriction`) over a fake provider, and the privacy-pool note
 * (`strk20RegisteredElsewhere`). Each verdict case records the reads its function made, so the
 * Rust side replays it without a provider. `bun run mobile:parity` writes it; `bun run check`
 * fails on drift. The phrase is the repository's published E2E test phrase, so every value here
 * is public.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { argentSigningRestriction, braavosSigningRestriction } from "@bramble/starknet/rpc";
import { deriveAccount } from "@bramble/vault/accounts";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  BRAAVOS_SIGNING_CLASS_HASHES,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import {
  type AccountRef,
  isRecoverableAccountRef,
  recoveryLadderIndex,
} from "@bramble/wallet-model/accounts";
import {
  isCreatableCandidate,
  keepsRecoveryCandidate,
  RECOVERY_SCAN_LIMITS,
  type RecoveryAccountCandidate,
  type RecoveryScanShape,
  recoveryScanShapes,
  recoveryScanTarget,
} from "@bramble/wallet-model/recovery";
import type { RpcProvider } from "starknet";
import { readDiscoverRecoveryAccountsInput } from "../apps/extension/src/background/accounts/account-creation-inputs";
import {
  clearStrk20PoolKeyCache,
  strk20RegisteredElsewhere,
} from "../apps/extension/src/background/privacy/strk20-registration-owner";
import { PARITY_MNEMONIC } from "./mobile-parity";

/**
 * The committed scan fixtures the Rust tests read: the scan rules and the privacy-pool note, and
 * the signing verdicts in their own file so each stays under the 500-line limit.
 */
export const ACCOUNTS_SCAN_FIXTURE_PATHS = {
  scan: "mobile/core/tests/fixtures/accounts-parity-scan.json",
  signing: "mobile/core/tests/fixtures/accounts-parity-scan-signing.json",
} as const;

const NETWORK_ID = "SN_SEPOLIA";
const PARITY_PASSPHRASE = "parity passphrase";
const FAILS = "fails";

type Kms = ReturnType<typeof createKrustyKms>;

const derive = async (kms: Kms, shape: RecoveryScanShape, accountIndex: number) => {
  const { account } = await deriveAccount(kms, {
    ...shape,
    accountIndex,
    mnemonic: PARITY_MNEMONIC,
    networkId: NETWORK_ID,
  });
  // `recoveryScanTarget` reads the ladder index; the fixture records the scan index, so the two
  // must be the same number for every shape the scan derives.
  if (!isRecoverableAccountRef(account)) throw new Error("discovery never derives this account");
  if (recoveryLadderIndex(account) !== accountIndex) {
    throw new Error(`ladder index of ${account.id} is not its scan index ${accountIndex}`);
  }
  return account;
};

const candidate = (account: AccountRef, deployed: boolean, funded: boolean) =>
  ({ account, deployed, funded }) as RecoveryAccountCandidate;

// What the extension does with a BIP-39 passphrase on the recovery path: the discovery request
// refuses the field, and Ready's ladder refuses to derive under one.
const passphraseVectors = async (kms: Kms) => {
  const request = { mnemonic: PARITY_MNEMONIC, networkId: NETWORK_ID };
  const ready = recoveryScanShapes().find((shape) => shape.derivation === "argentx-bip44");
  if (!ready) throw new Error("no Ready shape to derive");
  const readyUnderPassphrase = await deriveAccount(kms, {
    ...ready,
    accountIndex: 0,
    mnemonic: PARITY_MNEMONIC,
    mnemonicPassphrase: PARITY_PASSPHRASE,
    networkId: NETWORK_ID,
  }).then(
    () => "derived",
    (error: unknown) => (error instanceof Error ? error.message : "refused"),
  );
  return {
    discoveryAcceptsPassphrase:
      readDiscoverRecoveryAccountsInput({
        ...request,
        mnemonicPassphrase: PARITY_PASSPHRASE,
        type: "wallet.discoverRecoveryAccounts",
      }) !== null,
    discoveryAcceptsPhraseAlone:
      readDiscoverRecoveryAccountsInput({ ...request, type: "wallet.discoverRecoveryAccounts" }) !==
      null,
    readyLadderUnderPassphrase: readyUnderPassphrase,
  };
};

// Every shape in scan order, its creatable flag, and the keep rule for it with no history at
// index 0, at index 3, and at index 3 searched by hand.
const shapeVectors = async (kms: Kms) =>
  Promise.all(
    recoveryScanShapes().map(async (shape) => {
      const atZero = await derive(kms, shape, 0);
      const atThree = await derive(kms, shape, 3);
      return {
        accountContractType: shape.accountContractType,
        classHash: atZero.classHash,
        creatable: isCreatableCandidate(atZero),
        derivation: atZero.derivation.kind,
        keptUnused: {
          indexThree: keepsRecoveryCandidate(candidate(atThree, false, false), 3, false),
          indexThreeManual: keepsRecoveryCandidate(candidate(atThree, false, false), 3, true),
          indexZero: keepsRecoveryCandidate(candidate(atZero, false, false), 0, false),
        },
        requestedClassHash: shape.classHash ?? null,
      };
    }),
  );

// Fixed candidate sets: [shape position, scan index, deployed, funded, searched by hand].
type Seed = readonly [number, number, boolean, boolean, boolean];
const TARGET_CASES: readonly { readonly name: string; readonly seeds: readonly Seed[] }[] = [
  { name: "nothing found", seeds: [] },
  { name: "quiet wallet: creatable defaults at index 0", seeds: [[0, 0, false, false, false]] },
  {
    name: "ladder of real accounts",
    seeds: [
      [0, 0, true, false, false],
      [0, 5, true, false, false],
      [8, 19, true, false, false],
      [5, 24, false, true, false],
    ],
  },
  { name: "funded Ready account only", seeds: [[5, 25, false, true, false]] },
  { name: "deployed at 178: under the ceiling", seeds: [[0, 178, true, false, false]] },
  { name: "deployed at 179: reaches the ceiling", seeds: [[0, 179, true, false, false]] },
  { name: "deployed at 190: held at the ceiling", seeds: [[0, 190, true, false, false]] },
  { name: "manual index, nothing there", seeds: [[0, 57, false, false, true]] },
  { name: "manual index, deployed", seeds: [[9, 57, true, false, true]] },
  { name: "deployed at a non-creatable class", seeds: [[3, 12, true, false, false]] },
];

const targetVectors = async (kms: Kms) => {
  const shapes = recoveryScanShapes();
  return Promise.all(
    TARGET_CASES.map(async ({ name, seeds }) => {
      const found = await Promise.all(
        seeds.map(async ([position, accountIndex, deployed, funded, manual]) => {
          const shape = shapes[position];
          if (!shape) throw new Error(`no shape at ${position}`);
          const made = candidate(await derive(kms, shape, accountIndex), deployed, funded);
          const kept = keepsRecoveryCandidate(made, accountIndex, manual);
          return { accountIndex, kept, made, manual, position };
        }),
      );
      return {
        candidates: found.map(({ accountIndex, kept, made, manual, position }) => ({
          accountIndex,
          deployed: made.deployed,
          funded: made.funded,
          kept,
          manual,
          shape: position,
        })),
        name,
        target: recoveryScanTarget(found.filter(({ kept }) => kept).map(({ made }) => made)),
      };
    }),
  );
};

// A provider that answers fixed reads, and the record of which ones a verdict consulted.
type Answers = Readonly<Record<string, readonly string[] | typeof FAILS>>;
const recordingProvider = (
  liveClass: string,
  answers: Answers,
  timestamp: number | typeof FAILS,
) => {
  const reads: Record<string, readonly string[] | typeof FAILS> = {};
  let blockTimestamp: number | typeof FAILS | null = null;
  const provider = {
    async callContract({ entrypoint }: { readonly entrypoint: string }) {
      const answer = answers[entrypoint];
      if (answer === undefined) throw new Error(`unexpected read: ${entrypoint}`);
      reads[entrypoint] = answer;
      if (answer === FAILS) throw new Error(`${entrypoint} failed`);
      return [...answer];
    },
    async getBlock() {
      blockTimestamp = timestamp;
      if (timestamp === FAILS) throw new Error("block read failed");
      return { block_hash: "0xb", timestamp };
    },
    async getClassHashAt() {
      return liveClass;
    },
  } as unknown as RpcProvider;
  return { blockTimestamp: () => blockTimestamp, provider, reads };
};

type VerdictCase = {
  readonly answers: Answers;
  readonly liveClass: string;
  readonly name: string;
  readonly timestamp?: number | typeof FAILS;
};

const argentClass = (label: string): string => {
  const entry = deploymentClasses("argent").find((candidate) => candidate.label === label);
  if (!entry) throw new Error(`${label} missing from the class table`);
  return entry.classHash;
};

const argentCases = (key: string): readonly VerdictCase[] => {
  const healthy = { get_guardian: ["0x0"], get_owner: [key], get_owner_type: ["0x0"] };
  const current = ARGENT_ACCOUNT_CLASS_HASH;
  const padded = `0x${key.slice(2).padStart(64, "0")}`;
  return [
    { answers: healthy, liveClass: current, name: "no restriction" },
    { answers: { ...healthy, get_owner: [padded] }, liveClass: current, name: "owner padded" },
    { answers: { ...healthy, get_guardian: ["0x7601"] }, liveClass: current, name: "guardian" },
    { answers: { ...healthy, get_guardian: [] }, liveClass: current, name: "guardian empty" },
    { answers: { ...healthy, get_owner: ["0xdead"] }, liveClass: current, name: "owner changed" },
    {
      answers: { ...healthy, get_owner: [key, "0x1"] },
      liveClass: current,
      name: "owner two felts",
    },
    { answers: { ...healthy, get_owner_type: ["0x2"] }, liveClass: current, name: "owner type" },
    {
      answers: { ...healthy, get_guardian: ["0x7601"], get_owner: ["0xdead"] },
      liveClass: current,
      name: "owner changed before guardian",
    },
    { answers: {}, liveClass: argentClass("argent 0.3.0"), name: "release 0.3.0" },
    { answers: {}, liveClass: "0x9999", name: "release unknown" },
    { answers: {}, liveClass: BRAAVOS_DEPLOYMENT_CLASS_HASH, name: "release of another family" },
    {
      answers: { ...healthy, get_guardian: FAILS },
      liveClass: current,
      name: "guardian read fails",
    },
    {
      answers: { ...healthy, get_guardian: FAILS, get_owner: ["0xdead"] },
      liveClass: current,
      name: "owner changed, guardian read fails",
    },
  ];
};

const braavosCases = (key: string): readonly VerdictCase[] => {
  const signing = BRAAVOS_SIGNING_CLASS_HASHES[0];
  if (!signing) throw new Error("no Braavos signing class");
  const starkOnly = ["0x1", key, "0x0", "0x0"];
  const secp = ["0x1", key, "0x1", "0xaa", "0x0"];
  const strong = (
    deferred: readonly string[] | typeof FAILS,
    timestamp: number | typeof FAILS,
  ) => ({
    answers: { get_deferred_remove_signers: deferred, get_signers: secp },
    liveClass: signing,
    timestamp,
  });
  return [
    { answers: { get_signers: starkOnly }, liveClass: signing, name: "no restriction" },
    {
      answers: { get_signers: ["0x1", "0xdead", "0x0", "0x0"] },
      liveClass: signing,
      name: "owner changed",
    },
    {
      answers: { get_signers: ["0x2", "0xdead", key, "0x0", "0x0"] },
      liveClass: signing,
      name: "key is second stark signer",
    },
    { answers: { get_signers: ["0x0", "0x0", "0x0"] }, liveClass: signing, name: "no stark" },
    { ...strong(["0x0"], 1_000), name: "strong signer secp256r1" },
    {
      answers: {
        get_deferred_remove_signers: ["0x0"],
        get_signers: ["0x1", key, "0x0", "0x1", "0xbb"],
      },
      liveClass: signing,
      name: "strong signer webauthn",
    },
    { ...strong([], 1_000), name: "strong signer, empty removal read" },
    { ...strong(["0x5"], 3), name: "2FA removal before expire_at" },
    { ...strong(["0x5"], 5), name: "2FA removal at expire_at" },
    { ...strong(["0x5"], 6), name: "2FA removal after expire_at" },
    { answers: {}, liveClass: "0x9999", name: "release unknown" },
    { answers: {}, liveClass: BRAAVOS_DEPLOYMENT_CLASS_HASH, name: "release base class" },
    { answers: { get_signers: ["0x3", key] }, liveClass: signing, name: "malformed signers" },
    { answers: { get_signers: FAILS }, liveClass: signing, name: "signers read fails" },
    { ...strong(FAILS, 1_000), name: "removal read fails" },
    { ...strong(["0x5"], FAILS), name: "block read fails" },
  ];
};

// The scan's verdict is the function's answer, or none when it throws (`describeRecoveryAccount`).
const verdictVectors = async (kms: Kms) => {
  const shapes = recoveryScanShapes();
  const run = async (
    family: "argent" | "braavos",
    cases: (key: string) => readonly VerdictCase[],
  ) => {
    const shape = shapes.find((entry) => entry.accountContractType === family);
    if (!shape) throw new Error(`no ${family} shape`);
    const account = await derive(kms, shape, 0);
    const classify = family === "argent" ? argentSigningRestriction : braavosSigningRestriction;
    const out = [];
    for (const { answers, liveClass, name, timestamp } of cases(account.publicKeyX)) {
      const fake = recordingProvider(liveClass, answers, timestamp ?? FAILS);
      const subject = { address: account.address, publicKeyX: account.publicKeyX };
      const outcome = await classify(fake.provider, subject).then(
        (restriction) => ({ restriction, threw: false }),
        () => ({ restriction: null, threw: true }),
      );
      out.push({
        blockTimestamp: fake.blockTimestamp(),
        liveClass,
        name,
        reads: fake.reads,
        ...outcome,
      });
    }
    return { address: account.address, cases: out, publicKey: account.publicKeyX };
  };
  return { argent: await run("argent", argentCases), braavos: await run("braavos", braavosCases) };
};

const POOL = "0x5c0be7f9d2e7b8d1c2a3f4e5d6c7b8a9f0e1d2c3b4a5968778695a4b3c2d1e0";
const OWN_KEY = "0x2b1e4c8a7d6f5e3b9a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c";
const OTHER_KEY = "0x4f3e2d1c0b9a8f7e6d5c4b3a29180f7e6d5c4b3a2918f7e6d5c4b3a2918f7e";

type PoolCase = {
  readonly address?: string;
  readonly name: string;
  readonly own: string | typeof FAILS;
  readonly pool: string | null;
  readonly registered: string | typeof FAILS | null;
};

const POOL_CASES: readonly PoolCase[] = [
  { name: "no pool", own: OWN_KEY, pool: null, registered: OTHER_KEY },
  { name: "no reader", own: OWN_KEY, pool: POOL, registered: null },
  { name: "read fails", own: OWN_KEY, pool: POOL, registered: FAILS },
  { name: "read not a number", own: OWN_KEY, pool: POOL, registered: "zz" },
  { name: "no key", own: OWN_KEY, pool: POOL, registered: "0x0" },
  { name: "this wallet's key", own: OWN_KEY, pool: POOL, registered: OWN_KEY },
  {
    name: "this wallet's key, padded",
    own: OWN_KEY,
    pool: POOL,
    registered: `0x000${OWN_KEY.slice(2)}`,
  },
  { name: "another key", own: OWN_KEY, pool: POOL, registered: OTHER_KEY },
  { name: "another key, own key fails", own: FAILS, pool: POOL, registered: OTHER_KEY },
  {
    address: "not an address",
    name: "invalid address",
    own: OWN_KEY,
    pool: POOL,
    registered: OTHER_KEY,
  },
];

const poolVectors = async (kms: Kms) => {
  const shape = recoveryScanShapes()[0];
  if (!shape) throw new Error("no shape to register");
  const { address } = await derive(kms, shape, 0);
  const out = [];
  for (const entry of POOL_CASES) {
    // The pool reader remembers a non-zero key per process; each case starts clean.
    clearStrk20PoolKeyCache();
    let ownConsulted = false;
    const { registered } = entry;
    const registeredElsewhere = await strk20RegisteredElsewhere({
      address: entry.address ?? address,
      networkId: NETWORK_ID,
      ownPublicKey: async () => {
        ownConsulted = true;
        if (entry.own === FAILS) throw new Error("derivation failed");
        return entry.own;
      },
      poolAddress: entry.pool,
      readRegistered:
        registered === null
          ? undefined
          : async () => {
              if (registered === FAILS) throw new Error("pool read failed");
              return registered;
            },
      rpcUrls: ["https://parity.invalid"],
    });
    out.push({
      address: entry.address ?? address,
      name: entry.name,
      ownConsulted,
      ownKey: entry.own,
      poolAddress: entry.pool,
      registered,
      registeredElsewhere,
    });
  }
  clearStrk20PoolKeyCache();
  return out;
};

/** The recovery-scan fixtures, every expected value computed by the extension's own functions. */
export const computeScanParity = async () => {
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const header = { mnemonic: PARITY_MNEMONIC, networkId: NETWORK_ID };
  return {
    scan: {
      ...header,
      limits: RECOVERY_SCAN_LIMITS,
      passphrase: await passphraseVectors(kms),
      registeredElsewhere: await poolVectors(kms),
      scanTarget: await targetVectors(kms),
      shapes: await shapeVectors(kms),
    },
    signing: { ...header, ...(await verdictVectors(kms)) },
  };
};
