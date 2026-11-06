/**
 * Whether a stored STRK20 proof is still inside the pool's block span.
 *
 * The pool deserializes `ProofFacts` and accepts the transaction only when
 * `base_block < current_block <= base_block + proof_validity_blocks`. Felt 4
 * is the base block. Felt 7 is the length of the message-hash span, and the
 * span must consume the rest of the facts. Any other layout is not submitted.
 */

const SPAN_INDEX = 7;
const BASE_INDEX = 4;
const MAX_MESSAGE_HASHES = 64;

const felt = (value: string): bigint | null => {
  if (!/^0x[0-9a-f]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

/**
 * Reads the base block from serialized proof facts. Returns null when the
 * facts are not the pool's `ProofFacts` layout, so a caller fails closed.
 */
export const strk20ProofBaseBlock = (facts: readonly string[]): bigint | null => {
  if (facts.length < SPAN_INDEX + 2) return null;
  const span = felt(facts[SPAN_INDEX] ?? "");
  const base = felt(facts[BASE_INDEX] ?? "");
  if (
    span === null ||
    base === null ||
    span < 1n ||
    span > BigInt(MAX_MESSAGE_HASHES) ||
    facts.length !== SPAN_INDEX + 1 + Number(span)
  ) {
    return null;
  }
  return base;
};

/**
 * True only while the pool would still accept this base block. A zero window,
 * a base block that is not yet in the past, and a block past the window are
 * all false.
 */
export const strk20ProofSubmittable = (input: {
  readonly baseBlock: bigint;
  readonly currentBlock: bigint;
  readonly validityBlocks: bigint;
}): boolean =>
  input.validityBlocks > 0n &&
  input.currentBlock > input.baseBlock &&
  input.currentBlock <= input.baseBlock + input.validityBlocks;
