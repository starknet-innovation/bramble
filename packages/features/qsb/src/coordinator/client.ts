/**
 * The QSB coordinator client: one typed call per route a deposit or a
 * withdrawal uses, over an injected `fetch`, against
 * {@link QSB_COORDINATOR_ORIGIN} only.
 *
 * Every request carries `Content-Type: application/json`; an authenticated
 * one carries the session as `X-Qsb-Authorization: Bearer <token>` (never
 * `Authorization`, which CloudFront replaces); every POST carries the hex
 * SHA-256 of its exact body bytes as `x-amz-content-sha256`, computed with
 * WebCrypto, without which CloudFront refuses it. Requests omit credentials
 * and the referrer, refuse redirects, and are bounded in time and size: a
 * body over 160,000 bytes is never sent, and an answer is read under a hard
 * byte budget and the same deadline.
 *
 * Trust boundary: answers are untrusted and parsed strictly (./responses,
 * ./vault-responses, ./withdrawal-responses). Every failure is a {@link QsbCoordinatorFailure}:
 * `unreachable` (no answer, a timeout, an oversized or malformed one) or
 * `refused` (an HTTP error with the coordinator's status and code). Neither
 * carries the coordinator's message text, so nothing it says reaches a page.
 */
import { bytesToHex } from "@bramble/core/hex";
import {
  type BoundedHttpResponse,
  readBoundedText,
  UNTRUSTED_REQUEST_INIT,
} from "@bramble/core/http-json";
import type { QsbWithdrawalManifest } from "../withdrawal/manifest";
import { QSB_API_BASE_PATH, QSB_COORDINATOR_ORIGIN } from "./origin";
import { hasExactKeys, isQsbUuid, type QsbOutpoint } from "./response-grammar";
import {
  type QsbChallenge,
  type QsbConfig,
  type QsbPaymentInput,
  type QsbRates,
  readQsbChallenge,
  readQsbConfig,
  readQsbPaymentInput,
  readQsbPaymentUtxos,
  readQsbRates,
  readQsbRefusalBody,
  readQsbSessionToken,
} from "./responses";
import {
  type QsbFundingStatus,
  type QsbPublicVault,
  type QsbSubmitAnswer,
  type QsbVaultList,
  readQsbFundingStatus,
  readQsbPublicVault,
  readQsbSubmitAnswer,
  readQsbVaultList,
} from "./vault-responses";
import {
  type QsbJob,
  type QsbSolvedResult,
  type QsbWithdrawalSubmitAnswer,
  type QsbWithdrawalTransactionStatus,
  readQsbCreatedJob,
  readQsbJobs,
  readQsbSolvedResult,
  readQsbWithdrawalSubmitAnswer,
  readQsbWithdrawalTransactionStatus,
} from "./withdrawal-responses";

/** The transport: `fetch`-shaped, with the response's status. */
export type QsbHttpFetch = (
  url: string,
  init: RequestInit,
) => Promise<BoundedHttpResponse & { readonly status: number }>;

/** The largest request body the coordinator accepts, in bytes. */
export const QSB_MAX_REQUEST_BYTES = 160_000;

// The largest answer read: a vault list of full-size vaults, or a previous
// transaction, with room to spare. A refusal body is read for its code only.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REFUSAL_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Why a coordinator call failed: `unreachable` for no usable answer,
 * `refused` for an HTTP error, with its status and (when sent) code.
 */
export class QsbCoordinatorFailure extends Error {
  public readonly code: string | null;
  public readonly kind: "refused" | "unreachable";
  public readonly status: number | null;

  public constructor(kind: "refused" | "unreachable", status: number | null, code: string | null) {
    super(
      kind === "refused" ? `qsb coordinator refused (${status})` : "qsb coordinator unreachable",
    );
    this.name = "QsbCoordinatorFailure";
    this.code = code;
    this.kind = kind;
    this.status = status;
  }
}

/** A deposit to submit: the signed bytes and the amount output 0 pays. */
export type QsbDepositSubmission = {
  readonly amountSat: number;
  readonly rawTxHex: string;
};

/** The routes a QSB vault deposit uses, each answer parsed. */
export type QsbCoordinator = {
  readonly challenge: (address: string) => Promise<QsbChallenge>;
  readonly config: () => Promise<QsbConfig>;
  /** `POST /v1/jobs`: the manifest is sent as its canonical JSON, the bytes it is hashed over. */
  readonly createJob: (token: string, manifest: QsbWithdrawalManifest) => Promise<QsbJob>;
  readonly funding: (token: string, vaultId: string) => Promise<QsbFundingStatus>;
  readonly fundResubmit: (token: string, vaultId: string) => Promise<QsbSubmitAnswer>;
  readonly fundSubmit: (
    token: string,
    vaultId: string,
    deposit: QsbDepositSubmission,
  ) => Promise<QsbSubmitAnswer>;
  readonly jobs: (token: string) => Promise<readonly QsbJob[]>;
  readonly paymentInput: (token: string, outpoint: QsbOutpoint) => Promise<QsbPaymentInput>;
  readonly paymentUtxos: (token: string) => Promise<readonly QsbOutpoint[]>;
  readonly rates: () => Promise<QsbRates>;
  readonly register: (
    token: string,
    vault: Readonly<Record<string, unknown>>,
  ) => Promise<QsbPublicVault>;
  readonly solvedResult: (token: string, jobId: string) => Promise<QsbSolvedResult>;
  readonly submitWithdrawal: (
    token: string,
    jobId: string,
    rawTxHex: string,
  ) => Promise<QsbWithdrawalSubmitAnswer>;
  readonly vaults: (token: string) => Promise<QsbVaultList>;
  readonly verify: (challengeId: string, proof: string) => Promise<string>;
  readonly withdrawalStatus: (
    token: string,
    txid: string,
  ) => Promise<QsbWithdrawalTransactionStatus>;
};

type Request = {
  readonly body?: unknown;
  readonly path: string;
  readonly token?: string;
};

const unreachable = (): QsbCoordinatorFailure =>
  new QsbCoordinatorFailure("unreachable", null, null);

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

// A vault id is interpolated into a path only once it is a uuid.
const vaultPath = (vaultId: string, route: string): string => {
  if (!isQsbUuid(vaultId)) {
    throw unreachable();
  }
  return `/vaults/${vaultId.toLowerCase()}${route}`;
};

// A job id is interpolated into a path only once it is a uuid, a txid only
// once it is 32 bytes of hex.
const jobPath = (jobId: string, route: string): string => {
  if (!isQsbUuid(jobId)) {
    throw unreachable();
  }
  return `/jobs/${jobId.toLowerCase()}${route}`;
};

const transactionPath = (txid: string): string => {
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw unreachable();
  }
  return `/transactions/${txid}/status`;
};

// The method, headers and body of one request: the session when there is
// one, and the body's hash on every POST. Refuses a body past the cap.
const requestInit = async (request: Request): Promise<RequestInit> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.token !== undefined) {
    headers["X-Qsb-Authorization"] = `Bearer ${request.token}`;
  }
  if (request.body === undefined) {
    return { ...UNTRUSTED_REQUEST_INIT, headers, method: "GET" };
  }
  const body = JSON.stringify(request.body);
  const bytes = new TextEncoder().encode(body);
  if (bytes.length > QSB_MAX_REQUEST_BYTES) {
    throw unreachable();
  }
  headers["x-amz-content-sha256"] = await sha256Hex(bytes);
  return { ...UNTRUSTED_REQUEST_INIT, body, headers, method: "POST" };
};

// The answer's JSON, or the refusal its status and code describe.
const answerOf = async (
  response: Awaited<ReturnType<QsbHttpFetch>>,
  deadline: AbortSignal,
): Promise<unknown> => {
  const limit = response.ok ? MAX_RESPONSE_BYTES : MAX_REFUSAL_BYTES;
  const text = await readBoundedText(response, limit, deadline).catch(() => null);
  if (response.ok) {
    if (text === null) throw unreachable();
    return parseJson(text);
  }
  const { code } = readQsbRefusalBody(text === null ? undefined : parseJson(text));
  throw new QsbCoordinatorFailure("refused", response.status, code);
};

/**
 * Creates the client over `fetch` (production: `untrustedFetch`) with a
 * per-request deadline of `timeoutMs`.
 */
export const createQsbCoordinator = (deps: {
  readonly fetch: QsbHttpFetch;
  readonly timeoutMs?: number;
}): QsbCoordinator => {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const send = async (request: Request): Promise<unknown> => {
    const init = await requestInit(request);
    const deadline = AbortSignal.timeout(timeoutMs);
    const url = `${QSB_COORDINATOR_ORIGIN}${QSB_API_BASE_PATH}${request.path}`;
    const response = await deps.fetch(url, { ...init, signal: deadline }).catch(() => {
      throw unreachable();
    });
    return answerOf(response, deadline);
  };

  // One call: send, then accept only what `read` parses.
  const call = async <T>(request: Request, read: (value: unknown) => T | null): Promise<T> => {
    const parsed = read(await send(request));
    if (parsed === null) {
      throw unreachable();
    }
    return parsed;
  };

  return {
    challenge: (address) => call({ body: { address }, path: "/auth/challenge" }, readQsbChallenge),
    config: () => call({ path: "/config" }, readQsbConfig),
    createJob: (token, manifest) =>
      call({ body: manifest, path: "/jobs", token }, readQsbCreatedJob),
    funding: async (token, vaultId) =>
      call({ path: vaultPath(vaultId, "/funding"), token }, readQsbFundingStatus),
    fundResubmit: async (token, vaultId) =>
      call({ body: {}, path: vaultPath(vaultId, "/fund/resubmit"), token }, readQsbSubmitAnswer),
    fundSubmit: async (token, vaultId, deposit) =>
      call(
        {
          body: {
            amount: String(deposit.amountSat),
            costAccepted: true,
            rawTxHex: deposit.rawTxHex,
          },
          path: vaultPath(vaultId, "/fund/submit"),
          token,
        },
        readQsbSubmitAnswer,
      ),
    jobs: (token) => call({ path: "/jobs", token }, readQsbJobs),
    paymentInput: (token, outpoint) =>
      call(
        {
          body: { txid: outpoint.txid, value: String(outpoint.valueSat), vout: outpoint.vout },
          path: "/payment-input",
          token,
        },
        readQsbPaymentInput,
      ),
    paymentUtxos: (token) => call({ path: "/payment-utxos", token }, readQsbPaymentUtxos),
    rates: () => call({ path: "/rates" }, readQsbRates),
    register: (token, vault) =>
      call({ body: vault, path: "/vaults", token }, (value) =>
        hasExactKeys(value, ["vault"]) ? readQsbPublicVault(value["vault"]) : null,
      ),
    solvedResult: async (token, jobId) =>
      call({ path: jobPath(jobId, "/solved-result"), token }, readQsbSolvedResult),
    submitWithdrawal: async (token, jobId, rawTxHex) =>
      call(
        { body: { rawTxHex }, path: jobPath(jobId, "/submit"), token },
        readQsbWithdrawalSubmitAnswer,
      ),
    vaults: (token) => call({ path: "/vaults", token }, readQsbVaultList),
    verify: (challengeId, proof) =>
      call(
        { body: { id: challengeId, signature: proof }, path: "/auth/verify" },
        readQsbSessionToken,
      ),
    withdrawalStatus: async (token, txid) =>
      call({ path: transactionPath(txid), token }, readQsbWithdrawalTransactionStatus),
  };
};
