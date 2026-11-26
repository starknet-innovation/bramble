/**
 * The STRK20 port's primitive vectors (wallet-core #182, S1): every tagged hash in the pinned
 * privacy SDK's `utils/hashes.ts`, its viewing public key, its two random draws over a stubbed
 * `crypto.getRandomValues`, and the `compile_actions` calldata its `ProofInvocationFactory`
 * compiles. Every value is computed by the vendored SDK at its pin; nothing is written by hand.
 *
 * The SDK's helpers are not on the browser bundle's surface, so they are loaded from the pinned
 * `sdk/src` (Bun runs the TypeScript, resolving `starknet` from the SDK's own locked
 * `node_modules`, the graph the bundle is built from). The hashes the testing bundle does export
 * are checked against the source so the two cannot disagree. Keys come from the published parity
 * phrase through the extension's Krusty path (`computeViewingKeys`).
 *
 * Every row array (`hashes`, `publicKeys`, `random`, `clientActions`) holds one compact JSON
 * string per row, decoded by readers, as in `extension-privacy-wire.json`.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { computeViewingKeys } from "./mobile-privacy-wire";
import { vendorRevisionPin } from "./vendor-pin-policy";

/** Repository-relative path of the committed primitives fixture. */
export const STRK20_PRIMITIVES_PATH = "mobile/core/tests/fixtures/extension-strk20-primitives.json";

const SDK_DIR = "vendor/starknet-privacy/sdk";
/** A pinned SDK source module, loaded untyped: the vendored tree has no declarations here. */
export const sdkSource = async <T>(path: string): Promise<T> =>
  (await import(pathToFileURL(resolve(SDK_DIR, "src", path)).href)) as T;

type Felt = bigint | number | string;
type HashFn = (...args: (bigint | number)[]) => bigint;

/** Lowercase unpadded `0x` hex, the fixture's one felt spelling. */
export const hex = (value: Felt): string => `0x${BigInt(value).toString(16)}`;

/** Serves `stream` to `crypto.getRandomValues` while `run` runs, recording each read's length. */
export const withRandomStream = async <T>(
  stream: Uint8Array,
  run: () => T | Promise<T>,
): Promise<{ readonly consumed: Uint8Array; readonly reads: number[]; readonly value: T }> => {
  const original = crypto.getRandomValues;
  const reads: number[] = [];
  let offset = 0;
  // Noble caches `globalThis.crypto` (the object) at import, so the method is swapped in place.
  crypto.getRandomValues = (<A extends ArrayBufferView | null>(array: A): A => {
    if (!(array instanceof Uint8Array)) throw new Error("stub serves Uint8Array reads only");
    if (offset + array.length > stream.length) throw new Error("random stream exhausted");
    array.set(stream.subarray(offset, offset + array.length));
    offset += array.length;
    reads.push(array.length);
    return array;
  }) as typeof crypto.getRandomValues;
  try {
    const value = await run();
    return { consumed: stream.slice(0, offset), reads, value };
  } finally {
    crypto.getRandomValues = original;
  }
};

export const bytesHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
/** A fixed arbitrary stream: sha256 blocks of `label`, so the inputs are reproducible. */
export const labelledStream = (label: string, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  for (let block = 0; block * 32 < length; block += 1) {
    const digest = createHash("sha256").update(`${label}:${block}`).digest();
    out.set(digest.subarray(0, Math.min(32, length - block * 32)), block * 32);
  }
  return out;
};
const leBytes = (value: bigint, length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => Number((value >> BigInt(8 * i)) & 0xffn));

const computeRandom = async () => {
  const sdkCrypto = await sdkSource<{
    generateRandom: () => bigint;
    generateRandom120: () => bigint;
  }>("utils/crypto.ts");
  const { ec } = (await import(Bun.resolveSync("starknet", resolve(SDK_DIR)))) as {
    ec: { starkCurve: { CURVE: { n: bigint } } };
  };
  const order = ec.starkCurve.CURVE.n;
  const streams: [string, Uint8Array, Uint8Array][] = [
    ["zeros", new Uint8Array(48), new Uint8Array(15)],
    ["ones", new Uint8Array(48).fill(0xff), new Uint8Array(15).fill(0xff)],
    // Little-endian n-1 and n-2: the reduction's wrap point and the top of its range.
    ["order-1", leBytes(order - 1n, 48), new Uint8Array(15).fill(0x80)],
    ["order-2", leBytes(order - 2n, 48), Uint8Array.from({ length: 15 }, (_, i) => i)],
    ...["a", "b", "c"].map((label): [string, Uint8Array, Uint8Array] => [
      label,
      labelledStream(`strk20-random-${label}`, 48),
      labelledStream(`strk20-random120-${label}`, 15),
    ]),
  ];
  const rows = [];
  for (const [, full, short] of streams) {
    for (const [fn, stream] of [
      ["generateRandom", full],
      ["generateRandom120", short],
    ] as const) {
      const drawn = await withRandomStream(stream, sdkCrypto[fn]);
      rows.push({
        bytes: bytesHex(drawn.consumed),
        function: fn,
        reads: drawn.reads,
        result: hex(drawn.value),
      });
    }
  }
  // Zeros and ones (the first four rows) must differ per function, or the stub never reached
  // the SDK. (Zeros and little-endian n-1 both give 1: that is the reduction, kept as a row.)
  if (rows[0]?.result === rows[2]?.result || rows[1]?.result === rows[3]?.result) {
    throw new Error("the random stub did not reach the SDK");
  }
  return rows;
};

const HASH_FUNCTIONS = [
  "compute_identity_key",
  "compute_enc_private_key_hash",
  "compute_enc_user_addr_hash",
  "compute_enc_token_hash",
  "compute_enc_channel_key_hash",
  "compute_enc_sender_addr_hash",
  "compute_enc_recipient_addr_hash",
  "compute_channel_key",
  "compute_outgoing_channel_id",
  "compute_channel_marker",
  "compute_subchannel_id",
  "compute_subchannel_marker",
  "compute_note_id",
  "compute_enc_amount_hash",
  "compute_nullifier",
] as const;
type HashName = (typeof HASH_FUNCTIONS)[number];

type Parties = {
  readonly a: bigint;
  readonly b: bigint;
  readonly bPub: bigint;
  readonly key: bigint;
  readonly pool: bigint;
  readonly token: bigint;
};

// Arguments in the SDK's parameter order; `i` is the u32 index, a JavaScript number in the SDK.
const hashArgs = (name: HashName, p: Parties, ck: bigint, i: number): (bigint | number)[] => {
  const salt = 0xabcdef0123456789abcdef01234567n;
  switch (name) {
    case "compute_identity_key":
      return [p.a, p.key, p.pool];
    case "compute_enc_private_key_hash":
    case "compute_enc_user_addr_hash":
    case "compute_enc_channel_key_hash":
    case "compute_enc_sender_addr_hash":
      return [p.bPub];
    case "compute_enc_token_hash":
      return [ck, i, salt];
    case "compute_enc_recipient_addr_hash":
      return [p.a, p.key, i, salt];
    case "compute_channel_key":
      return [p.a, p.key, p.b, p.bPub];
    case "compute_outgoing_channel_id":
      return [p.a, p.key, i];
    case "compute_channel_marker":
      return [ck, p.a, p.b, p.bPub];
    case "compute_subchannel_id":
      return [ck, i];
    case "compute_subchannel_marker":
      return [ck, p.b, p.bPub, p.token];
    case "compute_note_id":
      return [ck, p.token, i];
    case "compute_enc_amount_hash":
      return [ck, p.token, i, salt];
    case "compute_nullifier":
      return [ck, p.token, i, p.key];
  }
};
const INDEXED = new Set<HashName>([
  "compute_enc_token_hash",
  "compute_enc_recipient_addr_hash",
  "compute_outgoing_channel_id",
  "compute_subchannel_id",
  "compute_note_id",
  "compute_enc_amount_hash",
  "compute_nullifier",
]);

const computeHashes = async (real: Parties) => {
  const hashes = await sdkSource<Record<HashName, HashFn>>("utils/hashes.ts");
  const bundled = (await import(
    pathToFileURL(resolve(SDK_DIR, "dist/browser/starknet-sdk-testing.js")).href
  )) as Partial<Record<HashName, HashFn>>;
  const small: Parties = { a: 1n, b: 2n, bPub: 3n, key: 4n, pool: 5n, token: 6n };
  const rows = [];
  for (const name of HASH_FUNCTIONS) {
    const sets: { parties: Parties; index: number }[] = [{ index: 0, parties: small }];
    for (const index of INDEXED.has(name) ? [0, 1, 0xffffffff] : [0]) {
      sets.push({ index, parties: real });
    }
    for (const { parties, index } of sets) {
      const ck = hashes.compute_channel_key(parties.a, parties.key, parties.b, parties.bPub);
      const args = hashArgs(name, parties, ck, index);
      const result = hashes[name](...args);
      const fromBundle = bundled[name]?.(...args);
      if (fromBundle !== undefined && fromBundle !== result) {
        throw new Error(`${name}: SDK source and testing bundle disagree`);
      }
      rows.push({ args: args.map(hex), function: name, result: hex(result) });
    }
  }
  // The tagged hash itself: one Poseidon over the felts, the empty span included.
  const { hash } = await sdkSource<{ hash: HashFn }>("utils/crypto.ts");
  for (const args of [[], [0n], [1n, 2n, 3n], [real.a, real.key, real.b, real.bPub, real.token]]) {
    rows.push({ args: args.map(hex), function: "hash", result: hex(hash(...args)) });
  }
  return rows;
};

type Action = { readonly type: string; readonly input: Readonly<Record<string, Felt>> };
type Factory = {
  create: (
    user: { address: string; viewingKey: string; signer: unknown },
    pool: string,
    actions: unknown[],
    details: unknown,
  ) => Promise<unknown>;
};

/** The compile_actions calldata the SDK's ProofInvocationFactory hands its signer. */
const compileActionsCalldata = async (
  user: string,
  viewingKey: string,
  actions: readonly Action[],
): Promise<string[]> => {
  const module = await sdkSource<{
    ProofInvocationFactory: new () => Factory;
    getDefaultProofDetails: (chainId: string) => unknown;
  }>("internal/proof-invocation-factory.ts");
  let calldata: string[] | undefined;
  const signer = {
    signTransaction: async (calls: { calldata: string[] }[]) => {
      calldata = calls[0]?.calldata;
      return ["0x0", "0x0"];
    },
  };
  const typed = actions.map((action) => ({
    input: Object.fromEntries(
      Object.entries(action.input).map(([k, v]) => [k, k === "index" ? Number(v) : BigInt(v)]),
    ),
    type: action.type,
  }));
  await new module.ProofInvocationFactory().create(
    { address: user, signer, viewingKey },
    hex(STRK20_MAINNET_POOL),
    typed,
    module.getDefaultProofDetails(STARKNET_NETWORKS.SN_MAIN.chainId),
  );
  if (!calldata) throw new Error("the factory never asked its signer to sign");
  return calldata.map(hex);
};

const actionBatches = (p: Parties, ck: bigint): Action[][] => {
  const r = "0x5ca1ab1e0ddba11c0ffee";
  const salt = "0xabcdef0123456789abcdef01234567";
  const big = hex((1n << 128n) - 1n);
  const setKey = { input: { random: r }, type: "SetViewingKey" };
  const open = {
    input: { index: "0x0", random: r, recipient_addr: hex(p.b), salt },
    type: "OpenChannel",
  };
  const sub = {
    input: {
      channel_key: hex(ck),
      index: "0xffffffff",
      recipient_addr: hex(p.b),
      recipient_public_key: hex(p.bPub),
      salt,
      token: hex(p.token),
    },
    type: "OpenSubchannel",
  };
  const enc = {
    input: {
      amount: "0x2386f26fc10000",
      index: "0x1",
      recipient_addr: hex(p.b),
      recipient_public_key: hex(p.bPub),
      salt,
      token: hex(p.token),
    },
    type: "CreateEncNote",
  };
  const openNote = {
    input: {
      index: "0x2",
      random: r,
      recipient_addr: hex(p.b),
      recipient_public_key: hex(p.bPub),
      token: hex(p.token),
    },
    type: "CreateOpenNote",
  };
  const deposit = { input: { amount: big, token: hex(p.token) }, type: "Deposit" };
  const use = {
    input: { channel_key: hex(ck), index: "0x0", token: hex(p.token) },
    type: "UseNote",
  };
  const withdraw = {
    input: { amount: "0x1", random: r, to_addr: hex(p.a), token: hex(p.token) },
    type: "Withdraw",
  };
  return [
    [],
    [setKey],
    [open],
    [sub],
    [enc],
    [openNote],
    [deposit],
    [use],
    [withdraw],
    [setKey, open, sub, deposit, enc, use, withdraw],
  ];
};

// One compact JSON string per row, as in `extension-privacy-wire.json`, to stay within 500 lines.
const rows = (values: readonly unknown[]): string[] => values.map((value) => JSON.stringify(value));

/** The primitives fixture document, as plain JSON data; each row array holds JSON strings. */
export const computeStrk20Primitives = async () => {
  const sdkPackage = JSON.parse(await readFile(`${SDK_DIR}/package.json`, "utf8")) as {
    readonly version: string;
  };
  const vendorScript = "scripts/vendor-privacy-sdk.ts";
  const commit = vendorRevisionPin(
    await readFile(vendorScript, "utf8"),
    vendorScript,
    "PRIVACY_SDK_REVISION",
  );
  const { derivePublicKey } = await sdkSource<{ derivePublicKey: (key: string) => bigint }>(
    "utils/crypto.ts",
  );
  const keys = await computeViewingKeys();
  const [first, second] = keys.accounts;
  if (!first || !second) throw new Error("parity viewing keys missing");
  const publicKeys = keys.accounts.map((account) => {
    const publicKey = hex(derivePublicKey(account.viewingKey));
    if (publicKey !== hex(account.viewingPublicKey)) {
      throw new Error("the SDK and the extension disagree on a viewing public key");
    }
    return { privateKey: hex(account.viewingKey), publicKey };
  });
  const strk = DEFAULT_TOKENS.find(
    (token) => token.networkId === "SN_MAIN" && token.symbol === "STRK",
  );
  if (!strk) throw new Error("mainnet STRK missing");
  const real: Parties = {
    a: BigInt(first.address),
    b: BigInt(second.address),
    bPub: BigInt(second.viewingPublicKey),
    key: BigInt(first.viewingKey),
    pool: BigInt(STRK20_MAINNET_POOL),
    token: BigInt(strk.address),
  };
  const { compute_channel_key } = await sdkSource<Record<HashName, HashFn>>("utils/hashes.ts");
  const ck = compute_channel_key(real.a, real.key, real.b, real.bPub);
  const clientActions = [];
  for (const actions of actionBatches(real, ck)) {
    clientActions.push({
      actions,
      calldata: await compileActionsCalldata(hex(real.a), hex(real.key), actions),
      user: hex(real.a),
      viewingKey: hex(real.key),
    });
  }
  return {
    clientActions: rows(clientActions),
    generatedBy:
      "Generated by scripts/generate-mobile-privacy-vectors.ts from the pinned privacy SDK. Do not edit.",
    hashes: rows(await computeHashes(real)),
    publicKeys: rows(publicKeys),
    random: rows(await computeRandom()),
    sdk: { commit, repository: "starkware-libs/starknet-privacy", version: sdkPackage.version },
  };
};
