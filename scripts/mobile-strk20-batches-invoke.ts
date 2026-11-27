/**
 * The STRK20 job batches for S6 (wallet-core #182): the extension's `invoke` action with its
 * `${poolAddress}` and `${openNoteIds[i]}` templates, `shadow_account_invoke` under each collect
 * policy, the refusals around them, and the two shadow-account reads the extension runs outside
 * `prepareWith` (the commitment, after a note discovery, and `get_shadow_accounts`).
 *
 * A shadow invoke's `dapp_name` is the extension's origin-bound scope
 * (`strk20ShadowAccountScope`), as `bindStrk20ActionsToOrigin` rewrites it just before the SDK
 * call; the line records the origin and label it came from. The anonymizer's `get_shadow_accounts`
 * replies carry addresses the SDK's own shadow-account functions derive.
 */
import { resolve } from "node:path";
import { DEFAULT_STRK20_NETWORKS } from "@bramble/privacy/config";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { strk20ShadowAccountScope } from "../apps/extension/src/background/privacy/strk20-shadow-account";
import type { Batch, BatchKit } from "./mobile-strk20-batches";
import { hex, sdkSource } from "./mobile-strk20-primitives";

const E18 = 1_000_000_000_000_000_000n;
const ORIGIN = "https://app.example";
const LABEL = "default";
// The extension's calldata templates, spelled as its builder spells them.
const POOL_TEMPLATE = `${"$"}{poolAddress}`;
const noteTemplate = (index: number): string => `${"$"}{openNoteIds[${index}]}`;

/** The S6 batches and reads, in fixture order. */
export const invokeStrk20Batches = async (kit: BatchKit): Promise<readonly Batch[]> => {
  const { a, b, funds, incoming, job, outgoing, rpc, self, toB, transfer, withdraw } = kit;
  const config = DEFAULT_STRK20_NETWORKS.SN_MAIN;
  const anonymizer = config?.shadowAccountAnonymizerAddress;
  if (!config || !anonymizer) throw new Error("mainnet anonymizer missing");
  const dappName = await strk20ShadowAccountScope(ORIGIN, LABEL);
  const shadowInputs = { anonymizer: hex(anonymizer), label: LABEL, origin: ORIGIN };
  const strk = hex(kit.strk);
  const invoke = (calldata: readonly string[]): Strk20Action => ({
    calldata,
    contract: "0xc0ffee",
    type: "invoke",
  });
  const call = (entry: string, calldata: readonly string[]) => ({
    calldata,
    contract_address: "0xc0ffee",
    entry_point: entry,
  });
  const shadow = (
    calls: ReturnType<typeof call>[],
    policy: Extract<Strk20Action, { type: "shadow_account_invoke" }>["collect_policy"],
  ): Strk20Action => ({
    calls,
    collect_policy: policy,
    dapp_name: dappName,
    nonce: "0x0",
    type: "shadow_account_invoke",
  });
  const withInputs = (batch: Batch, extra: Record<string, unknown> = {}): Batch => ({
    ...batch,
    inputs: { ...shadowInputs, ...extra },
  });
  const none = { nonce: [], prover: [] };
  const { shadowAccountAnonymizerAddress: _drop, ...withoutAnonymizer } = config;

  // The anonymizer's answer for one [start, end) window, from the SDK's own derivation.
  const sdkShadow = await sdkSource<{
    shadowAccountPartialCommitment: (u: bigint, k: bigint, an: bigint, d: bigint) => bigint;
    shadowAccountCommitment: (partial: bigint, nonce: bigint) => bigint;
    shadowAccountAddress: (commitment: bigint, an: bigint) => string;
  }>("internal/shadow-account-address.ts");
  const { shortString } = (await import(
    Bun.resolveSync("starknet", resolve("vendor/starknet-privacy/sdk"))
  )) as { shortString: { encodeShortString: (s: string) => string } };
  const partial = sdkShadow.shadowAccountPartialCommitment(
    a.address,
    a.viewingKey,
    BigInt(anonymizer),
    BigInt(shortString.encodeShortString(dappName)),
  );
  const window = (start: bigint, end: bigint, deployed: readonly bigint[]) =>
    rpc([
      hex(end - start),
      ...Array.from({ length: Number(end - start) }, (_, i) => {
        const nonce = start + BigInt(i);
        const commitment = sdkShadow.shadowAccountCommitment(partial, nonce);
        return [
          hex(nonce),
          sdkShadow.shadowAccountAddress(commitment, BigInt(anonymizer)),
          hex(deployed.includes(nonce) ? 1n : 0n),
        ];
      }).flat(),
    ]);
  const read = (
    id: string,
    spec: NonNullable<Batch["read"]>,
    script: Batch["script"],
    extra: Record<string, unknown>,
  ): Batch => ({
    actions: [],
    builder: "actions",
    id,
    inputs: { ...shadowInputs, dappName, ...extra },
    read: spec,
    script,
  });
  const swap = call("swap_exact_tokens", ["0x1", strk, "0x64"]);

  return [
    withInputs(
      job("invoke-alone", "actions", [invoke(["0x1", "0x2"])], { outgoing: [outgoing([self], 1)] }),
    ),
    withInputs(
      job(
        "invoke-open-note-templates",
        "actions",
        [transfer("OPEN", b), invoke([POOL_TEMPLATE, noteTemplate(0), "0x5"])],
        { outgoing: [outgoing([self, toB], 2)] },
      ),
    ),
    withInputs(
      job("withdraw-plus-invoke", "actions", [withdraw(`${4n * E18}`), invoke(["0x7"])], {
        incoming: [funds],
        outgoing: [outgoing([self], 1)],
      }),
    ),
    withInputs(
      job("shadow-invoke-one-call", "actions", [shadow([swap], { type: "all" })], {
        outgoing: [outgoing([self], 1)],
      }),
    ),
    withInputs(
      job(
        "shadow-invoke-two-calls-open-exact",
        "actions",
        [
          transfer("OPEN", b),
          shadow([call("approve", ["0xc0ffee", "0x64", "0x0"]), swap], {
            amount: "100",
            type: "exact",
          }),
        ],
        { outgoing: [outgoing([self, toB], 2)] },
      ),
    ),
    withInputs(
      job(
        "shadow-invoke-diff",
        "actions",
        [transfer("OPEN", b), shadow([swap], { type: "diff" })],
        {
          outgoing: [outgoing([self, toB], 2)],
        },
      ),
    ),
    withInputs(
      job(
        "two-invoke-phase-actions",
        "actions",
        [invoke(["0x1"]), shadow([swap], { type: "all" })],
        {
          ...none,
        },
      ),
    ),
    {
      ...withInputs(
        job("shadow-invoke-no-anonymizer", "actions", [shadow([swap], { type: "all" })], none),
        { anonymizer: null },
      ),
      config: withoutAnonymizer,
    },
    withInputs(
      job(
        "invoke-open-note-index-out-of-range",
        "actions",
        [transfer("OPEN", b), invoke([noteTemplate(1)])],
        { outgoing: [outgoing([self, toB], 2)], ...none },
      ),
    ),
    read(
      "shadow-partial-commitment-read",
      { dappName, kind: "shadow-commitment-read" },
      { incoming: [incoming([])] },
      {},
    ),
    read(
      "shadow-commitment-read",
      { dappName, kind: "shadow-commitment-read", nonce: "0x1" },
      { incoming: [funds] },
      { nonce: "0x1" },
    ),
    read(
      "shadow-accounts-read",
      { dappName, kind: "shadow-accounts-read", nonces: [5n, 0n, 2n, 1n] },
      { call: [window(0n, 3n, [0n]), window(5n, 6n, [])] },
      { nonces: ["0x5", "0x0", "0x2", "0x1"] },
    ),
  ];
};
