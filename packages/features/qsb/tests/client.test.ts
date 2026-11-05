/**
 * The coordinator client against a fake fetch: the exact origin and paths,
 * the JSON content type on every request, the session in
 * `X-Qsb-Authorization` (never `Authorization`), the body's SHA-256 in
 * `x-amz-content-sha256` on every POST, no credentials, referrer or
 * redirects, a deadline, a 160,000-byte body cap, strict parsing, and
 * failures that carry a status and code but never the coordinator's words.
 */
import { describe, expect, test } from "bun:test";
import {
  createQsbCoordinator,
  QsbCoordinatorFailure,
  type QsbHttpFetch,
} from "@bramble/qsb/client";
import { serverVault, sha256Hex } from "./fixtures";

type Sent = { readonly init: RequestInit; readonly url: string };

const TOKEN = "T".repeat(43);
const VAULT_ID = "0b6f4d5e-1c2a-4b3d-8e9f-a0b1c2d3e4f5";

const answering = (status: number, body: unknown) => {
  const sent: Sent[] = [];
  const fetch: QsbHttpFetch = async (url, init) => {
    sent.push({ init, url });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { coordinator: createQsbCoordinator({ fetch }), sent };
};

const headersOf = (sent: Sent): Record<string, string> =>
  sent.init.headers as Record<string, string>;

const failure = async (run: Promise<unknown>): Promise<QsbCoordinatorFailure> => {
  try {
    await run;
  } catch (error) {
    if (error instanceof QsbCoordinatorFailure) return error;
    throw error;
  }
  throw new Error("expected a coordinator failure");
};

describe("requests", () => {
  test("a GET carries the content type and the session, and no body", async () => {
    const { coordinator, sent } = answering(200, { utxos: [] });
    expect(await coordinator.paymentUtxos(TOKEN)).toEqual([]);
    const [request] = sent;
    expect(request?.url).toBe("https://d1pjwwq89sze3g.cloudfront.net/v1/payment-utxos");
    expect(request?.init).toMatchObject({
      credentials: "omit",
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(request?.init.body).toBeUndefined();
    expect(request?.init.signal).toBeInstanceOf(AbortSignal);
    expect(headersOf(request as Sent)).toEqual({
      "Content-Type": "application/json",
      "X-Qsb-Authorization": `Bearer ${TOKEN}`,
    });
  });

  test("a POST carries the SHA-256 of its exact body bytes", async () => {
    const { coordinator, sent } = answering(201, {
      submission: "submitted",
      vault: serverVault({ id: VAULT_ID }),
    });
    await coordinator.fundSubmit(TOKEN, VAULT_ID, { amountSat: 50_000, rawTxHex: "00ff" });
    const [request] = sent;
    expect(request?.url).toBe(
      `https://d1pjwwq89sze3g.cloudfront.net/v1/vaults/${VAULT_ID}/fund/submit`,
    );
    const body = request?.init.body as string;
    expect(JSON.parse(body)).toEqual({ amount: "50000", costAccepted: true, rawTxHex: "00ff" });
    expect(headersOf(request as Sent)["x-amz-content-sha256"]).toBe(sha256Hex(body));
    expect(headersOf(request as Sent)).not.toHaveProperty("Authorization");
  });

  test("an empty POST sends {} and its hash; sign-in sends no session", async () => {
    const resubmit = answering(201, { submission: "uncertain", vault: serverVault() });
    await resubmit.coordinator.fundResubmit(TOKEN, VAULT_ID);
    expect(resubmit.sent[0]?.init.body).toBe("{}");
    expect(headersOf(resubmit.sent[0] as Sent)["x-amz-content-sha256"]).toBe(sha256Hex("{}"));
    const verify = answering(200, { token: TOKEN });
    expect(await verify.coordinator.verify(VAULT_ID, "proof")).toBe(TOKEN);
    expect(JSON.parse(verify.sent[0]?.init.body as string)).toEqual({
      id: VAULT_ID,
      signature: "proof",
    });
    expect(headersOf(verify.sent[0] as Sent)).not.toHaveProperty("X-Qsb-Authorization");
  });

  test("never sends a body over 160,000 bytes, or a path from a non-uuid id", async () => {
    const { coordinator, sent } = answering(201, {});
    const big = await failure(coordinator.register(TOKEN, { scriptHex: "0".repeat(160_000) }));
    expect(big.kind).toBe("unreachable");
    const path = await failure(coordinator.funding(TOKEN, "../config"));
    expect(path.kind).toBe("unreachable");
    expect(sent).toHaveLength(0);
  });
});

describe("answers", () => {
  test("a refusal carries its status and code, not its message", async () => {
    const { coordinator } = answering(409, {
      code: "vault_script_registered",
      error: "Another vault holds http://secret.example",
    });
    const refused = await failure(coordinator.register(TOKEN, {}));
    expect(refused).toMatchObject({
      code: "vault_script_registered",
      kind: "refused",
      status: 409,
    });
    expect(refused.message).not.toContain("secret");
  });

  test("a refusal without a JSON body still reports its status", async () => {
    const { coordinator } = answering(502, "Bad gateway");
    expect(await failure(coordinator.config())).toMatchObject({
      code: null,
      kind: "refused",
      status: 502,
    });
  });

  test.each([
    ["not JSON", "<html>"],
    ["the wrong shape", { token: "short" }],
  ])("an OK answer that is %s is unreachable", async (_label, body) => {
    const { coordinator } = answering(200, body);
    expect((await failure(coordinator.verify(VAULT_ID, "p"))).kind).toBe("unreachable");
  });

  test("a transport failure or an oversized answer is unreachable", async () => {
    const throwing = createQsbCoordinator({
      fetch: async () => {
        throw new TypeError("redirect refused");
      },
    });
    expect((await failure(throwing.rates())).kind).toBe("unreachable");
    const huge = createQsbCoordinator({
      fetch: async () =>
        new Response("x", { headers: { "content-length": String(9 * 1024 * 1024) } }),
    });
    expect((await failure(huge.rates())).kind).toBe("unreachable");
  });

  test("a stalled answer times out", async () => {
    const stalled = createQsbCoordinator({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      timeoutMs: 20,
    });
    expect((await failure(stalled.config())).kind).toBe("unreachable");
  });

  test("the registration answer is exactly { vault }", async () => {
    const vault = serverVault({ id: VAULT_ID });
    expect((await answering(201, { vault }).coordinator.register(TOKEN, {})).id).toBe(VAULT_ID);
    expect(
      (await failure(answering(201, { extra: 1, vault }).coordinator.register(TOKEN, {}))).kind,
    ).toBe("unreachable");
  });
});

describe("withdrawal routes", () => {
  const JOB_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const TXID = "ab".repeat(32);
  const MANIFEST = {
    vaultId: VAULT_ID,
    funding: { txid: TXID, vout: 0, value: "100000" },
    helper: { txid: TXID, vout: 1, value: "1449" },
    destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    outputScript: "0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2",
    outputValue: "88673",
    fee: "12776",
    idempotencyKey: JOB_ID,
    costAccepted: true,
  } as const;
  const job = {
    id: JOB_ID,
    manifest: MANIFEST,
    manifestHash: sha256Hex(JSON.stringify(MANIFEST)),
    stage: "pinning",
    status: "queued",
    vaultId: VAULT_ID,
  };

  test("a job is created from the canonical manifest, hashed as sent", async () => {
    const { coordinator, sent } = answering(201, { job });
    expect(await coordinator.createJob(TOKEN, MANIFEST)).toMatchObject({
      id: JOB_ID,
      status: "queued",
    });
    const [request] = sent;
    expect(request?.url).toBe("https://d1pjwwq89sze3g.cloudfront.net/v1/jobs");
    expect(request?.init.body).toBe(JSON.stringify(MANIFEST));
    expect(headersOf(request as Sent)["x-amz-content-sha256"]).toBe(job.manifestHash);
  });

  test("the solved result, the submission and the status take their own paths", async () => {
    const solved = answering(404, { code: "solved_result_unavailable" });
    expect((await failure(solved.coordinator.solvedResult(TOKEN, JOB_ID))).code).toBe(
      "solved_result_unavailable",
    );
    expect(solved.sent[0]?.url).toBe(
      `https://d1pjwwq89sze3g.cloudfront.net/v1/jobs/${JOB_ID}/solved-result`,
    );
    const submit = answering(200, { status: "submitted", txid: TXID });
    expect(await submit.coordinator.submitWithdrawal(TOKEN, JOB_ID, "00ff")).toEqual({
      status: "submitted",
      txid: TXID,
    });
    expect(submit.sent[0]?.init.body).toBe('{"rawTxHex":"00ff"}');
    const status = answering(200, { chain: null, status: "uncertain", txid: TXID });
    expect((await status.coordinator.withdrawalStatus(TOKEN, TXID)).status).toBe("uncertain");
    expect(status.sent[0]?.url).toBe(
      `https://d1pjwwq89sze3g.cloudfront.net/v1/transactions/${TXID}/status`,
    );
  });

  test("never builds a path from a non-uuid job id or a non-hex txid", async () => {
    const { coordinator, sent } = answering(200, {});
    expect((await failure(coordinator.solvedResult(TOKEN, "../vaults"))).kind).toBe("unreachable");
    expect((await failure(coordinator.submitWithdrawal(TOKEN, "x", "00"))).kind).toBe(
      "unreachable",
    );
    expect((await failure(coordinator.withdrawalStatus(TOKEN, "AB".repeat(32)))).kind).toBe(
      "unreachable",
    );
    expect(sent).toEqual([]);
  });
});
