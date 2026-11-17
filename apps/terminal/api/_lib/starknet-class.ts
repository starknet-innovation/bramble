/**
 * Server-side mainnet class-hash read for the private-swap executor pin (#269).
 * The node is the public Starknet Foundation endpoint the browser also uses; it
 * is fixed here rather than taken from the environment so an operator setting
 * cannot change which chain state the pin is checked against.
 */
export const STARKNET_MAINNET_RPC_URL = "https://mainnet.nodes.starknet.org/rpc/v0_10";

const CLASS_READ_TIMEOUT_MS = 10_000;
const MAX_RPC_RESPONSE_CHARACTERS = 4_096;

/**
 * Returns the class hash deployed at `address` on mainnet at the latest block.
 * Throws on any transport, HTTP, size, or JSON-RPC error so callers fail closed;
 * the result is returned unvalidated for the caller's felt check.
 */
export const readMainnetClassHash = async (address: string): Promise<unknown> => {
  const response = await fetch(STARKNET_MAINNET_RPC_URL, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_getClassHashAt",
      params: { block_id: "latest", contract_address: address },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(CLASS_READ_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok || text.length > MAX_RPC_RESPONSE_CHARACTERS) {
    throw new Error("class hash read failed");
  }
  const body = JSON.parse(text) as { readonly error?: unknown; readonly result?: unknown };
  if (body.error !== undefined || body.result === undefined) {
    throw new Error("class hash read failed");
  }
  return body.result;
};
