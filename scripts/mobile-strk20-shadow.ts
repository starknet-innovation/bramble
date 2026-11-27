/**
 * The STRK20 port's shadow-account and invoke vectors (wallet-core #182, S6), beside the
 * primitives fixture. Everything goes through the shipped bundle's own surface where it has one:
 * a `createPrivateTransfers` session's `build().shadowAccounts(name)` for the partial commitment,
 * the commitment and (from its stored `computeAndInvoke` builder) the anonymizer's additional data,
 * and the exported `shadowAccountAddress` and `PRIMER_CLASS_HASH`. The extension's origin-bound
 * dapp names come from `strk20ShadowAccountScope`, and `compile_actions` from the SDK's
 * `ProofInvocationFactory` as in the primitives fixture. Keys are the parity phrase's.
 *
 * Rows are compact JSON strings, as in the primitives fixture.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_STRK20_NETWORKS } from "@bramble/privacy/config";
import { DEFAULT_TOKENS, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { strk20ShadowAccountScope } from "../apps/extension/src/background/privacy/strk20-shadow-account";
import { PRIVACY_SDK_BUNDLE, parityPrivacyAccount } from "./mobile-privacy-wire";
import { type Action, compileActionsCalldata, hex } from "./mobile-strk20-primitives";

/** Repository-relative path of the committed shadow-account fixture. */
export const STRK20_SHADOW_PATH = "mobile/core/tests/fixtures/extension-strk20-shadow.json";

type Builder = {
  shadowAccounts: (name: string | bigint) => {
    invoke: (nonce: bigint, options: unknown) => unknown;
    partialCommitment: () => Promise<bigint>;
    commitment: (nonce: bigint) => Promise<bigint>;
    dappName: bigint;
  };
  computeAndInvokeAction?: { callBuilder: (args: unknown) => Record<string, unknown> };
};
type Bundle = {
  PRIMER_CLASS_HASH: bigint;
  shadowAccountAddress: (commitment: bigint, anonymizer: bigint) => string;
  createPrivateTransfers: (params: unknown) => { build: () => Builder };
};

const rows = (values: readonly unknown[]): string[] => values.map((value) => JSON.stringify(value));
const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_, v) =>
      typeof v === "bigint" ? hex(v) : typeof v === "number" ? hex(v) : v,
    ),
  );
const config = DEFAULT_STRK20_NETWORKS.SN_MAIN;
const tokenOf = (symbol: string): string => {
  const token = DEFAULT_TOKENS.find((t) => t.networkId === "SN_MAIN" && t.symbol === symbol);
  if (!token) throw new Error(`mainnet ${symbol} missing`);
  return hex(token.address);
};

/** The shadow-account fixture document, as plain JSON data. */
export const computeStrk20Shadow = async () => {
  if (!config?.shadowAccountAnonymizerAddress) throw new Error("mainnet anonymizer missing");
  const anonymizer = hex(config.shadowAccountAnonymizerAddress);
  const pool = hex(config.poolAddress);
  const bundle = (await import(pathToFileURL(resolve(PRIVACY_SDK_BUNDLE)).href)) as Bundle;
  const session = async (index: number) => {
    const { address, viewingKey } = await parityPrivacyAccount(index);
    const transfers = bundle.createPrivateTransfers({
      account: { address, signer: {} },
      discoveryProvider: { url: config.discoveryUrl },
      poolContractAddress: config.poolAddress,
      provingProvider: { chainId: STARKNET_NETWORKS.SN_MAIN.chainId, url: config.proverUrl },
      shadowAccountAnonymizerAddress: anonymizer,
      viewingKeyProvider: { getViewingKey: async () => viewingKey },
    });
    return { address: hex(address), transfers, viewingKey: hex(viewingKey) };
  };
  const accounts = [await session(0), await session(1)];

  const scopes = [];
  for (const [origin, label] of [
    ["https://app.example", "default"],
    ["https://app.example", "trading"],
    ["https://other.example", "default"],
  ] as const) {
    scopes.push({ dappName: await strk20ShadowAccountScope(origin, label), label, origin });
  }
  const names: (string | bigint)[] = ["bramble", scopes[0]?.dappName ?? "", 0x1234n];
  const shadowAccounts = [];
  for (const account of accounts) {
    for (const name of names) {
      const shadow = account.transfers.build().shadowAccounts(name);
      const partial = await shadow.partialCommitment();
      for (const nonce of [0n, 1n, (1n << 64n) - 2n]) {
        const commitment = await shadow.commitment(nonce);
        shadowAccounts.push({
          address: bundle.shadowAccountAddress(commitment, BigInt(anonymizer)),
          anonymizer,
          commitment: hex(commitment),
          dappName: typeof name === "string" ? name : hex(name),
          dappNameFelt: hex(shadow.dappName),
          nonce: hex(nonce),
          partialCommitment: hex(partial),
          user: account.address,
          viewingKey: account.viewingKey,
        });
      }
    }
  }

  const strk = tokenOf("STRK");
  const eth = tokenOf("ETH");
  const call = (n: number) => ({
    calldata: Array.from({ length: n }, (_, i) => hex(0x100 + i)),
    contractAddress: hex(0xc0ffee + n),
    entrypoint: n === 0 ? "ping" : "swap_exact_tokens",
  });
  const note = (i: number) => ({ noteId: hex(0xabc0 + i), token: i % 2 === 0 ? strk : eth });
  const policies = [
    undefined,
    { type: "all" },
    { type: "diff" },
    { amount: 12345n, type: "exact" },
  ];
  const cases: [number, number, unknown][] = [
    ...policies.map((policy): [number, number, unknown] => [1, 1, policy]),
    [0, 0, { type: "all" }],
    [0, 1, { type: "diff" }],
    [1, 0, undefined],
    [3, 3, { amount: (1n << 128n) - 1n, type: "exact" }],
  ];
  const invokeAdditionalData = [];
  for (const [calls, notes, policy] of cases) {
    const builder = accounts[0]?.transfers.build();
    if (!builder) throw new Error("no session");
    const options = {
      calls: Array.from({ length: calls }, (_, i) => call(i + 1)),
      ...(policy === undefined ? {} : { collectPolicy: policy }),
    };
    builder.shadowAccounts("bramble").invoke(7n, options);
    const openNotes = Array.from({ length: notes }, (_, i) => note(i));
    const result = builder.computeAndInvokeAction?.callBuilder({
      openNotes: openNotes.map((n) => ({ noteId: BigInt(n.noteId), token: BigInt(n.token) })),
      poolAddress: BigInt(pool),
      withdrawals: [],
    });
    invokeAdditionalData.push({
      calls: options.calls,
      collectPolicy: policy === undefined ? null : plain(policy),
      dappName: "bramble",
      nonce: "0x7",
      openNotes,
      result: plain(result),
    });
  }

  const user = accounts[0]?.address ?? "";
  const viewingKey = accounts[0]?.viewingKey ?? "";
  const invoke = (calldata: string[]): Action => ({
    input: { calldata, contract_address: "0xc0ffee" },
    type: "InvokeExternal",
  });
  const compute = (a: string[], b: string[]): Action => ({
    input: { compute_additional_data: a, contract_address: anonymizer, invoke_additional_data: b },
    type: "ComputeAndInvoke",
  });
  const deposit: Action = { input: { amount: "0x64", token: strk }, type: "Deposit" };
  const openNote: Action = {
    input: {
      index: "0x0",
      random: "0x5ca1ab1e",
      recipient_addr: user,
      recipient_public_key: "0x3",
      token: strk,
    },
    type: "CreateOpenNote",
  };
  const withdraw: Action = {
    input: { amount: "0x1", random: "0x5ca1ab1e", to_addr: user, token: strk },
    type: "Withdraw",
  };
  const clientActions = [];
  for (const actions of [
    [invoke([])],
    [invoke(["0x1", "0x2", "0x3"])],
    [compute([], [])],
    [compute(["0x6272616d626c65", "0x7"], ["0x1", "0xc0ffee", "0x2", "0xabc"])],
    [deposit, openNote, invoke(["0xabc0"])],
    [deposit, withdraw, compute(["0x1", "0x0"], ["0x0", "0x0"])],
  ]) {
    clientActions.push({
      actions,
      calldata: await compileActionsCalldata(user, viewingKey, actions),
      user,
      viewingKey,
    });
  }

  return {
    clientActions: rows(clientActions),
    extensionScopes: rows(scopes),
    generatedBy:
      "Generated by scripts/generate-mobile-privacy-vectors.ts from the pinned privacy SDK. Do not edit.",
    invokeAdditionalData: rows(invokeAdditionalData),
    primerClassHash: hex(bundle.PRIMER_CLASS_HASH),
    shadowAccounts: rows(shadowAccounts),
  };
};
