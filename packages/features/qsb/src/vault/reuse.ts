/**
 * The reuse scan: no vault of this owner may already push one of the HORS
 * commitments a new vault (or a deposit's vault) is built from. A key set
 * locks exactly one vault, which takes exactly one deposit; a second script
 * over the same secrets would be weakened by the first withdrawal's disclosed
 * preimages. The coordinator binds a vault to its script hash only and never
 * checks the commitments a public state declares, so only the client can.
 *
 * Ported from qsb-app `sdk/client.ts` `sharingSecrets`: each commitment is a
 * 20-byte push, `14` followed by the commitment, searched in every listed
 * script, lowercased. A chance match elsewhere in a script only refuses.
 * Pure.
 */

/** One vault's script, as the coordinator lists it. */
export type QsbListedScript = {
  readonly scriptHash: string;
  readonly scriptHex: string;
};

/**
 * Whether any of `scripts` pushes one of the 2 × 150 `commitments`. The
 * caller excludes the vault's own registration, found by script hash, first.
 */
export const pushesAnyCommitment = (
  scripts: readonly QsbListedScript[],
  commitments: readonly (readonly string[])[],
): boolean => {
  const pushes = commitments.flat().map((commitment) => `14${commitment.toLowerCase()}`);
  return scripts.some((vault) => {
    const script = vault.scriptHex.toLowerCase();
    return pushes.some((push) => script.includes(push));
  });
};
