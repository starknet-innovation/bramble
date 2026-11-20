/**
 * The live suites' broadcast firewall lets a transaction leave only when every
 * account it spends from or creates is on the test's allowlist, and refuses
 * any broadcast whose sender it cannot read.
 */
import { describe, expect, test } from "bun:test";
import { BROADCAST_PAYMASTER_METHOD } from "@bramble/privacy/paymaster";
import { BROADCAST_RPC_METHODS } from "@bramble/starknet/rpc-transport";
import { hash } from "starknet";
import { broadcastsIn, refusedBroadcasts, refusedRequest } from "./broadcast-firewall";

const ALLOWED = "0x0123";
const OTHER = "0x0456";
const CLASS = "0x0abc";
const SALT = "0x5";
const CALLDATA = ["0x7"];
const CREATED = hash.calculateContractAddressFromHash(SALT, CLASS, CALLDATA, 0);

const rpc = (method: string, params: unknown): string =>
  JSON.stringify({ id: 1, jsonrpc: "2.0", method, params });

const invoke = (sender: string): string =>
  rpc("starknet_addInvokeTransaction", { invoke_transaction: { sender_address: sender } });

const deployAccount = (salt: string): string =>
  rpc("starknet_addDeployAccountTransaction", {
    deploy_account_transaction: {
      class_hash: CLASS,
      constructor_calldata: CALLDATA,
      contract_address_salt: salt,
    },
  });

const paymaster = (transaction: unknown): string =>
  rpc(BROADCAST_PAYMASTER_METHOD, { parameters: { version: "0x1" }, transaction });

const deployment = {
  address: OTHER,
  calldata: CALLDATA,
  class_hash: CLASS,
  salt: SALT,
  version: 1,
};

describe("broadcast firewall", () => {
  test("gates every method the wallet treats as a broadcast", () => {
    for (const method of [...BROADCAST_RPC_METHODS, BROADCAST_PAYMASTER_METHOD]) {
      expect(broadcastsIn(rpc(method, {}))).toEqual([{ method, senders: [] }]);
      expect(refusedBroadcasts(rpc(method, {}), [ALLOWED])).toHaveLength(1);
    }
  });

  test("lets reads and bodies that name no broadcast through", () => {
    expect(refusedBroadcasts(rpc("starknet_call", {}), [])).toEqual([]);
    expect(refusedBroadcasts(JSON.stringify({ quoteId: "q" }), [])).toEqual([]);
    expect(refusedRequest({ body: null, contentType: undefined, method: "GET" }, [])).toEqual([]);
  });

  test("refuses any request body it cannot read", () => {
    const unreadable = [{ method: "unreadable", senders: [] }];
    const post = (body: string | null, contentType?: string) =>
      refusedRequest({ body, contentType, method: "POST" }, [ALLOWED]);
    expect(post(null)).toEqual(unreadable);
    expect(post("not json")).toEqual(unreadable);
    expect(post("\u0000\u001f\u008b\u0008binary")).toEqual(unreadable);
    expect(post(invoke(ALLOWED), "message/ohttp-req")).toEqual(unreadable);
    expect(post(invoke(ALLOWED), "application/json")).toEqual([]);
  });

  test("sees a broadcast name spelled with a JSON escape", () => {
    const escaped = JSON.stringify({ wrapped: "x" }).replace(
      '"x"',
      '"starknet_add\\u0049nvokeTransaction"',
    );
    expect(refusedBroadcasts(escaped, [ALLOWED])).toEqual([{ method: "unreadable", senders: [] }]);
  });

  test("refuses a body that names a broadcast it cannot parse", () => {
    const unreadable = { method: "unreadable", senders: [] };
    expect(refusedBroadcasts(invoke(ALLOWED).slice(0, -1), [ALLOWED])).toEqual([unreadable]);
    expect(refusedBroadcasts(JSON.stringify({ wrapped: invoke(ALLOWED) }), [ALLOWED])).toEqual([
      unreadable,
    ]);
    expect(refusedBroadcasts(invoke(ALLOWED), [ALLOWED])).toEqual([]);
  });

  test("allows an invoke from an allowed sender in any felt spelling", () => {
    expect(refusedBroadcasts(invoke("0x123"), [ALLOWED])).toEqual([]);
    expect(refusedBroadcasts(invoke(OTHER), [ALLOWED])).toHaveLength(1);
  });

  test("reads positional params and every item of a batch", () => {
    const positional = rpc("starknet_addInvokeTransaction", [{ sender_address: ALLOWED }]);
    expect(refusedBroadcasts(positional, [ALLOWED])).toEqual([]);
    const batch = `[${rpc("starknet_chainId", [])},${invoke(ALLOWED)},${invoke(OTHER)}]`;
    expect(refusedBroadcasts(batch, [ALLOWED])).toEqual([
      { method: "starknet_addInvokeTransaction", senders: [OTHER] },
    ]);
  });

  test("checks a deploy against the address it computes, not one it is told", () => {
    expect(refusedBroadcasts(deployAccount(SALT), [CREATED])).toEqual([]);
    expect(refusedBroadcasts(deployAccount("0x6"), [CREATED])).toHaveLength(1);
  });

  test("checks the declare sender", () => {
    const declare = rpc("starknet_addDeclareTransaction", {
      declare_transaction: { sender_address: ALLOWED },
    });
    expect(refusedBroadcasts(declare, [ALLOWED])).toEqual([]);
    expect(refusedBroadcasts(declare, [OTHER])).toHaveLength(1);
  });

  test("checks every account a paymaster execute names", () => {
    const user = { invoke: { user_address: ALLOWED }, type: "invoke" };
    expect(refusedBroadcasts(paymaster(user), [ALLOWED])).toEqual([]);
    expect(refusedBroadcasts(paymaster(user), [OTHER])).toHaveLength(1);
    // A sponsored deploy is judged by the address its fields create.
    expect(refusedBroadcasts(paymaster({ deployment, type: "deploy" }), [CREATED])).toEqual([]);
    expect(refusedBroadcasts(paymaster({ deployment, type: "deploy" }), [OTHER])).toHaveLength(1);
    const both = { deployment, invoke: { user_address: ALLOWED }, type: "deploy_and_invoke" };
    expect(refusedBroadcasts(paymaster(both), [CREATED, ALLOWED])).toEqual([]);
    expect(refusedBroadcasts(paymaster(both), [ALLOWED])).toHaveLength(1);
  });

  test("refuses a broadcast whose sender it cannot read", () => {
    expect(refusedBroadcasts(paymaster({ type: "something-new" }), [ALLOWED])).toHaveLength(1);
    expect(refusedBroadcasts(paymaster({ invoke: {}, type: "invoke" }), [ALLOWED])).toHaveLength(1);
    const badDeploy = rpc("starknet_addDeployAccountTransaction", {
      deploy_account_transaction: { class_hash: CLASS, constructor_calldata: [1] },
    });
    expect(refusedBroadcasts(badDeploy, [ALLOWED])).toHaveLength(1);
  });
});
