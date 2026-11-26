/**
 * The STRK20 job transcripts (wallet-core #182): each batch runs the extension's real proof path
 * (`prepareWith`, with the builders and `transfersFor` it uses) over the vendored SDK bundle, with
 * `crypto.getRandomValues` fed a fixed stream, `fetch` answered from the batch's script, and the
 * extension's CallSet signer signing with the parity account's key through Krusty. Each line records
 * the inputs, the bytes the SDK drew, every request and the reply it got, what the signer was asked
 * to sign, and the result or the error as the SDK raised it and the extension mapped it.
 *
 * Two inputs are fixed rather than live: the proving block (the maturity rule that picks it is the
 * wallet's, run before the job) and `Date.now`, which the SDK's prover client uses as its JSON-RPC
 * id. Nothing reaches a network.
 *
 * The bundle's starknet.js binds `globalThis.fetch` when it loads (its RpcProvider's default fetch),
 * so a stub swapped in later never sees the pool-nonce read. The harness therefore loads its own
 * instance of the bundle, from a byte copy, while a dispatcher is installed as `fetch`; the
 * dispatcher refuses everything outside a job.
 */
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Strk20CallSetSigner } from "@bramble/privacy/call-set-signer";
import { DEFAULT_STRK20_NETWORKS } from "@bramble/privacy/config";
import {
  strk20BuilderFor,
  strk20RegistrationBuilderFor,
} from "@bramble/privacy/official-sdk-builder";
import type { Strk20MaturityRuntime } from "@bramble/privacy/official-sdk-maturity";
import { prepareWith } from "@bramble/privacy/official-sdk-preparation";
import type { PrivacySdkRuntime } from "@bramble/privacy/official-sdk-runtime";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import type { Strk20PrepareInput } from "@bramble/privacy/service";
import { createRpcProvider, resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { PRIVACY_SDK_BUNDLE, parityPrivacyAccount } from "./mobile-privacy-wire";
import {
  type Batch,
  jobAccount,
  PROVING_BLOCK,
  type Route,
  strk20Batches,
} from "./mobile-strk20-batches";
import { bytesHex, hex, labelledStream, withRandomStream } from "./mobile-strk20-primitives";

/** Repository-relative path of the committed job transcripts, one JSON line per batch. */
export const STRK20_JOBS_PATH = "mobile/core/tests/fixtures/extension-strk20-jobs.jsonl";

/** `Date.now` while a job runs: the prover client's JSON-RPC id. */
const CLOCK_MS = 1_800_000_000_000;
const config = DEFAULT_STRK20_NETWORKS.SN_MAIN;
const network = STARKNET_NETWORKS.SN_MAIN;
const RPC_URL = network.rpcUrls[0] ?? "";

const refuse = (() =>
  Promise.reject(new Error("STRK20 job harness: no network"))) as unknown as typeof fetch;
let handler: typeof fetch = refuse;
const dispatcher = ((input: RequestInfo | URL, init?: RequestInit) =>
  handler(input, init)) as typeof fetch;

/** A fresh instance of the vendored bundle whose starknet.js fetch is the dispatcher. */
const loadBundle = async (): Promise<PrivacySdkRuntime> => {
  const dir = await mkdtemp(join(tmpdir(), "strk20-jobs-"));
  const copy = join(dir, "starknet-sdk.js");
  await copyFile(PRIVACY_SDK_BUNDLE, copy);
  const saved = globalThis.fetch;
  globalThis.fetch = dispatcher;
  try {
    return (await import(pathToFileURL(copy).href)) as PrivacySdkRuntime;
  } finally {
    globalThis.fetch = saved;
    await rm(dir, { recursive: true });
  }
};

const routeOf = (url: string, body: string): Route | "unscripted" => {
  if (!config) return "unscripted";
  if (url === `${config.discoveryUrl}/v1/sync/outgoing_state`) return "outgoing";
  if (url === `${config.discoveryUrl}/v1/sync/incoming_state`) return "incoming";
  if (url === config.proverUrl) return "prover";
  const method = (JSON.parse(body || "{}") as { method?: unknown }).method;
  if (url === RPC_URL && method === "starknet_call") return "call";
  return url === RPC_URL && method === "starknet_getNonce" ? "nonce" : "unscripted";
};

type Recorded = {
  route: string;
  url: string;
  method: string;
  body: string;
  reply: { status: number; body: string };
};
/** What the signer was asked to sign, filled in by whichever signing hook answers it. */
export type Signed = { calls: unknown[]; digest?: string; signature?: string[] };

const errorRecord = (error: unknown) => ({
  class: error instanceof Error ? error.constructor.name : typeof error,
  ...(typeof (error as { code?: unknown })?.code === "number"
    ? { code: (error as { code: number }).code }
    : {}),
  message: error instanceof Error ? error.message : String(error),
});
const plain = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? hex(v) : v)));

/** Runs one batch through the extension's proof path and returns its transcript line. */
const runBatch = async (sdk: PrivacySdkRuntime, batch: Batch) => {
  const routing = batch.config === undefined ? config : batch.config;
  if (!config || !routing) throw new Error("mainnet STRK20 config missing");
  const account = batch.account ?? (await jobAccount());
  const viewingKey = batch.account?.viewingKey ?? (await parityPrivacyAccount(0)).viewingKey;
  const queues = Object.fromEntries(
    Object.entries(batch.script).map(([route, replies]) => [route, [...(replies ?? [])]]),
  ) as Record<string, ((request: { id: unknown }) => { status: number; body: string })[]>;
  const requests: Recorded[] = [];
  const signing: Signed[] = [];
  const pauses: { attempt: number; retryAfterMs: number | null }[] = [];
  const sdkSteps: Record<string, unknown> = {};

  const originals = {
    fetch: globalThis.fetch,
    now: Date.now,
    sign: Strk20CallSetSigner.prototype.signTransaction,
  };
  handler = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    const route = routeOf(url, body);
    const next = queues[route]?.shift();
    const id = body.startsWith("{") ? (JSON.parse(body) as { id?: unknown }).id : undefined;
    const reply = next ? next({ id }) : { body: "unscripted", status: 599 };
    requests.push({ body, method: init?.method ?? "GET", reply, route, url });
    return new Response(reply.body, {
      headers: { "Content-Type": "application/json" },
      status: reply.status,
    });
  }) as typeof fetch;
  globalThis.fetch = dispatcher;
  Date.now = () => CLOCK_MS;
  Strk20CallSetSigner.prototype.signTransaction = function (calls, details) {
    signing.push({ calls: plain(calls) as unknown[] });
    return originals.sign.call(this, calls, details);
  };
  // Observes the SDK session the extension builds, without changing what it does.
  const observed: PrivacySdkRuntime = {
    ...sdk,
    createPrivateTransfers: (params) => {
      const transfers = sdk.createPrivateTransfers(params) as unknown as Record<string, unknown>;
      for (const name of ["createProofInvocation", "executeWithInvocation"]) {
        const method = transfers[name] as (...args: unknown[]) => Promise<unknown>;
        transfers[name] = async (...args: unknown[]) => {
          try {
            const result = await method.apply(transfers, args);
            sdkSteps[name] = plain(result);
            return result;
          } catch (error) {
            sdkSteps[name] = { error: errorRecord(error) };
            throw error;
          }
        };
      }
      return transfers as unknown as ReturnType<PrivacySdkRuntime["createPrivateTransfers"]>;
    },
  };
  const maturity = {
    provingBlock: async () => PROVING_BLOCK,
  } as unknown as Strk20MaturityRuntime;
  const base = {
    account: { address: account.address, id: `SN_MAIN:${account.address}`, networkId: "SN_MAIN" },
    actions: batch.actions,
    config: routing,
    isAuthorized: () => true,
    rpcUrls: [RPC_URL],
    signHash: async (messageHash: string) => {
      const signed = await account.sign(messageHash);
      const last = signing.at(-1);
      if (last) Object.assign(last, { digest: messageHash, signature: [signed.r, signed.s] });
      return signed;
    },
    simulate: false,
    viewingKey: async () => viewingKey,
  } as unknown as Strk20PrepareInput;
  const input = batch.context ? batch.context(base, signing) : base;
  const pause = async (attempt: number, retryAfterMs: number | undefined) => {
    pauses.push({ attempt, retryAfterMs: retryAfterMs ?? null });
  };
  const builders = {
    activate: (transfers: Parameters<typeof strk20RegistrationBuilderFor>[0]) =>
      strk20BuilderFor(observed, transfers, batch.actions, account.address, true),
    actions: undefined,
    registration: strk20RegistrationBuilderFor,
  } as const;
  const historical = {
    activate: "first-shield",
    actions: undefined,
    registration: "registration",
  } as const;

  resetRpcEndpointCooldownsForTests();
  const stream = labelledStream(`strk20-job-${batch.id}`, 48 * 16);
  let outcome: unknown;
  let drawn: Awaited<ReturnType<typeof withRandomStream>>;
  try {
    drawn = await withRandomStream(stream, async () => {
      try {
        if (batch.read) {
          outcome = { result: plain(await runRead(observed, input, batch.read, pause)) };
          return;
        }
        const callAndProof = await prepareWith(
          observed,
          input,
          maturity,
          createRpcProvider,
          pause,
          undefined,
          builders[batch.builder],
          historical[batch.builder],
        );
        outcome = { callAndProof: plain(callAndProof) };
      } catch (error) {
        outcome = { error: errorRecord(error) };
      }
    });
  } finally {
    handler = refuse;
    globalThis.fetch = originals.fetch;
    Date.now = originals.now;
    Strk20CallSetSigner.prototype.signTransaction = originals.sign;
  }
  const unscripted = requests.filter((request) => request.route === "unscripted");
  const unused = Object.entries(queues).filter(([, left]) => left.length > 0);
  if (unscripted.length > 0 || unused.length > 0) {
    throw new Error(
      `${batch.id}: unscripted ${unscripted.map((r) => r.url).join(", ")}; unused ${unused.map(([route]) => route).join(", ")}`,
    );
  }
  const created = sdkSteps["createProofInvocation"] as
    | { readonly error?: unknown; readonly invocation?: unknown; readonly warnings?: unknown }
    | undefined;
  const inputs = {
    account: hex(account.address),
    accountPublicKey: (await account.sign("0x1")).publicKey,
    actions: batch.actions,
    builder: batch.builder,
    chainId: network.chainId,
    discoveryUrl: config.discoveryUrl,
    pool: hex(config.poolAddress),
    proverUrl: config.proverUrl,
    provingBlock: PROVING_BLOCK,
    rpcUrl: RPC_URL,
    viewingKey: hex(viewingKey),
    ...batch.inputs,
  };
  const random = { bytes: bytesHex(drawn.consumed), reads: drawn.reads };
  if (batch.read) {
    const { actions: _actions, builder: _builder, ...readInputs } = inputs;
    return {
      kind: batch.read.kind,
      id: batch.id,
      inputs: readInputs,
      random,
      requests,
      retries: pauses,
      outcome,
    };
  }
  return {
    id: batch.id,
    inputs,
    random,
    requests,
    signing,
    invocation: created?.invocation ?? null,
    sdk: {
      createProofInvocation: created?.error
        ? { error: created.error }
        : { warnings: created?.warnings ?? null },
      executeWithInvocation: sdkSteps["executeWithInvocation"] ?? null,
    },
    retries: pauses,
    outcome,
    ...(batch.extra ? await batch.extra() : {}),
  };
};

/** The extension's two shadow-account reads, through its production service, outside `prepareWith`. */
const runRead = (
  sdk: PrivacySdkRuntime,
  context: Strk20PrepareInput,
  read: NonNullable<Batch["read"]>,
  pauseForServiceRetry: (attempt: number, retryAfterMs: number | undefined) => Promise<void>,
): Promise<unknown> => {
  const service = createOfficialStrk20Service({
    pauseForServiceRetry,
    providerFor: createRpcProvider,
    sdk,
  });
  if (read.kind === "shadow-commitment-read") {
    return service.shadowAccountCommitment({
      ...context,
      dappName: read.dappName,
      ...(read.nonce === undefined ? {} : { nonce: read.nonce }),
    });
  }
  if (!service.shadowAccounts) throw new Error("the service has no shadowAccounts read");
  return service.shadowAccounts({ ...context, dappName: read.dappName, nonces: read.nonces ?? [] });
};

/** Every batch's transcript, one compact JSON line each. */
export const renderStrk20Jobs = async (): Promise<string> => {
  const sdk = await loadBundle();
  const lines = [];
  for (const batch of await strk20Batches()) {
    lines.push(JSON.stringify(await runBatch(sdk, batch)));
  }
  return `${lines.join("\n")}\n`;
};
