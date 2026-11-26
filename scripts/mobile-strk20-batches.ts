/**
 * The canned world the STRK20 job transcripts run against (wallet-core #182): three parity-phrase
 * accounts, and the discovery, node and prover replies each batch is served. Every channel key and
 * note id in a reply is computed by the pinned SDK's own hash functions, every proof fact by its
 * `buildProofFacts`, and the prover's server-action span is compiled through its pool ABI, so the
 * replies agree with what the SDK derives from them.
 *
 * The server actions are not the Cairo pool's output (that needs the pool itself): they are the
 * batch's public token movements, `TransferFrom` per deposit and `TransferTo` per withdrawal, which
 * the SDK copies into `apply_actions` without reading.
 */

import { resolve } from "node:path";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { STRK20_MAINNET_POOL, type Strk20NetworkConfig } from "@bramble/privacy/config";
import type { Strk20PrepareInput } from "@bramble/privacy/service";
import { deriveAccount } from "@bramble/vault/accounts";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { PARITY_MNEMONIC } from "./mobile-parity";
import { parityPrivacyAccount } from "./mobile-privacy-wire";
import { invokeStrk20Batches } from "./mobile-strk20-batches-invoke";
import { moreStrk20Batches } from "./mobile-strk20-batches-more";
import { multisigStrk20Batches } from "./mobile-strk20-batches-multisig";
import type { Signed } from "./mobile-strk20-jobs";
import { bytesHex, hex, labelledStream, sdkSource } from "./mobile-strk20-primitives";

/** The block every batch proves at; discovery pages carry it as `block_ref`. */
export const PROVING_BLOCK = 1_234_567;
const POOL_CLASS_HASH = "0x5ca1ab1e";
const BLOCK_HASH = "0xb10c";
const POOL_NONCE = "0x2a";

/** One reply as served: HTTP status and exact body text. */
export type Served = { readonly status: number; readonly body: string };
/** A reply built from the request it answers (a JSON-RPC reply echoes its id). */
export type Reply = (request: { readonly id: unknown }) => Served;
export type Route = "blockNumber" | "call" | "incoming" | "nonce" | "outgoing" | "prover";

/** One job: which builder the extension uses, its reviewed actions, and its scripted replies. */
export type Batch = {
  readonly id: string;
  readonly builder: "activate" | "actions" | "registration";
  readonly actions: readonly Strk20Action[];
  readonly script: Readonly<Partial<Record<Route, readonly Reply[]>>>;
  /** Routing in place of the bundled mainnet config. */
  readonly config?: Strk20NetworkConfig;
  /** Extra recorded inputs, appended after the common ones. */
  readonly inputs?: Readonly<Record<string, unknown>>;
  /** A shadow-account read instead of a proof job; its line carries `kind`. */
  readonly read?: {
    readonly kind: "shadow-accounts-read" | "shadow-commitment-read";
    readonly dappName: string;
    readonly nonce?: string;
    readonly nonces?: readonly bigint[];
  };
  /** The account a job runs as, in place of parity account 0. */
  readonly account?: {
    readonly address: string;
    readonly viewingKey: string;
    readonly sign: (hash: string) => Promise<{ r: string; s: string; publicKey: string }>;
  };
  /** Rewrites the account context (a multisig's CallSet signer, held-proof hooks). */
  readonly context?: (base: Strk20PrepareInput, signing: Signed[]) => Strk20PrepareInput;
  /** Runs before the job (a co-signer's step); its fields are appended to the line. */
  readonly before?: () => Promise<Readonly<Record<string, unknown>>>;
  /** A whole line that is not a job (a review, a refusal table). */
  readonly line?: () => Promise<Readonly<Record<string, unknown>>>;
  /** Fields appended to the line once the job has run. */
  readonly extra?: () => Promise<Readonly<Record<string, unknown>>>;
};

export type Party = {
  readonly address: bigint;
  readonly viewingKey: bigint;
  readonly publicKey: bigint;
};
type Hashes = {
  compute_channel_key: (a: bigint, k: bigint, b: bigint, p: bigint) => bigint;
  compute_note_id: (ck: bigint, token: bigint, index: number) => bigint;
};

const kmsPromise = import("@starknetfoundation/krusty-kms-wasm").then(createKrustyKms);
const SDK_DIR = "vendor/starknet-privacy/sdk";

/** The account a job runs as: parity account 0 on Starknet Mainnet, with its signing key. */
export const jobAccount = async () => {
  const kms = await kmsPromise;
  const derived = await deriveAccount(kms, {
    accountContractType: "openzeppelin",
    accountIndex: 0,
    mnemonic: PARITY_MNEMONIC,
    networkId: "SN_MAIN",
  });
  return {
    address: derived.account.address,
    sign: (hash: string) => kms.signStarkHash(derived.privateKey, hash),
  };
};

const ok =
  (value: unknown): Reply =>
  () => ({ body: JSON.stringify(value), status: 200 });
const rpc =
  (result: unknown): Reply =>
  ({ id }) => ({ body: JSON.stringify({ id, jsonrpc: "2.0", result }), status: 200 });
const rpcError =
  (code: number, message: string): Reply =>
  ({ id }) => ({
    body: JSON.stringify({ error: { code, message }, id, jsonrpc: "2.0" }),
    status: 200,
  });

/** A channel in an `outgoing_state` reply; `tokens` overrides the single STRK `last`. */
export type Out = {
  to: Party;
  created: boolean;
  last?: number | null;
  tokens?: readonly (readonly [bigint, number | null])[];
};
/** A note in an `incoming_state` reply, to the job's account; STRK unless `token` is set. */
export type In = { from: Party; index: number; amount: bigint; token?: bigint };
const saltLabel = (note: In): string =>
  note.token === undefined ? `salt-${note.index}` : `salt-${hex(note.token)}-${note.index}`;

/** The world's helpers, handed to the later batches. */
export type BatchKit = {
  readonly a: Party;
  readonly b: Party;
  readonly c: Party;
  readonly strk: bigint;
  readonly eth: bigint;
  readonly channelKey: (from: Party, to: Party) => bigint;
  readonly outgoing: (
    entries: readonly Out[],
    total: number,
    cursor?: unknown,
    sender?: Party,
  ) => Reply;
  readonly incoming: (notes: readonly In[], cursor?: unknown, withChannels?: boolean) => Reply;
  readonly job: (
    id: string,
    builder: Batch["builder"],
    actions: readonly Strk20Action[],
    script: Batch["script"],
  ) => Batch;
  readonly deposit: (amount: string, recipient?: Party, of?: string) => Strk20Action;
  readonly transfer: (amount: string, to: Party, of?: string) => Strk20Action;
  readonly withdraw: (amount: string, of?: string) => Strk20Action;
  readonly self: Out;
  readonly toB: Out;
  readonly funds: Reply;
  readonly rpc: (result: unknown) => Reply;
  /** The prover's reply for `actions`, with deposits drawn from `from`. */
  readonly proved: (actions: readonly Strk20Action[], screening?: boolean, from?: Party) => Reply;
  /** A party for an address and its viewing key, with the SDK's public key. */
  readonly partyOf: (address: bigint, viewingKey: bigint) => Party;
};

/** Computes the world and returns every batch, in fixture order. */
export const strk20Batches = async (): Promise<readonly Batch[]> => {
  const { derivePublicKey } = await sdkSource<{ derivePublicKey: (k: bigint) => bigint }>(
    "utils/crypto.ts",
  );
  const hashes = await sdkSource<Hashes>("utils/hashes.ts");
  const facts = await sdkSource<{
    buildMessagePayload: (classHash: string, actions: string[]) => string[];
    buildProofFacts: (...args: unknown[]) => string[];
  }>("utils/proof-facts.ts");
  const { PrivacyPoolABI } = await sdkSource<{ PrivacyPoolABI: unknown }>("internal/abi.ts");
  const starknet = (await import(Bun.resolveSync("starknet", resolve(SDK_DIR)))) as {
    CairoCustomEnum: new (variants: Record<string, unknown>) => unknown;
    CairoOption: new (variant: number, value?: unknown) => unknown;
    CairoOptionVariant: { None: number };
    CallData: new (
      abi: unknown,
    ) => {
      compile: (method: string, args: unknown) => string[];
      decodeParameters: (type: string, data: string[]) => unknown;
    };
  };
  const party = async (index: number): Promise<Party> => {
    const { address, viewingKey } = await parityPrivacyAccount(index);
    const key = BigInt(viewingKey);
    return { address: BigInt(address), publicKey: derivePublicKey(key), viewingKey: key };
  };
  const [a, b, c] = [await party(0), await party(1), await party(2)];
  const ethToken = DEFAULT_TOKENS.find((t) => t.networkId === "SN_MAIN" && t.symbol === "ETH");
  if (!ethToken) throw new Error("mainnet ETH missing");
  const eth = BigInt(ethToken.address);
  const strkToken = DEFAULT_TOKENS.find((t) => t.networkId === "SN_MAIN" && t.symbol === "STRK");
  if (!strkToken) throw new Error("mainnet STRK missing");
  const strk = BigInt(strkToken.address);
  const pool = hex(STRK20_MAINNET_POOL);
  const channelKey = (from: Party, to: Party): bigint =>
    hashes.compute_channel_key(from.address, from.viewingKey, to.address, to.publicKey);

  const outgoing = (
    entries: readonly Out[],
    total: number,
    cursor: unknown = { channel_discovery_complete: true, total_n_channels: total },
    sender: Party = a,
  ): Reply =>
    ok({
      block_ref: PROVING_BLOCK,
      channels: entries.map((entry) => ({
        channel_key: hex(channelKey(sender, entry.to)),
        ...(entry.created ? {} : { precomputed: true }),
        recipient_addr: hex(entry.to.address),
        recipient_public_key: hex(entry.to.publicKey),
      })),
      cursor,
      subchannels: entries
        .filter((entry) => entry.created && (entry.last !== undefined || entry.tokens))
        .flatMap((entry) =>
          (entry.tokens ?? [[strk, entry.last ?? null] as const]).map(([token, last]) => ({
            last_note_index: last,
            recipient_addr: hex(entry.to.address),
            token: hex(token),
          })),
        ),
    });
  const incoming = (
    notes: readonly In[],
    cursor: unknown = { channel_discovery_complete: true },
    withChannels = true,
  ): Reply => {
    const senders = [...new Set(notes.map((note) => note.from))];
    const pairs = [
      ...new Map(
        notes.map((note) => [`${note.from.address}:${note.token ?? strk}`, note] as const),
      ).values(),
    ];
    return ok({
      block_ref: PROVING_BLOCK,
      channels: (withChannels ? senders : []).map((from) => ({
        channel_key: hex(channelKey(from, a)),
        sender_addr: hex(from.address),
      })),
      cursor,
      notes: notes.map((note) => ({
        amount: note.amount.toString(),
        block_number: PROVING_BLOCK - 100,
        index: note.index,
        note_id: hex(
          hashes.compute_note_id(channelKey(note.from, a), note.token ?? strk, note.index),
        ),
        salt: BigInt(`0x${bytesHex(labelledStream(saltLabel(note), 15))}`).toString(),
        sender_addr: hex(note.from.address),
        token: hex(note.token ?? strk),
      })),
      subchannels: pairs.map((note) => ({
        sender_addr: hex(note.from.address),
        token: hex(note.token ?? strk),
      })),
    });
  };

  const VARIANTS = ["WriteOnce", "Append", "TransferFrom", "TransferTo", "EmitViewingKeySet"];
  const MORE = ["EmitWithdrawal", "EmitDeposit", "EmitOpenNoteCreated", "EmitEncNoteCreated"];
  const ALL = [...VARIANTS, ...MORE, "EmitNoteUsed", "Invoke", "InvokeWithComputation"];
  const action = (name: string, input: unknown) =>
    new starknet.CairoCustomEnum(
      Object.fromEntries(ALL.map((v) => [v, v === name ? input : undefined])),
    );
  const abi = new starknet.CallData(PrivacyPoolABI);
  // The batch's public token movements, as a pool would emit them, through the pool's own ABI.
  const serverActions = (actions: readonly Strk20Action[], from: Party): string[] => {
    const span = actions.flatMap((entry) =>
      entry.type === "deposit"
        ? [
            action("TransferFrom", {
              amount: BigInt(entry.amount),
              from_addr: from.address,
              token: BigInt(entry.token),
            }),
          ]
        : entry.type === "withdraw"
          ? [
              action("TransferTo", {
                amount: BigInt(entry.amount),
                to_addr: BigInt(entry.recipient),
                token: BigInt(entry.token),
              }),
            ]
          : [],
    );
    const none = new starknet.CairoOption(starknet.CairoOptionVariant.None);
    const compiled = abi.compile("apply_actions", { actions: span, screening: none }).map(hex);
    return compiled.slice(0, -1); // drop the trailing `None` the SDK appends itself
  };
  const proved = (actions: readonly Strk20Action[], screening = false, from = a): Reply => {
    const span = serverActions(actions, from);
    abi.decodeParameters("core::array::Span::<privacy::actions::ServerAction>", span);
    const chainId = STARKNET_NETWORKS.SN_MAIN.chainId;
    return rpc({
      ...(screening
        ? {
            additional_data: {
              signature: { issued_at: 1_800_000_000, sig_r: "0x51", sig_s: "0x52" },
            },
          }
        : {}),
      l2_to_l1_messages: [
        {
          from_address: pool,
          payload: facts.buildMessagePayload(POOL_CLASS_HASH, span),
          to_address: "0x0",
        },
      ],
      proof: Buffer.from(labelledStream("strk20-proof", 96)).toString("base64"),
      proof_facts: facts
        .buildProofFacts(pool, POOL_CLASS_HASH, span, BigInt(PROVING_BLOCK), BLOCK_HASH, chainId)
        .map(hex),
    });
  };

  const token = hex(strk);
  const deposit = (amount: string, recipient?: Party, of = token): Strk20Action => ({
    amount,
    token: of,
    type: "deposit",
    ...(recipient ? { recipient: hex(recipient.address) } : {}),
  });
  const transfer = (amount: string, to: Party, of = token): Strk20Action =>
    ({ amount, recipient: hex(to.address), token: of, type: "transfer" }) as Strk20Action;
  const withdraw = (amount: string, of = token): Strk20Action => ({
    amount,
    recipient: hex(a.address),
    token: of,
    type: "withdraw",
  });
  const self = { created: true, last: 1, to: a };
  const toB = { created: true, last: 0, to: b };
  const nonce = [rpc(POOL_NONCE)];
  const job = (
    id: string,
    builder: Batch["builder"],
    actions: readonly Strk20Action[],
    script: Batch["script"],
  ): Batch => ({ actions, builder, id, script: { nonce, prover: [proved(actions)], ...script } });
  const shield = [deposit("5000000000000000000")];
  const funds = incoming([{ amount: 10_000_000_000_000_000_000n, from: b, index: 0 }]);

  const kit: BatchKit = {
    a,
    b,
    c,
    channelKey,
    deposit,
    eth,
    funds,
    incoming,
    job,
    outgoing,
    partyOf: (address, viewingKey) => ({
      address,
      publicKey: derivePublicKey(viewingKey),
      viewingKey,
    }),
    proved,
    rpc,
    self,
    strk,
    toB,
    transfer,
    withdraw,
  };
  return [
    job("register", "registration", [], { outgoing: [outgoing([], 0)] }),
    job("activate-shield", "activate", shield, { outgoing: [outgoing([], 0)] }),
    job("shield-self", "actions", shield, { outgoing: [outgoing([self], 1)] }),
    job("shield-other", "actions", [deposit("2000000000000000000", b)], {
      outgoing: [outgoing([self, { created: false, to: b }], 1)],
    }),
    job("send-change", "actions", [transfer("3000000000000000000", b)], {
      incoming: [funds],
      outgoing: [outgoing([self, toB], 2)],
    }),
    job("send-two-notes", "actions", [transfer("7000000000000000000", b)], {
      incoming: [
        incoming([
          { amount: 3_000_000_000_000_000_000n, from: b, index: 0 },
          { amount: 5_000_000_000_000_000_000n, from: a, index: 0 },
          { amount: 2_000_000_000_000_000_000n, from: b, index: 1 },
        ]),
      ],
      outgoing: [outgoing([self, toB], 2)],
    }),
    job("open-amount", "actions", [transfer("OPEN", b)], { outgoing: [outgoing([self, toB], 2)] }),
    job("unshield", "actions", [withdraw("4000000000000000000")], {
      incoming: [funds],
      outgoing: [outgoing([self], 1)],
    }),
    job("insufficient-balance", "actions", [transfer("100000000000000000000", b)], {
      incoming: [funds],
      nonce: [],
      outgoing: [outgoing([self, toB], 2)],
      prover: [],
    }),
    job("user-linkage", "actions", [deposit("1000", b), deposit("2000", c)], {
      outgoing: [outgoing([self, { created: false, to: b }, { created: false, to: c }], 1)],
      prover: [],
    }),
    job("reorg-restart", "actions", shield, {
      outgoing: [() => ({ body: "BLOCK_REORGED", status: 409 }), outgoing([self], 1)],
    }),
    job("prover-busy-retry", "actions", shield, {
      outgoing: [outgoing([self], 1)],
      prover: [
        rpcError(-32005, "Service busy"),
        () => ({ body: "Service Unavailable", status: 503 }),
        proved(shield),
      ],
    }),
    job("screening-attestation", "actions", shield, {
      outgoing: [outgoing([self], 1)],
      prover: [proved(shield, true)],
    }),
    ...moreStrk20Batches(kit),
    ...(await invokeStrk20Batches(kit)),
    ...(await multisigStrk20Batches(kit)),
  ];
};
