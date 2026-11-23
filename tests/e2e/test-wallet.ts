/**
 * The public test wallet both browser suites drive, without Playwright: the
 * Chromium E2E re-exports these through `wallet-helpers.ts`, and the Firefox
 * smoke (`tests/firefox/smoke.ts`), which cannot load Playwright, imports them
 * from here. One definition keeps the two browsers on the same phrase, the
 * same address, and the same empty chain.
 *
 * Everything here is public by construction. Never fund an address derived
 * from {@link IMPORT_MNEMONIC}.
 */

/** Passphrase the suites protect a test vault with. */
export const VAULT_PASSPHRASE = "correct horse battery staple";

/** Valid 12-word phrase used to exercise the import-wallet path without generation. */
export const IMPORT_MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

/**
 * Bramble's own account (OpenZeppelin 3.0.0, salt 0) at index 0 of
 * {@link IMPORT_MNEMONIC}: the account a first-run restore of the first index
 * creates. Pinned as a literal so a browser suite compares against a fixed
 * value; `tests/firefox/expected-account.test.ts` re-derives it with the
 * vendor-dataset tooling, independently of Krusty, so it cannot drift.
 */
export const EXPECTED_IMPORT_ACCOUNT =
  "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9";

type RpcCall = { readonly id?: unknown; readonly method?: unknown };

type RpcReply = {
  readonly error?: { readonly code: number; readonly message: string };
  readonly id: unknown;
  readonly jsonrpc: "2.0";
  readonly result?: readonly string[];
};

const isRpcCall = (value: unknown): value is RpcCall =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Class hash and balance are the reads recovery needs: contract-not-found and a
// zero uint256. Every other method gets a JSON-RPC error. Aborting the
// connection instead would fail import on an incidental method the scan does
// not use.
const reply = (call: RpcCall): RpcReply => {
  const id = call.id ?? null;
  if (call.method === "starknet_getClassHashAt") {
    return { error: { code: 20, message: "Contract not found" }, id, jsonrpc: "2.0" };
  }
  if (call.method === "starknet_call") {
    return { id, jsonrpc: "2.0", result: ["0x0", "0x0"] };
  }
  return { error: { code: -32601, message: "Method not found" }, id, jsonrpc: "2.0" };
};

/**
 * Answers a parsed JSON-RPC body as a chain where nothing is deployed and
 * every balance is zero, batch or single. The body is untrusted test traffic
 * and is never thrown on: a non-object single body is answered as an unknown
 * method, and a non-object entry in a batch is dropped from the reply.
 */
export const emptyChainRpcResponse = (body: unknown): RpcReply | readonly RpcReply[] =>
  Array.isArray(body) ? body.filter(isRpcCall).map(reply) : reply(isRpcCall(body) ? body : {});
