/**
 * The kept directory for one multisig privacy round: two browser profiles and
 * a small record naming the multisig being exercised. The record holds no key.
 * It exists so a round that died can be found and its funds returned by the
 * next run, from the same checkout.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "@bramble/core/json";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Git-ignored home of the round. Bound to this checkout, like `.dev-profile/`. */
export const ROUND_DIRECTORY = resolve(repoRoot, ".mainnet-multisig-e2e");

const RECORD_FILE = "round.json";

/**
 * What a run needs to find a round again. `salt` selects the multisig address
 * together with the two owner keys; `multisigAddress` is written once the
 * wallet has computed it, before any STRK is sent there.
 */
export type RoundRecord = {
  readonly multisigAddress?: string;
  readonly salt: string;
  readonly version: 1;
};

const isCanonicalFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

/**
 * Parses a stored record. Returns null for anything that is not exactly a
 * version 1 record with canonical felts, so a damaged file is never trusted.
 */
export const parseRoundRecord = (text: string): RoundRecord | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value["version"] !== 1 || !isCanonicalFelt(value["salt"])) {
    return null;
  }
  const address = value["multisigAddress"];
  if (address !== undefined && !isCanonicalFelt(address)) {
    return null;
  }
  return {
    ...(address === undefined ? {} : { multisigAddress: address }),
    salt: value["salt"],
    version: 1,
  };
};

/** Profile directory of one owner's wallet inside `directory`. */
export const ownerProfile = (directory: string, role: "a" | "b"): string =>
  join(directory, `owner-${role}`);

/**
 * Reads the record left in `directory`. `none` means no round is kept there.
 * `damaged` means a file exists that cannot be trusted: the caller must stop
 * rather than start a new round over funds it cannot name.
 */
export const readRound = async (
  directory: string,
): Promise<
  | { readonly kind: "damaged" }
  | { readonly kind: "none" }
  | { readonly kind: "kept"; readonly record: RoundRecord }
> => {
  let text: string;
  try {
    text = await readFile(join(directory, RECORD_FILE), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { kind: "none" };
    }
    throw error;
  }
  const record = parseRoundRecord(text);
  return record ? { kind: "kept", record } : { kind: "damaged" };
};

/** Writes the record, creating the directory readable by its owner only. */
export const writeRound = async (directory: string, record: RoundRecord): Promise<void> => {
  await mkdir(directory, { mode: 0o700, recursive: true });
  await writeFile(join(directory, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
};

/**
 * Removes the round and both profiles. Call only after the multisig's funds
 * were returned: the profiles hold the only copy of its viewing key.
 */
export const clearRound = async (directory: string): Promise<void> => {
  await rm(directory, { force: true, recursive: true });
};
