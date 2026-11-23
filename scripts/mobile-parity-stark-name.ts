/**
 * Starknet name → address (wallet-core P5), from the extension's own code, for the mobile core's
 * port (`wallet_core::stark_name`, `bramble-core`'s `stark_name.rs`):
 *
 * - `name`: typed text and what the extension does with it: `normalizeStarkName`'s answer,
 *   whether the background's `readStarkNameInput` accepts the message (128 UTF-16 units, not
 *   blank), and, when it does, the `starknet_call` body `resolveStarkName` sends through the real
 *   starknet.js provider (Mainnet, so the naming contract is starknet.js's Mainnet constant), or
 *   the error it throws before any call (`Invalid Starknet name`, or `CallData.compile`'s refusal
 *   of a label whose encoding passes the field prime);
 * - `reply`: one endpoint's reply to that call for `fricoben.stark` (the reply text exactly as the
 *   node sent it, with the id the provider used) and `resolveStarkName`'s outcome over that one
 *   endpoint: `resolved` with its address, `not-found`, `unsupported-network`, `unreachable` (the
 *   reply failed over, and no endpoint was left) or `threw` (the extension fails closed).
 *
 * Left out: the chain-id check and failover across endpoints (the host's, in mobile), and address
 * → name, which the extension does not do. `bun run mobile:parity` writes it; `bun run check`
 * fails on drift. Every value is made up except `fricoben.stark`, a public name the extension's
 * own tests use.
 */
import { createRpcProvider } from "@bramble/starknet/provider";
import { normalizeStarkName, resolveStarkName } from "@bramble/starknet/stark-name";
import { readStarkNameInput } from "../apps/extension/src/background/routing/message-inputs";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const STARK_NAME_PARITY_FIXTURE_PATH =
  "mobile/core/tests/fixtures/extension-stark-name.jsonl";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const ADDRESS = "0x61b6c0a78f9edf13cea17b50719f3344533fadd470b8cb29c2b4318014f52d3";
const FIELD_PRIME = "0x800000000000011000000000000000000000000000000000000000000000001";

/** What the fake node saw and answered for one lookup. */
type Exchange = { request?: unknown; id?: unknown; reply?: string };

/** Each lookup gets its own endpoint, so one case's failover cool-down never skips another's. */
let endpoint = 0;

/**
 * Runs the real `resolveStarkName` over one fake endpoint on Mainnet's chain that answers
 * `starknet_call` with `reply(id)`, recording the call body and the reply text.
 */
const lookup = async (name: string, reply: (id: unknown) => string) => {
  const seen: Exchange = {};
  endpoint += 1;
  const baseFetch = (async (_input: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { readonly id: unknown; method: string };
    const send = (text: string) =>
      new Response(text, { headers: { "content-type": "application/json" }, status: 200 });
    if (request.method === "starknet_chainId") {
      return send(JSON.stringify({ id: request.id, jsonrpc: "2.0", result: MAINNET_CHAIN_ID }));
    }
    if (request.method !== "starknet_call") throw new Error(`unexpected ${request.method}`);
    seen.request = request;
    seen.id = request.id;
    seen.reply = reply(request.id);
    return send(seen.reply);
  }) as never;
  try {
    const outcome = await resolveStarkName({
      expectedChainId: MAINNET_CHAIN_ID,
      makeProvider: (nodeUrl) => createRpcProvider(nodeUrl, { baseFetch }),
      name,
      rpcUrls: [`https://stark-name-${endpoint}.invalid/rpc`],
    });
    return { outcome, seen };
  } catch (error) {
    return { outcome: { status: "threw", error: (error as Error).message }, seen };
  }
};

const NAMES: readonly (readonly [string, string])[] = [
  ["one label", "fricoben.stark"],
  ["mixed case and outer whitespace", "  Fricoben.STARK \n"],
  ["JavaScript whitespace trim (NBSP, BOM, ideographic space)", " ﻿fricoben.stark　"],
  ["two labels", "altaga.braavos.stark"],
  ["three labels", "a.b.c.stark"],
  ["digits and hyphens", "0-9-.stark"],
  ["a single a", "a.stark"],
  ["a final a", "ba.stark"],
  ["a final a in every label", "aa.aaa.stark"],
  ["a hyphen-only label", "---.stark"],
  ["a 47-character label", `${"z".repeat(47)}.stark`],
  ["a 48-character label below the prime", `${"a".repeat(47)}b.stark`],
  ["a 48-character label of a past the prime", `${"a".repeat(48)}.stark`],
  ["a 48-character label of hyphens past the prime", `${"-".repeat(48)}.stark`],
  ["a 48-character label of z past the prime", `${"z".repeat(48)}.stark`],
  ["a 49-character label", `${"a".repeat(49)}.stark`],
  ["no suffix", "fricoben"],
  ["only the suffix", ".stark"],
  ["an empty label", "a..stark"],
  ["a leading dot", ".a.stark"],
  ["a space inside", "has space.stark"],
  ["an underscore", "under_score.stark"],
  ["a non-ASCII letter", "café.stark"],
  ["a dotless capital I lowered", "İ.stark"],
  ["another suffix", "fricoben.eth"],
  ["a doubled suffix", "fricoben.stark.stark"],
  ["the suffix with a trailing dot", "fricoben.stark."],
  ["blank", "   "],
  ["empty", ""],
  ["a hex address", `0x${"a".repeat(64)}`],
  ["128 UTF-16 units", `${"a.".repeat(61)}a.stark`],
  ["129 UTF-16 units", `${"a.".repeat(61)}ab.stark`],
  ["129 units counting outer whitespace", ` ${"a.".repeat(61)}a.stark`],
  ["an astral character counts two units", `${"\u{1f600}".repeat(64)}a.stark`],
];

const computeNames = async () => {
  const cases: object[] = [];
  for (const [name, input] of NAMES) {
    const accepted =
      readStarkNameInput({ name: input, networkId: "SN_MAIN", type: "wallet.resolveStarkName" }) !==
      null;
    const looked = accepted ? await lookup(input, (id) => answer(id, { result: [ADDRESS] })) : null;
    cases.push({
      accepted,
      error: looked?.outcome.status === "threw" ? looked.outcome.error : null,
      input,
      name,
      normalized: normalizeStarkName(input),
      request: looked?.seen.request ?? null,
    });
  }
  return cases;
};

const answer = (id: unknown, body: object) => JSON.stringify({ id, jsonrpc: "2.0", ...body });

const REPLIES: readonly (readonly [string, (id: unknown) => string])[] = [
  ["a nonzero address", (id) => answer(id, { result: [ADDRESS] })],
  ["an unpadded upper-case address", (id) => answer(id, { result: ["0xABC"] })],
  ["a padded address", (id) => answer(id, { result: [`0x000${ADDRESS.slice(2)}`] })],
  ["a decimal answer", (id) => answer(id, { result: ["12345"] })],
  [
    "the largest felt",
    (id) =>
      answer(id, { result: ["0x800000000000011000000000000000000000000000000000000000000000000"] }),
  ],
  ["extra entries after the address", (id) => answer(id, { result: [ADDRESS, "0x1"] })],
  ["zero", (id) => answer(id, { result: ["0x0"] })],
  ["padded zero", (id) => answer(id, { result: ["0x00"] })],
  ["decimal zero", (id) => answer(id, { result: ["0"] })],
  ["the field prime", (id) => answer(id, { result: [FIELD_PRIME] })],
  ["a negative answer", (id) => answer(id, { result: ["-0x1"] })],
  ["a non-felt answer", (id) => answer(id, { result: ["not-a-felt"] })],
  ["an empty answer", (id) => answer(id, { result: [] })],
  [
    "contract not found (code 20)",
    (id) => answer(id, { error: { code: 20, message: "Contract not found" } }),
  ],
  [
    "a contract error naming a missing contract",
    (id) =>
      answer(id, {
        error: { code: 40, data: { revert_error: "x" }, message: "Contract not found" },
      }),
  ],
  [
    "a contract error",
    (id) =>
      answer(id, {
        error: {
          code: 40,
          data: { revert_error: "ENTRYPOINT_NOT_FOUND" },
          message: "Contract error",
        },
      }),
  ],
  [
    "block not found (code 24)",
    (id) => answer(id, { error: { code: 24, message: "Block not found" } }),
  ],
  ["an error without a code", (id) => answer(id, { error: { message: "Internal error" } })],
  ["a body that is not JSON", () => "<html>bad gateway</html>"],
  ["neither result nor error", (id) => answer(id, {})],
];

const computeReplies = async () => {
  const cases: object[] = [];
  for (const [name, reply] of REPLIES) {
    const { outcome, seen } = await lookup("fricoben.stark", reply);
    // A thrown message quotes the whole call; the status is what the port mirrors.
    const judged = outcome.status === "threw" ? { status: "threw" } : outcome;
    cases.push({ id: seen.id ?? null, name, outcome: judged, reply: seen.reply ?? null });
  }
  return cases;
};

/** Runs the extension's code for every case and renders one JSON line per case. */
export const renderStarkNameParity = async (): Promise<string> => {
  const blocks: readonly (readonly [string, readonly object[]])[] = [
    ["name", await computeNames()],
    ["reply", await computeReplies()],
  ];
  return blocks
    .flatMap(([block, cases]) => cases.map((item) => `${JSON.stringify({ block, ...item })}\n`))
    .join("");
};
