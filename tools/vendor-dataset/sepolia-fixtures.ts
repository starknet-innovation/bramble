/**
 * Shared plumbing for the Sepolia stage (issue 821): the fixture shape every
 * seed file exports, the idempotent steps they compose (top up, self-deploy,
 * invoke), and the runner that records each outcome in manifest/sepolia/.
 * Every step checks chain state first, so a re-run resumes where the last one
 * stopped. Prints addresses and transaction hashes only.
 */
import { Account, type SignerInterface } from "starknet";
import {
  classAt,
  deployerAccount,
  type FixtureOutcome,
  loadManifest,
  type ManifestEntry,
  NETWORK,
  provider,
  runFixture,
  saveManifest,
  type TOKENS,
  tokenBalance,
  transfer,
} from "./matrix-lib";
import { type SepoliaSecret, sepoliaSecret } from "./sepolia-seeds";

if (NETWORK !== "sepolia") throw new Error("set BRAMBLE_DATASET_NETWORK=sepolia");

export const STRK = 10n ** 18n;
// Covers the fee cap starknet.js signs for, not the fee paid (~0.05 STRK): a
// secp256k1-validated deploy caps near 1.3 STRK, and the cap must fit the balance.
const FEE_FLOAT = 2n * STRK;

export const deployer = deployerAccount();

/** One test account: its manifest identity plus the step that brings the chain to its target state. */
export type SepoliaFixture = Omit<ManifestEntry, "state" | "log"> & {
  readonly step: (entry: ManifestEntry) => Promise<FixtureOutcome>;
};

export const norm = (a: string): string => `0x${BigInt(a).toString(16)}`;
const short = (s: string): string => `${s.slice(0, 10)}…`;

/** Tops `address` up to `amount` of `token` from the deployer; no-op when it already holds that much. */
export async function topUp(
  entry: ManifestEntry,
  token: keyof typeof TOKENS,
  amount: bigint,
  address = entry.address,
): Promise<void> {
  const balance = await tokenBalance(token, address);
  if (balance >= amount) return;
  const tx = await transfer(deployer, token, address, amount - balance);
  entry.log.push(`funded ${token} ${tx}`);
  console.log(`   funded ${token}: ${short(tx)}`);
}

/** Counterfactual self-deploy from a fee float the deployer sends; skipped when already deployed. */
export async function selfDeploy(
  entry: ManifestEntry,
  deploy: {
    readonly signer: string | SignerInterface;
    readonly classHash: string;
    readonly calldata: readonly string[];
    readonly salt: string;
  },
): Promise<string | null> {
  if (await classAt(entry.address)) return classAt(entry.address);
  await topUp(entry, "STRK", FEE_FLOAT);
  const account = new Account({
    provider,
    address: entry.address,
    signer: deploy.signer,
    cairoVersion: "1",
  });
  const { transaction_hash } = await account.deployAccount(
    {
      classHash: deploy.classHash,
      constructorCalldata: [...deploy.calldata],
      addressSalt: deploy.salt,
    },
    { skipValidate: false },
  );
  await provider.waitForTransaction(transaction_hash);
  entry.log.push(`deployed ${transaction_hash}`);
  console.log(`   deployed: ${short(transaction_hash)}`);
  return classAt(entry.address);
}

/** Has the account call one of its own entrypoints, signed by `signer`. */
export async function invokeSelf(
  entry: ManifestEntry,
  signer: string | SignerInterface,
  entrypoint: string,
  calldata: readonly string[],
): Promise<void> {
  const account = new Account({ provider, address: entry.address, signer, cairoVersion: "1" });
  const { transaction_hash } = await account.execute({
    contractAddress: entry.address,
    entrypoint,
    calldata: [...calldata],
  });
  await provider.waitForTransaction(transaction_hash);
  entry.log.push(`${entrypoint} ${transaction_hash}`);
  console.log(`   ${entrypoint}: ${short(transaction_hash)}`);
}

/** First felt a no-argument view returns, or 0 when the call fails. */
export async function viewFelt(address: string, entrypoint: string): Promise<bigint> {
  const result = await provider
    .callContract({ contractAddress: address, entrypoint, calldata: [] })
    .catch(() => []);
  return BigInt(result[0] ?? "0x0");
}

/**
 * Runs `fixtures` in order (only ids containing `filter`, when given),
 * persisting the manifest after each so an interrupted run loses nothing.
 */
export async function runSepoliaFixtures(
  fixtures: readonly SepoliaFixture[],
  filter?: string,
): Promise<void> {
  const manifest = loadManifest();
  for (const { step, ...identity } of fixtures) {
    if (filter && !identity.id.includes(filter)) continue;
    // Identity comes from the spec; state and log carry over from earlier runs.
    const { state, log } = manifest[identity.id] ?? { state: {}, log: [] };
    manifest[identity.id] = await runFixture({ ...identity, state, log }, step);
    saveManifest(manifest);
  }
}

/** An app- or device-made phrase, or null (with a note) until it is in the seed file. */
export const appSeed = (name: SepoliaSecret, skips: string): string | null => {
  try {
    return sepoliaSecret(name);
  } catch {
    console.log(`${name} not in the seed file: skipping ${skips}`);
    return null;
  }
};

/** Funds an account once from the bank; the app's own first transaction deploys it. */
export const fundForApp =
  (amount: bigint, app: string): SepoliaFixture["step"] =>
  async (e) => {
    const liveClass = await classAt(e.address);
    if (!liveClass && !e.log.some((l) => l.startsWith("funded"))) await topUp(e, "STRK", amount);
    return { state: { deployed: liveClass !== null, deployedBy: app, liveClass } };
  };
