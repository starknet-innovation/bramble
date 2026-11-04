/**
 * What Bramble registers with the coordinator for one vault: public data
 * only, built from what the pinned bridge's `setup_from_commitments` returned
 * for Krusty's commitments (qsb-app `sdk/client.ts` `createVault`, and
 * `publicVaultSchema` in `src/lib/model.ts`).
 *
 * The public state is checked exactly as the coordinator checks it
 * (`validatePublicState`, ported) before it is sent, and sent as the bridge's
 * own text, never re-serialized. The body names no funding and no index `v`:
 * which vault of an account it is lives in Bramble's journal alone.
 *
 * Pure: the id and the creation time are the caller's, drawn at its
 * randomness and clock boundaries.
 */
import { isRecord } from "@bramble/core/json";
import { QSB_COORDINATOR_NETWORK } from "../coordinator/origin";
import { qsbVaultConfiguration } from "./configuration";

/** The three public fields the bridge returns for one vault. */
export type QsbVaultScript = {
  readonly publicStateJson: string;
  readonly scriptHash: string;
  readonly scriptHex: string;
};

/** The longest public state the coordinator stores (`publicVaultSchema`). */
export const QSB_MAX_PUBLIC_STATE_LENGTH = 60_000;

/** The public name every Bramble vault is registered under. */
export const QSB_VAULT_NAME = "Bramble vault";

// `validatePublicState`'s field list: the public half of the pipeline state.
const PUBLIC_STATE_FIELDS = [
  "config",
  "hash_mode",
  "n",
  "t1s",
  "t1b",
  "t2s",
  "t2b",
  "hors_commitments",
  "dummy_sigs",
  "pin_r",
  "pin_s",
  "pin_sig",
  "round_sigs",
  "full_script_hex",
];
const ROUND_FIELDS = ["r", "s", "sig"];

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * qsb-app's `validatePublicState`, as a predicate: only public fields, Config
 * A with SHA-256 HORS over n = 150, and round entries holding only `r`, `s`
 * and `sig`. Also bounded to what the coordinator stores. False where the
 * original throws.
 */
export const isQsbPublicState = (text: string): boolean => {
  const state = text.length <= QSB_MAX_PUBLIC_STATE_LENGTH ? parsed(text) : undefined;
  if (!isRecord(state) || Object.keys(state).some((key) => !PUBLIC_STATE_FIELDS.includes(key))) {
    return false;
  }
  const rounds = state["round_sigs"];
  return (
    state["config"] === "A" &&
    state["hash_mode"] === "sha256" &&
    state["n"] === 150 &&
    Array.isArray(rounds) &&
    rounds.every(
      (round) => isRecord(round) && Object.keys(round).every((key) => ROUND_FIELDS.includes(key)),
    )
  );
};

/**
 * The `POST /v1/vaults` body for `script`, owned by `owner` (the address
 * exactly as it signed in), with the caller's `id` (a random uuid) and
 * `createdAt` (ISO 8601, `Z`). Returns null when the public state is not one
 * the coordinator would accept, so nothing malformed is ever sent.
 */
export const qsbVaultRegistration = (input: {
  readonly createdAt: string;
  readonly id: string;
  readonly owner: string;
  readonly script: QsbVaultScript;
}): Readonly<Record<string, unknown>> | null => {
  const { script } = input;
  if (!isQsbPublicState(script.publicStateJson)) {
    return null;
  }
  return {
    config: "A",
    configuration: qsbVaultConfiguration({ ...script, network: QSB_COORDINATOR_NETWORK }),
    createdAt: input.createdAt,
    id: input.id,
    name: QSB_VAULT_NAME,
    network: QSB_COORDINATOR_NETWORK,
    paymentAddress: input.owner,
    publicStateJson: script.publicStateJson,
    scriptHash: script.scriptHash,
    scriptHex: script.scriptHex,
    status: "unfunded",
  };
};
