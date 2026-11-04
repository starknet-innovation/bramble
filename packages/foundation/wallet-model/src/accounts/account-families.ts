/**
 * Known account contract classes for the wallet families a user can import,
 * and the constructor convention each one deploys with.
 *
 * Two facts make this table necessary, and both were established by checking
 * real Mainnet accounts rather than by reading documentation.
 *
 * **A class hash plays one of two roles.** A *deployment* class fixes the
 * contract address and is what an account must be derived from to be found at
 * all. An *implementation* class is what the account runs today, usually after
 * upgrading itself, and is what a transaction must be authorised against. They are rarely
 * the same: every Braavos account sampled ran a different class than it was
 * deployed with. Deriving from an implementation class finds nothing, and
 * refusing to accept one rejects working accounts.
 *
 * **The constructor convention belongs to the class, not the family.** Argent
 * 0.3.x takes `(owner, guardian)`; 0.4.0 takes a signer-type prefix and a
 * guardian option. Pairing a correct class with the wrong calldata produces a
 * plausible address that matches nothing, which is indistinguishable from the
 * account not existing.
 *
 * This set is deliberately incomplete and known to be so. Krusty's published
 * `getAccountClassHashes()` omits the Braavos deployment class and its current
 * implementation, and documents one Argent constructor shape for all versions;
 * starknet-innovation/krusty-kms#146 tracks curating it upstream. Until that
 * lands these values live here. **When #146 ships, this table should be derived
 * from Krusty rather than restated**, so there is one source of truth again.
 */

import { sameFelt } from "../networks/networks";

/**
 * The Argent Account 0.4 class this wallet deploys when it creates an Argent
 * account. Defined here, beside the rest of the class table, so the account
 * validators can consult the table without a dependency cycle.
 */
export const ARGENT_ACCOUNT_CLASS_HASH =
  "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";

/**
 * The Argent 0.4 build Xverse deploys its Starknet accounts at since
 * 2025-06-30 (xverse-core `argentXContractClassHashV0_4_0`). It is declared on
 * Mainnet with Argent's ABI and the 0.4.0 constructor `(owner: Signer,
 * guardian: Option<Signer>)`, but is not in Argent's own deployment list. Xverse
 * derives keys on this wallet's own ladder (`m/44'/9004'/{i}'/0/0`) with salt =
 * public key and no guardian, so its accounts are scanned there, never on
 * Ready's ladder (issue 734).
 */
export const XVERSE_ARGENT_CLASS_HASH =
  "0x0663fc01a0dbe1bacc4cd2a4c856eb9784b255a20988aa33d4d52b6fc20bd024";

/**
 * Wallet families whose accounts this wallet can derive addresses for. OpenZeppelin
 * is absent on purpose: its class hash is resolved from Krusty per network at
 * runtime, and restating it here would create the second copy that resolution
 * exists to avoid.
 */
export type AccountFamily = "argent" | "braavos";

/**
 * What a class hash can be used for.
 *
 * `deployment` fixes an address, so it is the set to derive candidates from.
 * It means "an account may have been deployed with this class", not "this
 * wallet deploys it": deploying is gated separately in `transactions/deployment.ts`.
 * `implementation` is what an upgraded account runs, so it is the set a
 * deployed account may legitimately be found running. A class can be both.
 */
export type AccountClassRole = "deployment" | "implementation";

/**
 * Constructor calldata conventions observed on chain, named for what they carry
 * rather than for a version, since more than one class shares each shape.
 *
 * `owner-guardian` and `signer-owner-guardian-option` both encode "no guardian";
 * an account deployed *with* a guardian carries a per-account value that is not
 * derivable from a recovery phrase, which is why no shape here accepts one.
 */
export type AccountConstructorShape =
  | "owner-guardian"
  | "public-key"
  | "signer-owner-guardian-option";

/**
 * How a class expects a transaction to be authorised, which also differs by
 * version rather than by family.
 *
 * `stark-pair` is a bare `(r, s)`. `argent-signer-array` is Argent 0.4's array-of-signers encoding. Producing one where the other is expected yields a
 * transaction the account rejects, so a class whose shape this wallet does not
 * produce must not be treated as usable, however well we can find it.
 */
export type AccountAuthorizationShape = "argent-signer-array" | "stark-pair";

/** One known class, with everything needed to derive or accept an account. */
export type AccountClassEntry = {
  readonly authorizationShape: AccountAuthorizationShape;
  readonly classHash: string;
  readonly constructorShape: AccountConstructorShape;
  readonly family: AccountFamily;
  /** Human label for diagnostics and test names; never parsed. */
  readonly label: string;
  readonly roles: readonly AccountClassRole[];
};

/**
 * Braavos deploys a base account class that immediately upgrades itself. The
 * implementation it becomes is named elsewhere in the deploy transaction, not
 * in its `class_hash`, so the address derives from this base class — which is
 * why it appears in no list of Braavos "account" classes.
 */
export const BRAAVOS_BASE_CLASS_HASH =
  "0x13bfe114fb1cf405bfc3a7f8dbe2d91db146c17521d40dcf57e16d6b59fa8e6";

/**
 * The deployment class the current Braavos app pins counterfactual addresses
 * to (labelled "braavos 1.0.0" in the table): a base-style account whose
 * constructor replaces itself with the implementation named in the deploy
 * transaction's extended authorization. The only Braavos class this wallet can
 * deploy; older base-class counterfactuals are refused, since their expected
 * deployment authorization has not been established.
 */
export const BRAAVOS_DEPLOYMENT_CLASS_HASH =
  "0x03d16c7a9a60b0593bd202f660a28c5d76e0403601d9ccc7e4fa253b6a70c201";

/**
 * The implementation a wallet-made Braavos deployment installs (the table's
 * "braavos current"): carried out-of-band in the deploy authorization and
 * poseidon-signed beside it, exactly as the vendor app deploys.
 */
export const BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH =
  "0x3957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";

/**
 * The older Braavos implementation class (the table's "braavos legacy") that
 * accounts upgraded before the current release still run.
 */
export const BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH =
  "0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253";

/**
 * The Braavos classes a deployed account may be found RUNNING when this wallet
 * signs for it: implementation releases that expose `get_signers` and verify a
 * bare `(r, s)` against the first stark signer. The deployment classes are
 * deliberately absent — their constructors replace themselves with an
 * implementation, so a live account reporting one is not a state whose
 * authorization rules this wallet has established, and it is refused.
 */
export const BRAAVOS_SIGNING_CLASS_HASHES: readonly string[] = [
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
];

/**
 * Refusal for a transaction from an undeployed Braavos counterfactual: its
 * deployment is its own reviewed step, never folded into another transaction.
 * One string for the transaction refusal, the Home notice, and the approval card.
 */
export const UNDEPLOYED_BRAAVOS_REFUSAL = "Deploy this account first (Settings → Deploy account).";

/**
 * Whether an account is a Braavos counterfactual on the one deployment class
 * this wallet deploys. While undeployed it can deploy only through the explicit
 * deployment (its deployment authorization covers an extra hash first), so every
 * deploy-then-act path refuses it with {@link UNDEPLOYED_BRAAVOS_REFUSAL}.
 */
export const isDeployableBraavos = (account: {
  readonly accountContractType: string;
  readonly classHash: string;
}): boolean =>
  account.accountContractType === "braavos" &&
  sameFelt(account.classHash, BRAAVOS_DEPLOYMENT_CLASS_HASH);

/**
 * Every class this wallet recognises, with its role and constructor shape.
 * Ordered most-common-first so a candidate scan finds the usual case early.
 */
export const ACCOUNT_CLASSES: readonly AccountClassEntry[] = [
  {
    authorizationShape: "stark-pair",
    classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
    constructorShape: "public-key",
    family: "braavos",
    label: "braavos 1.0.0",
    roles: ["deployment", "implementation"],
  },
  {
    authorizationShape: "stark-pair",
    classHash: BRAAVOS_BASE_CLASS_HASH,
    constructorShape: "public-key",
    family: "braavos",
    label: "braavos base",
    roles: ["deployment"],
  },
  {
    authorizationShape: "stark-pair",
    classHash: BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
    constructorShape: "public-key",
    family: "braavos",
    label: "braavos current",
    roles: ["implementation"],
  },
  {
    authorizationShape: "stark-pair",
    classHash: BRAAVOS_LEGACY_IMPLEMENTATION_CLASS_HASH,
    constructorShape: "public-key",
    family: "braavos",
    label: "braavos legacy",
    roles: ["implementation"],
  },
  {
    authorizationShape: "stark-pair",
    classHash: "0x029927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b",
    constructorShape: "owner-guardian",
    family: "argent",
    label: "argent 0.3.1",
    roles: ["deployment", "implementation"],
  },
  {
    authorizationShape: "stark-pair",
    classHash: "0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003",
    constructorShape: "owner-guardian",
    family: "argent",
    label: "argent 0.3.0",
    roles: ["deployment", "implementation"],
  },
  {
    authorizationShape: "argent-signer-array",
    classHash: ARGENT_ACCOUNT_CLASS_HASH,
    constructorShape: "signer-owner-guardian-option",
    family: "argent",
    label: "argent 0.4.0",
    roles: ["deployment", "implementation"],
  },
  {
    authorizationShape: "argent-signer-array",
    classHash: XVERSE_ARGENT_CLASS_HASH,
    constructorShape: "signer-owner-guardian-option",
    family: "argent",
    label: "argent 0.4.0 (Xverse)",
    roles: ["deployment", "implementation"],
  },
];

/**
 * Constructor calldata for one signer public key under the given convention.
 * Pure: the caller hashes it into an address, this only decides the felts.
 *
 * Exhaustive by construction (Sherlock 240): a new constructor shape is a
 * build failure here until its layout is written, never a silent fall-through
 * to another version's convention and so a wrong derived address.
 */
export const accountConstructorCalldata = (
  shape: AccountConstructorShape,
  publicKey: string,
): readonly string[] => {
  switch (shape) {
    case "public-key":
      return [publicKey];
    case "owner-guardian":
      return [publicKey, "0x0"];
    case "signer-owner-guardian-option":
      return ["0x0", publicKey, "0x1"];
    default: {
      const unreachable: never = shape;
      throw new Error(`unknown account constructor shape: ${String(unreachable)}`);
    }
  }
};

/**
 * Classes an address can be derived from. Implementation-only classes are
 * excluded because an account never had their hash at deployment, so deriving
 * from one yields an address that belongs to nobody.
 */
export const deploymentClasses = (family?: AccountFamily): readonly AccountClassEntry[] =>
  ACCOUNT_CLASSES.filter(
    (entry) =>
      entry.roles.includes("deployment") && (family === undefined || entry.family === family),
  );

/**
 * The catalog entry for a deployed class hash, or null when it is not one this
 * wallet recognises.
 */
export const accountClassEntry = (classHash: string): AccountClassEntry | null => {
  const target = classHash.toLowerCase().replace(/^0x0*/, "");
  return (
    ACCOUNT_CLASSES.find(
      (entry) => entry.classHash.toLowerCase().replace(/^0x0*/, "") === target,
    ) ?? null
  );
};

/**
 * Whether a class found deployed on chain is one this wallet recognises. Used
 * in place of equality against a single pinned hash, which rejects every
 * account that has upgraded since it was created.
 */
export const isKnownAccountClass = (classHash: string, family?: AccountFamily): boolean => {
  const target = classHash.toLowerCase().replace(/^0x0*/, "");
  return ACCOUNT_CLASSES.some(
    (entry) =>
      (family === undefined || entry.family === family) &&
      entry.classHash.toLowerCase().replace(/^0x0*/, "") === target,
  );
};
