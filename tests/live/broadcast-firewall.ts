/**
 * Broadcast firewall for the live wallet suites. Every request that would put
 * a transaction on the wire (the node's `starknet_add*Transaction` methods and
 * the paymaster relay's execute) is checked against the senders a test may
 * spend from, and is aborted in the browser, never forwarded, unless every
 * sender it names is allowed. A broadcast whose sender cannot be read is
 * refused: the firewall fails closed.
 *
 * Its job is to keep a wallet bug from spending from an account the test did
 * not choose (an import fixture, a funded bank), and to let a refusal test
 * prove that nothing was sent. It is not a fee or amount cap; the review's
 * fee check stays in charge of that.
 */
import { isRecord } from "@bramble/core/json";
import { BROADCAST_PAYMASTER_METHOD } from "@bramble/privacy/paymaster";
import { BROADCAST_RPC_METHODS } from "@bramble/starknet/rpc-transport";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { BrowserContext } from "@playwright/test";
import { hash } from "starknet";

/** One broadcast found in a request body, with every account it would spend from or create. */
export type Broadcast = { readonly method: string; readonly senders: readonly string[] };

/** A live handle onto an installed firewall. */
export type BroadcastFirewall = {
  /** Broadcasts refused so far, in arrival order. Empty means nothing was blocked. */
  readonly blocked: readonly Broadcast[];
  /** JSON-RPC requests inspected so far; zero means the route never saw the wallet's traffic. */
  readonly inspected: () => number;
};

const BROADCAST_METHODS: readonly string[] = [...BROADCAST_RPC_METHODS, BROADCAST_PAYMASTER_METHOD];

const isBroadcastMethod = (method: unknown): method is string =>
  typeof method === "string" && BROADCAST_METHODS.includes(method);

// How many times the raw body names a broadcast method. A body that names more
// broadcasts than parse out of it (truncated, wrapped, not JSON) is refused.
const mentions = (body: string): number =>
  BROADCAST_METHODS.reduce((total, method) => total + body.split(method).length - 1, 0);

// JSON-RPC params may be named (an object) or positional (an array).
const param = (params: unknown, name: string): unknown =>
  Array.isArray(params) ? params[0] : isRecord(params) ? params[name] : undefined;

const stringField = (value: unknown, name: string): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[name];
  return typeof field === "string" ? field : null;
};

// The address a counterfactual deployment creates, from what the request
// itself carries, so a wrong claimed address cannot slip past the allowlist.
const deployedAddress = (classHash: unknown, salt: unknown, calldata: unknown): string | null => {
  if (
    typeof classHash !== "string" ||
    typeof salt !== "string" ||
    !Array.isArray(calldata) ||
    !calldata.every((value) => typeof value === "string")
  ) {
    return null;
  }
  try {
    return hash.calculateContractAddressFromHash(salt, classHash, calldata, 0);
  } catch {
    return null;
  }
};

const paymasterSenders = (params: unknown): readonly (string | null)[] => {
  const tx = param(params, "transaction");
  if (!isRecord(tx)) {
    return [null];
  }
  const deployment = tx["deployment"];
  const created = isRecord(deployment)
    ? deployedAddress(deployment["class_hash"], deployment["salt"], deployment["calldata"])
    : null;
  const user = stringField(tx["invoke"], "user_address");
  switch (tx["type"]) {
    case "invoke":
      return [user];
    case "deploy":
      return [created];
    case "deploy_and_invoke":
      return [created, user];
    default:
      return [null];
  }
};

const sendersOf = (method: string, params: unknown): readonly (string | null)[] => {
  switch (method) {
    case "starknet_addInvokeTransaction":
      return [stringField(param(params, "invoke_transaction"), "sender_address")];
    case "starknet_addDeclareTransaction":
      return [stringField(param(params, "declare_transaction"), "sender_address")];
    case "starknet_addDeployAccountTransaction": {
      const tx = param(params, "deploy_account_transaction");
      return isRecord(tx)
        ? [
            deployedAddress(
              tx["class_hash"],
              tx["contract_address_salt"],
              tx["constructor_calldata"],
            ),
          ]
        : [null];
    }
    default:
      return paymasterSenders(params);
  }
};

const parse = (body: string | null): unknown => {
  if (body === null) {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

const rpcItems = (body: string | null): readonly Record<string, unknown>[] => {
  const parsed = parse(body);
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (item): item is Record<string, unknown> => isRecord(item) && typeof item["method"] === "string",
  );
};

/**
 * The broadcasts in one JSON-RPC request body (single or batch). A sender that
 * cannot be read is left out of `senders`, so a broadcast with fewer senders
 * than it should name is refused by {@link refusedBroadcasts}.
 */
export const broadcastsIn = (body: string | null): readonly Broadcast[] =>
  rpcItems(body)
    .filter((item) => isBroadcastMethod(item["method"]))
    .map((item) => {
      const method = String(item["method"]);
      const senders = sendersOf(method, item["params"]);
      return {
        method,
        senders: senders.every((sender) => sender !== null) ? (senders as string[]) : [],
      };
    });

/**
 * The broadcasts in `body` that may not leave: any with no readable sender,
 * any naming a sender outside `allowed`, and an `unreadable` entry when the
 * body names a broadcast method that does not parse out as one.
 */
export const refusedBroadcasts = (
  body: string | null,
  allowed: readonly string[],
): readonly Broadcast[] => {
  const found = broadcastsIn(body);
  const refused = found.filter(
    (broadcast) =>
      broadcast.senders.length === 0 ||
      !broadcast.senders.every((sender) => allowed.some((ok) => sameFelt(ok, sender))),
  );
  return body !== null && mentions(body) > found.length
    ? [...refused, { method: "unreadable", senders: [] }]
    : refused;
};

/**
 * Installs the firewall on every HTTP(S) request of `context`, the extension's
 * service worker included. Install it after any other route on the context
 * (Playwright runs the newest route first) and before the wallet can submit.
 * A refused request is aborted in the browser; everything else falls through
 * to earlier routes or the network untouched.
 */
export const installBroadcastFirewall = async (
  context: BrowserContext,
  allowed: readonly string[],
): Promise<BroadcastFirewall> => {
  const blocked: Broadcast[] = [];
  let inspected = 0;
  await context.route(/^https?:\/\//u, async (route) => {
    // Any method with a body is read, not just POST, so nothing slips by on a verb.
    const body = route.request().postData();
    if (rpcItems(body).length > 0) {
      inspected += 1;
    }
    const refused = refusedBroadcasts(body, allowed);
    if (refused.length > 0) {
      blocked.push(...refused);
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback();
  });
  return { blocked, inspected: () => inspected };
};
