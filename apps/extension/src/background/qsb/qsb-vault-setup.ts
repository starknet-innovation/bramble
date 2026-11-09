/**
 * The commitments-only vault setup of the pinned QSB bridge
 * (`bridge.setup_from_commitments`): what the runtime sends it and what it
 * accepts back.
 *
 * Trust boundary: the commitments come from background code (Krusty KMS
 * derives them) and are checked here before any interpreter boots. The
 * bridge's reply is interpreter output and trusted for nothing: it is accepted
 * only as exactly its three public fields, with a script that hashes to the
 * returned hash (recomputed here with WebCrypto) and a public state that holds
 * the very commitments sent and the very script returned. Every refusal is a
 * fixed message that quotes neither the input nor the reply.
 *
 * Nothing here is secret: commitments, the script and the public state are all
 * public, and the bridge call draws no randomness.
 */
import { bytesToHex, hexToBytes, isLowercaseHexBytes } from "@bramble/core/hex";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  isQsbHash32,
  QSB_MAX_SCRIPT_BYTES,
  QSB_SECRETS_PER_ROUND,
} from "@bramble/vault/qsb-vault-record";

// Config A commits to two HORS rounds: round 0, then round 1.
const HORS_ROUNDS = 2;
// A commitment is the HASH160 of its secret.
const COMMITMENT_BYTES = 20;
const SETUP_FIELDS = ["publicStateJson", "scriptHash", "scriptHex"] as const;

/**
 * The longest JSON text the bridge's commitments-only calls read
 * (`bridge.MAX_JSON_TEXT`), and so the longest public state this adapter
 * accepts. `check:qsb` fails if the pinned bridge says otherwise.
 */
export const QSB_MAX_JSON_TEXT = 1_000_000;

/**
 * One vault's 2 × 150 HORS commitments as a caller holds them: round 0 then
 * round 1, each in index order, each 20 bytes of lowercase hex. The type is a
 * caller's claim only; {@link readQsbCommitmentRequest} checks every part.
 */
export type QsbHorsCommitments = readonly (readonly string[])[];

/**
 * A commitment list {@link readQsbCommitmentRequest} accepted: a private copy
 * the caller cannot change afterwards, and the exact JSON text the bridge reads.
 */
export type QsbCommitmentRequest = {
  readonly commitments: QsbHorsCommitments;
  readonly json: string;
};

/**
 * The vault one commitment list locks funds to, as the pinned bridge builds it.
 * All public: no HORS secret and no nonce.
 */
export type QsbVaultSetup = {
  /**
   * The pipeline's public state, the exact text the bridge wrote. Kept as
   * text: its curve integers exceed what a JavaScript number holds.
   */
  readonly publicStateJson: string;
  /** SHA-256 of the script, lowercase hex: the hash Esplora indexes a bare output by. */
  readonly scriptHash: string;
  /** The bare vault `scriptPubKey`, lowercase hex. */
  readonly scriptHex: string;
};

// One copy of each array, holes read as `undefined`, so what is checked is
// exactly what is sent.
const snapshot = (value: unknown): unknown =>
  Array.isArray(value)
    ? Array.from(value, (round: unknown) => (Array.isArray(round) ? Array.from(round) : round))
    : value;

const isRounds = (value: unknown): value is readonly (readonly unknown[])[] =>
  Array.isArray(value) &&
  value.length === HORS_ROUNDS &&
  value.every((round) => Array.isArray(round) && round.length === QSB_SECRETS_PER_ROUND);

const isCommitment = (value: unknown): value is string =>
  isLowercaseHexBytes(value, COMMITMENT_BYTES, COMMITMENT_BYTES);

const holdsOnlyCommitments = (
  rounds: readonly (readonly unknown[])[],
): rounds is QsbHorsCommitments => rounds.every((round) => round.every(isCommitment));

/**
 * Accepts exactly 2 rounds of 150 commitments, each 20 bytes of lowercase hex
 * and all 300 distinct — the bridge's own grammar, refused here so a malformed
 * list never reaches the interpreter. Throws a fixed message naming the rule
 * that failed; nothing is booted or run.
 */
export const readQsbCommitmentRequest = (value: unknown): QsbCommitmentRequest => {
  const rounds = snapshot(value);
  if (!isRounds(rounds)) {
    throw new Error("QSB commitments are not 2 rounds of 150");
  }
  if (!holdsOnlyCommitments(rounds)) {
    throw new Error("QSB commitment is not 20 bytes of lowercase hex");
  }
  if (new Set(rounds.flat()).size !== HORS_ROUNDS * QSB_SECRETS_PER_ROUND) {
    throw new Error("QSB commitment repeats");
  }
  return { commitments: rounds, json: JSON.stringify(rounds) };
};

const parsedJson = (text: unknown): unknown => {
  if (typeof text !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Exactly the three fields, each in its grammar.
const isSetupShape = (value: unknown): value is QsbVaultSetup =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, SETUP_FIELDS) &&
  SETUP_FIELDS.every((field) => Object.hasOwn(value, field)) &&
  typeof value["publicStateJson"] === "string" &&
  value["publicStateJson"].length <= QSB_MAX_JSON_TEXT &&
  isQsbHash32(value["scriptHash"]) &&
  isLowercaseHexBytes(value["scriptHex"], 1, QSB_MAX_SCRIPT_BYTES);

/**
 * SHA-256 of a script given as lowercase hex, as lowercase hex: the script
 * hash the coordinator binds a vault to. Null for anything that is not hex.
 */
export const qsbScriptHash = async (scriptHex: string): Promise<string | null> => {
  const script = hexToBytes(scriptHex);
  return script === null
    ? null
    : bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", script as BufferSource)));
};

// The public state must describe the vault asked for: the commitments sent,
// in their order, and the script the reply returned.
const describesVault = (
  state: unknown,
  request: QsbCommitmentRequest,
  scriptHex: string,
): boolean =>
  isRecord(state) &&
  JSON.stringify(state["hors_commitments"]) === request.json &&
  state["full_script_hex"] === scriptHex;

/**
 * Accepts the bridge's reply to `request` only if it is JSON text of exactly
 * `publicStateJson`, `scriptHash` and `scriptHex`; the script is 1 to 10,000
 * bytes of lowercase hex whose SHA-256 is `scriptHash`; and the public state,
 * at most a million characters, parses to an object holding the requested
 * commitments and that script. Rejects with a fixed message otherwise.
 */
export const readQsbVaultSetup = async (
  raw: unknown,
  request: QsbCommitmentRequest,
): Promise<QsbVaultSetup> => {
  const reply = parsedJson(raw);
  if (!isSetupShape(reply)) {
    throw new Error("QSB commitments setup returned an unexpected shape");
  }
  if ((await qsbScriptHash(reply.scriptHex)) !== reply.scriptHash) {
    throw new Error("QSB vault script does not match its hash");
  }
  if (!describesVault(parsedJson(reply.publicStateJson), request, reply.scriptHex)) {
    throw new Error("QSB public state does not match the requested vault");
  }
  return {
    publicStateJson: reply.publicStateJson,
    scriptHash: reply.scriptHash,
    scriptHex: reply.scriptHex,
  };
};
