/**
 * A stand-in QSB coordinator for the vault suites and the extension E2E: the
 * routes a deposit uses, answered as qsb-app's `server/app.ts` answers them
 * (shapes, status codes, refusal codes), over an in-memory owner and chain.
 *
 * It enforces what the real deployment enforces at its edge, so a client
 * that gets it wrong fails here: every POST must carry the SHA-256 of its
 * exact body in `x-amz-content-sha256` (CloudFront refuses otherwise), the
 * session travels in `X-Qsb-Authorization`, a registration's script hash
 * must be the SHA-256 of its script and its owner the signed-in address, a
 * script is registered once, and a deposit's output 0 must pay the vault
 * script exactly its amount. It never verifies a BIP-322 proof (the suites
 * that need that check it against the coordinator's own verifier offline).
 *
 * {@link answerQsbRequest} is pure over its state, so the E2E's Playwright
 * route and {@link fakeQsbFetch} share one implementation.
 */
import { createHash } from "node:crypto";
import type { QsbHttpFetch } from "@bramble/qsb/client";
import { isoInstant } from "@bramble/qsb/instant";
import { Address, NETWORK, OutScript, Transaction } from "@scure/btc-signer";
import type {
  QsbHorsCommitments,
  QsbVaultSetup,
} from "../../apps/extension/src/background/qsb/qsb-vault-setup";

/** One owner output the fake chain holds, with its whole previous transaction. */
export type FakeUtxo = {
  readonly rawHex: string;
  readonly txid: string;
  readonly valueSat: number;
  readonly vout: number;
};

/** The coordinator's mutable world. */
export type FakeCoordinatorState = {
  readonly calls: string[];
  config: Record<string, unknown>;
  confirmed: Set<string>;
  owner: string;
  rates: { readonly market_rate: number; readonly submit_fee_rate: number };
  /** Route label (`POST /vaults`, …) to a refusal answered instead. */
  readonly refusals: Map<string, { readonly code: string; readonly status: number }>;
  readonly signedIn: Map<string, { readonly id: string; readonly message: string }>;
  submission: "rejected" | "submitted" | "uncertain";
  readonly tokens: Set<string>;
  utxos: FakeUtxo[];
  readonly vaults: Map<string, { raw: string | null; vault: Record<string, unknown> }>;
};

/** One request as the coordinator sees it. */
export type FakeRequest = {
  readonly body: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly url: string;
};

/** One answer: a status and a JSON body. */
export type FakeAnswer = { readonly body: unknown; readonly status: number };

const ORIGIN = "https://d1pjwwq89sze3g.cloudfront.net";
const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");
const refused = (status: number, code: string): FakeAnswer => ({
  body: { code, error: `refused: ${code}` },
  status,
});

/** A fresh state for `owner`, deposits open, MARA's floor at 2 sat/vB. */
export const fakeCoordinatorState = (
  owner: string,
  utxos: FakeUtxo[] = [],
): FakeCoordinatorState => ({
  calls: [],
  config: {
    checks: [{ id: "wallet", label: "Xverse transaction compatibility", passed: false }],
    exactSubmitEnabled: true,
    mainnetEnabled: true,
    network: "mainnet",
    operationsEnabled: true,
    ownerLimits: { allowlist: false, allowlisted: null, maxActiveJobs: null, maxGpuSeconds: null },
  },
  confirmed: new Set(),
  owner,
  rates: { market_rate: 1, submit_fee_rate: 2 },
  refusals: new Map(),
  signedIn: new Map(),
  submission: "submitted",
  tokens: new Set(),
  utxos,
  vaults: new Map(),
});

const RATES_EXTRA = {
  discounted_multiplier: 1,
  effective_rate: 3,
  multiplier: 1.5,
  multiplier_discount_percent: 0,
  slipstream_rate: 3,
};

const list = (state: FakeCoordinatorState) => ({
  noDeposit: [],
  resendable: [],
  strayPayments: [],
  vaults: [...state.vaults.values()].map((entry) => entry.vault),
});

const challenge = (state: FakeCoordinatorState, body: Record<string, unknown>, now: number) => {
  const address = String(body["address"]);
  const id = `00000000-0000-4000-8000-${String(state.signedIn.size + 1).padStart(12, "0")}`;
  const expires = isoInstant((Math.floor(now / 1_000) + 300) * 1_000);
  const message = `QSB Vault sign-in\nOrigin: ${ORIGIN}\nAddress: ${address}\nNetwork: bitcoin-mainnet\nNonce: ${id}\nExpires: ${expires}\nThis signature authorizes this session only. It does not authorize a Bitcoin transaction.`;
  state.signedIn.set(id, { id, message });
  return { body: { id, message }, status: 200 };
};

const verify = (state: FakeCoordinatorState, body: Record<string, unknown>): FakeAnswer => {
  const signed = state.signedIn.get(String(body["id"]));
  if (!signed || typeof body["signature"] !== "string" || body["signature"].length === 0) {
    return refused(401, "challenge_expired");
  }
  state.signedIn.delete(signed.id);
  const token = sha256(`token ${signed.id}`).slice(0, 43).replace(/[0-9]/g, "x");
  state.tokens.add(token);
  return { body: { token }, status: 200 };
};

const register = (state: FakeCoordinatorState, vault: Record<string, unknown>): FakeAnswer => {
  const scriptHex = String(vault["scriptHex"]);
  if (
    vault["paymentAddress"] !== state.owner ||
    vault["status"] !== "unfunded" ||
    "funding" in vault ||
    vault["network"] !== "mainnet" ||
    sha256(Buffer.from(scriptHex, "hex")) !== vault["scriptHash"]
  ) {
    return refused(400, "vault_invalid");
  }
  if (
    [...state.vaults.values()].some((entry) => entry.vault["scriptHash"] === vault["scriptHash"])
  ) {
    return refused(409, "vault_script_registered");
  }
  state.vaults.set(String(vault["id"]), { raw: null, vault });
  return { body: { vault }, status: 201 };
};

// Output 0 must pay the vault script exactly `amount`, as `matchVaultFunding` requires.
const fundSubmit = (
  state: FakeCoordinatorState,
  id: string,
  body: Record<string, unknown>,
): FakeAnswer => {
  const entry = state.vaults.get(id);
  if (!entry) return refused(404, "vault_not_found");
  const raw = String(body["rawTxHex"]).toLowerCase();
  const tx = Transaction.fromRaw(Buffer.from(raw, "hex"), { allowUnknownOutputs: true });
  const output = tx.getOutput(0);
  if (
    output.amount !== BigInt(String(body["amount"])) ||
    Buffer.from(output.script ?? []).toString("hex") !== entry.vault["scriptHex"]
  ) {
    return refused(409, "funding_transaction_invalid");
  }
  if (entry.raw !== null && entry.raw !== raw) return refused(409, "funding_intent_exists");
  const rejected = state.submission === "rejected";
  entry.raw = rejected ? null : raw;
  entry.vault = rejected
    ? entry.vault
    : {
        ...entry.vault,
        funding: { txid: tx.id, value: String(output.amount), vout: 0 },
        status: "submitted",
      };
  return { body: { submission: state.submission, vault: entry.vault }, status: 201 };
};

const funding = (state: FakeCoordinatorState, id: string): FakeAnswer => {
  const entry = state.vaults.get(id);
  const fundingOf = entry?.vault["funding"] as { readonly txid: string } | undefined;
  if (!entry || !fundingOf || entry.raw === null) return refused(409, "vault_not_funded");
  const confirmed = state.confirmed.has(fundingOf.txid);
  if (confirmed) entry.vault = { ...entry.vault, status: "confirmed" };
  return {
    body: {
      previousTxHex: entry.raw,
      status: confirmed
        ? { blockHash: "00".repeat(32), blockHeight: 900_000, confirmations: 1, confirmed }
        : { confirmations: 0, confirmed },
      strayPayments: null,
      vault: entry.vault,
    },
    status: 200,
  };
};

const authenticated = (state: FakeCoordinatorState, request: FakeRequest): boolean => {
  const bearer = request.headers["x-qsb-authorization"] ?? "";
  return bearer.startsWith("Bearer ") && state.tokens.has(bearer.slice(7));
};

const routeOf = (request: FakeRequest): string => {
  const path = new URL(request.url).pathname.replace(/^\/v1/, "");
  return `${request.method} ${path.replace(/\/vaults\/[0-9a-f-]{36}/, "/vaults/:id")}`;
};

type Handler = (
  state: FakeCoordinatorState,
  body: Record<string, unknown>,
  id: string,
  now: number,
) => FakeAnswer;

const HANDLERS: Readonly<Record<string, Handler>> = {
  "GET /config": (state) => ({ body: state.config, status: 200 }),
  "GET /payment-utxos": (state) => ({
    body: {
      utxos: state.utxos.map((utxo) => ({
        txid: utxo.txid,
        value: String(utxo.valueSat),
        vout: utxo.vout,
      })),
    },
    status: 200,
  }),
  "GET /rates": (state) => ({ body: { ...RATES_EXTRA, ...state.rates }, status: 200 }),
  "GET /vaults": (state) => ({ body: list(state), status: 200 }),
  "GET /vaults/:id/funding": (state, _body, id) => funding(state, id),
  "POST /auth/challenge": (state, body, _id, now) => challenge(state, body, now),
  "POST /auth/verify": (state, body) => verify(state, body),
  "POST /payment-input": (state, body) => {
    const utxo = state.utxos.find(
      (held) => held.txid === body["txid"] && held.vout === body["vout"],
    );
    return utxo && String(utxo.valueSat) === body["value"]
      ? { body: { confirmations: 6, previousTxHex: utxo.rawHex }, status: 200 }
      : refused(409, "input_not_found");
  },
  "POST /vaults": (state, body) => register(state, body),
  "POST /vaults/:id/fund/resubmit": (state, _body, id) => {
    const entry = state.vaults.get(id);
    return entry?.raw
      ? { body: { submission: state.submission, vault: entry.vault }, status: 201 }
      : refused(409, "signed_deposit_not_found");
  },
  "POST /vaults/:id/fund/submit": (state, body, id) => fundSubmit(state, id, body),
};

const PUBLIC_ROUTES = new Set([
  "GET /config",
  "GET /rates",
  "POST /auth/challenge",
  "POST /auth/verify",
]);

/**
 * Answers one request against `state` at `now`, recording its route in
 * `state.calls`. Pure but for `state`.
 */
export const answerQsbRequest = (
  state: FakeCoordinatorState,
  request: FakeRequest,
  now: number,
): FakeAnswer => {
  const route = routeOf(request);
  state.calls.push(route);
  if (!new URL(request.url).href.startsWith(`${ORIGIN}/v1/`)) return refused(404, "not_found");
  if (
    request.method === "POST" &&
    request.headers["x-amz-content-sha256"] !== sha256(request.body ?? "")
  ) {
    return refused(403, "body_hash_missing");
  }
  const injected = state.refusals.get(route);
  if (injected) return refused(injected.status, injected.code);
  if (!PUBLIC_ROUTES.has(route) && !authenticated(state, request))
    return refused(401, "auth_required");
  const handler = HANDLERS[route];
  const id = /\/vaults\/([0-9a-f-]{36})/.exec(request.url)?.[1] ?? "";
  return handler
    ? handler(state, JSON.parse(request.body ?? "{}"), id, now)
    : refused(404, "not_found");
};

/** A fetch over the fake, at the injected clock. */
export const fakeQsbFetch =
  (state: FakeCoordinatorState, now: () => number): QsbHttpFetch =>
  async (url, init) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
    const answer = answerQsbRequest(
      state,
      {
        body: typeof init.body === "string" ? init.body : null,
        headers,
        method: init.method ?? "GET",
        url,
      },
      now(),
    );
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };

/**
 * The runtime stand-in: 300 commitment pushes and OP_CHECKSIG, with a public
 * state of the bridge's shape holding the very commitments and script.
 */
export const fakeQsbRuntime = (): {
  calls: number;
  readonly setupFromCommitments: (commitments: QsbHorsCommitments) => Promise<QsbVaultSetup>;
} => {
  const runtime = {
    calls: 0,
    async setupFromCommitments(commitments: QsbHorsCommitments): Promise<QsbVaultSetup> {
      runtime.calls += 1;
      const scriptHex = `${commitments
        .flat()
        .map((commitment) => `14${commitment}`)
        .join("")}ac`;
      const publicStateJson = JSON.stringify({
        config: "A",
        full_script_hex: scriptHex,
        hash_mode: "sha256",
        hors_commitments: commitments,
        n: 150,
        pin_r: 1,
        round_sigs: [],
      });
      return { publicStateJson, scriptHash: sha256(Buffer.from(scriptHex, "hex")), scriptHex };
    },
  };
  return runtime;
};

/** A real transaction paying `values` to `address`, from a made-up outpoint. */
export const paymentToAddress = (
  address: string,
  values: readonly number[],
  label: string,
): FakeUtxo[] => {
  const tx = new Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  const script = OutScript.encode(Address(NETWORK).decode(address));
  for (const value of values) tx.addOutput({ amount: BigInt(value), script });
  tx.addInput({ finalScriptSig: Uint8Array.from([0x51]), index: 0, txid: sha256(label) });
  const raw = tx.toBytes(true, false);
  const txid = Transaction.fromRaw(raw, { allowUnknownOutputs: true }).id;
  const rawHex = Buffer.from(raw).toString("hex");
  return values.map((valueSat, vout) => ({ rawHex, txid, valueSat, vout }));
};
