/**
 * The wire block: `postGasless` (the one poster every paymaster call goes through) over a scripted
 * transport. Each case records the JSON-RPC body sent per attempt, the scripted replies, the
 * pauses between screening retries, and the answer: the `result`, a determinate refusal (its code,
 * sentence and retry flag), or a lost execute (`IndeterminateRpcWriteError`). A quote and an
 * execute judge the same reply differently, so most replies appear once for each.
 */
import { postGasless } from "@bramble/transactions/gasless-rpc";
import { jsonReply, type Reply, rpcResult, type Sent, scriptedHttp, thrown } from "./shared";

const PAYMASTER_URL = "https://wallet.nodes.starknet.org/api/paymaster/mainnet";
const LIMIT = 1024 * 1024;
const unavailable = jsonReply({ error: "screening_unavailable" }, 503);
const rpcBody = (fields: object): Reply => jsonReply({ id: 1, jsonrpc: "2.0", ...fields });

type WireCase = {
  readonly name: string;
  readonly replies: readonly Reply[];
  /** Whether the wallet stays unlocked across a retry pause. */
  readonly locksDuringRetry?: boolean;
};

/** Replies both a quote and an execute are asked to judge. */
const SHARED: readonly WireCase[] = [
  { name: "a result", replies: [rpcResult({ transaction_hash: "0x7a1ce5" })] },
  { name: "a null result", replies: [rpcResult(null)] },
  {
    name: "a JSON-RPC error naming a known code",
    replies: [rpcBody({ error: { code: 1, data: "screening_denied" } })],
  },
  {
    name: "a JSON-RPC error naming an unknown code",
    replies: [rpcBody({ error: { code: 1, data: "nope" } })],
  },
  {
    name: "a JSON-RPC error with no data",
    replies: [rpcBody({ error: { code: -32000, message: "x" } })],
  },
  {
    name: "the gateway's code with status 403",
    replies: [jsonReply({ error: "screening_denied" }, 403)],
  },
  {
    name: "the gateway's pre-forward code with status 400",
    replies: [jsonReply({ error: "invalid_gasless_request" }, 400)],
  },
  {
    name: "the gateway's code with status 200",
    replies: [jsonReply({ error: "screening_denied" })],
  },
  {
    name: "a code that is not pre-forward with status 403",
    replies: [jsonReply({ error: "upstream_rejected" }, 403)],
  },
  {
    name: "an unknown code with status 403",
    replies: [jsonReply({ error: "brand_new_code" }, 403)],
  },
  {
    name: "a code outside the grammar with status 403",
    replies: [jsonReply({ error: "Screening-Denied" }, 403)],
  },
  {
    name: "a code with an extra key, status 403",
    replies: [jsonReply({ error: "screening_denied", why: "x" }, 403)],
  },
  { name: "status 400 with no body", replies: [{ body: "", status: 400 }] },
  { name: "status 500 with no body", replies: [{ body: "", status: 500 }] },
  { name: "status 502 naming a code", replies: [jsonReply({ error: "gasless_disabled" }, 502)] },
  { name: "screening unavailable three times", replies: [unavailable, unavailable, unavailable] },
  { name: "screening unavailable, then a result", replies: [unavailable, rpcResult("0x1")] },
  { name: "a reply id of 2", replies: [jsonReply({ id: 2, jsonrpc: "2.0", result: "0x1" })] },
  {
    name: "a reply id as a string",
    replies: [jsonReply({ id: "1", jsonrpc: "2.0", result: "0x1" })],
  },
  { name: "a jsonrpc of 1.0", replies: [jsonReply({ id: 1, jsonrpc: "1.0", result: "0x1" })] },
  { name: "an extra top-level key", replies: [rpcBody({ result: "0x1", extra: true })] },
  { name: "no result and no error", replies: [rpcBody({})] },
  { name: "a body that is not JSON", replies: [{ body: "<html>", status: 200 }] },
  { name: "an empty 200", replies: [{ body: "", status: 200 }] },
  { name: "a JSON array", replies: [jsonReply([1])] },
  {
    name: "a declared length one byte over the limit",
    replies: [{ ...rpcResult("0x1"), contentLength: String(LIMIT + 1) }],
  },
  {
    name: "a declared length at the limit",
    replies: [{ ...rpcResult("0x1"), contentLength: String(LIMIT) }],
  },
  {
    name: "a declared length that is not digits",
    replies: [{ ...rpcResult("0x1"), contentLength: "12a" }],
  },
  { name: "a streamed body one byte over the limit", replies: [{ fill: LIMIT + 1, status: 200 }] },
  { name: "the transport fails", replies: [{ throws: true }] },
];

const EXECUTE_ONLY: readonly WireCase[] = [
  {
    locksDuringRetry: true,
    name: "screening unavailable, then the wallet locks during the pause",
    replies: [unavailable, rpcResult("0x1")],
  },
];

const run = async (item: WireCase, method: string, executes: boolean): Promise<object> => {
  const sent: Sent[] = [];
  const slept: number[] = [];
  let answer: object;
  try {
    const result = await postGasless(scriptedHttp(item.replies, sent), PAYMASTER_URL, method, [], {
      executes,
      isAuthorized: () => item.locksDuringRetry !== true,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    answer = { result: result ?? null };
  } catch (error) {
    answer = { refused: thrown(error) };
  }
  return {
    answer,
    executes,
    method,
    name: `${executes ? "execute" : "quote"}: ${item.name}`,
    replies: item.replies,
    sent,
    slept,
  };
};

/** Every reply judged as a quote (`paymaster_buildTransaction`) and as an execute. */
export const computeWire = async (): Promise<readonly object[]> => {
  const cases: object[] = [];
  for (const item of SHARED) cases.push(await run(item, "paymaster_buildTransaction", false));
  for (const item of [...SHARED, ...EXECUTE_ONLY]) {
    cases.push(await run(item, "paymaster_executeTransaction", true));
  }
  return cases;
};
