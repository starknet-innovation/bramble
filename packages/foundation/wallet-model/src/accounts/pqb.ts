/** Public PQB material and ordered disclosure selections. No spending seeds cross this boundary. */
export type PqbPublicMaterial = {
  readonly script: string;
  readonly scriptSha256: string;
  readonly commitments: readonly string[];
  readonly cosigPublicKey: string;
  readonly menus: readonly PqbPublicMenu[];
};
/** Public grinder recovery points, indexed by variant then menu entry. */
export type PqbPublicMenu = {
  readonly r: string;
  readonly commitments: readonly string[];
  readonly recoveryPoints: readonly (readonly string[])[];
};
/** One full unsigned transaction and its ordered PQB selections; never a raw signing digest. */
export type PqbDisclosureRequest = {
  readonly transaction: string;
  readonly scriptHash: string;
  readonly round0: readonly number[];
  readonly round1: readonly number[];
  readonly menus: readonly number[];
};
/** Bounds of the fixed real-puzzle profile, shared by persistence and validation. */
export const PQB_LIMITS = {
  scriptBytes: 4908,
  table: 109,
  round0: 8,
  round1: 9,
  menus: [12, 16, 16],
} as const;
/** Exact ordered selections; rejects duplicates across rounds and unbounded menu choices. */
export const isPqbSelection = (value: {
  readonly round0: readonly number[];
  readonly round1: readonly number[];
  readonly menus: readonly number[];
}): boolean => {
  const { round0, round1, menus } = value;
  return (
    Array.isArray(round0) &&
    Array.isArray(round1) &&
    Array.isArray(menus) &&
    round0.length === PQB_LIMITS.round0 &&
    round1.length === PQB_LIMITS.round1 &&
    [...round0, ...round1].every(
      (i) => Number.isSafeInteger(i) && i >= 0 && i < PQB_LIMITS.table,
    ) &&
    new Set([...round0, ...round1]).size === PQB_LIMITS.round0 + PQB_LIMITS.round1 &&
    menus.length === PQB_LIMITS.menus.length &&
    [...menus].every(
      (i, at) => Number.isSafeInteger(i) && i >= 0 && i < (PQB_LIMITS.menus[at] ?? 0),
    )
  );
};
/** Public preparation: verified hit keys and stage sighashes bound to the exact transaction. */
export type PqbPrepared = PqbDisclosureRequest & {
  readonly keys: readonly string[];
  readonly sighashes: readonly string[];
};
/** Selective witness output from Krusty. Spending material; background assembly only. */
export type PqbWitness = {
  readonly round0: readonly string[];
  readonly round1: readonly string[];
  readonly menus: readonly string[];
  readonly cosignature: string;
};
/** Copies an ordered request before any asynchronous work so later caller mutation cannot change authorization. */
export const snapshotPqbRequest = (request: PqbDisclosureRequest): PqbDisclosureRequest => ({
  transaction: request.transaction,
  scriptHash: request.scriptHash,
  round0: [...request.round0],
  round1: [...request.round1],
  menus: [...request.menus],
});

/** PQB releases eight initial and nine chained preimages. */
export const PQB_DISCLOSED_SECRETS = 17;

/** Public coordinator identity of the pinned real-puzzle PQB generator. */
export const PQB_VAULT_PROTOCOL = {
  protocol: "pqb-v1",
  generatorCommit: "eccdd09772edf14ab37fc63992b0626ad7ff2221",
} as const;
