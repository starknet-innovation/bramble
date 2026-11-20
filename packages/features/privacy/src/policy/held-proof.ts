/**
 * A proof request compiled once and proved later. The privacy SDK draws fresh
 * random values every time it compiles actions, and those values are inside
 * the pool authorization the account signs. An Argent multisig collects that
 * authorization from co-owners after compiling, so compiling again would
 * produce a digest none of them signed. The account keeps the compiled request
 * instead and proves exactly that request once every co-owner has signed.
 */

/** One compiled proof request and the block it must be proved against. */
export type Strk20HeldProofRequest = {
  /**
   * The SDK's compiled `INVOKE_TXN_V3`. Callers treat its shape as untrusted
   * and bind its calldata to the signed digest before proving it.
   */
  readonly invocation: Readonly<Record<string, unknown>>;
  readonly provingBlock: number;
};

/**
 * Hooks that let an account prove a request compiled earlier. Absent for a
 * single-signer account, which signs while the SDK compiles.
 */
export type Strk20HeldProofHooks = {
  /**
   * Receives each freshly compiled request before it is proved. Returns the
   * request to prove, carrying the account's complete authorization, or throws to
   * stop before any proof is made.
   */
  readonly hold: (compiled: Strk20HeldProofRequest) => Promise<Strk20HeldProofRequest>;
  /**
   * A request compiled earlier whose authorization is now complete, to prove
   * instead of compiling a new one. Null means compile as usual.
   */
  readonly resume: () => Promise<Strk20HeldProofRequest | null>;
};
