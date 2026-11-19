/**
 * A privacy service that compiles the way the official SDK does: every
 * compile draws a new random value into the pool calldata, asks the account
 * to sign that call's CallSet digest while compiling, and passes the compiled
 * request through `heldProof.hold` before proving it. A fake that compiled the
 * same calldata twice is what let the multisig flow ship unable to work on
 * chain, so this one never does.
 */
import { computeStrk20CallSetHash } from "@bramble/privacy/call-set-signer";
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import type { Strk20HeldProofRequest, Strk20Service } from "@bramble/privacy/service";
import { canonicalFelt, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { type Call, num, transaction } from "starknet";
import { compileActionsCalldata } from "../../packages/features/privacy/tests/support/multisig-callset";
import { HARNESS_MULTISIG } from "./multisig-harness";

/** The fixed scalar the harness's fake vault creates as the viewing key. */
export const HARNESS_SCALAR = "0x654321";
// The configured mainnet pool, canonical.
const HARNESS_POOL = canonicalFelt(STRK20_MAINNET_POOL) ?? "0x1";
/** Block every compile is made for. */
export const COMPILED_BLOCK = 100;

// Base block at index 4 and a one-hash span at index 7, as the pool lays out
// proof facts, so the wallet can read the proof's window.
const PROOF = {
  data: "aa",
  output: ["0x1"],
  proof_facts: ["0x1", "0x2", "0x3", "0x4", num.toHex(COMPILED_BLOCK), "0x6", "0x7", "0x1", "0x9"],
};

/** What the fake did, for a test to assert on. */
export type RandomizedSdkLog = {
  /** Calls the account was asked to sign, one per compile. */
  readonly compiled: Call[];
  /** Requests proved, in order. */
  readonly proved: Strk20HeldProofRequest[];
  /** Pool writes recorded for maturity: the account id and the hash. */
  readonly recorded: { readonly accountId: string; readonly transactionHash: string }[];
};

/**
 * The fake service. `tamper` makes a compile sign one call and put another's
 * calldata in the request, as a broken or hostile SDK might.
 */
export const randomizedStrk20Sdk = (
  options: { readonly tamper?: boolean } = {},
): { readonly log: RandomizedSdkLog; readonly service: Strk20Service } => {
  const log: RandomizedSdkLog = { compiled: [], proved: [], recorded: [] };
  const poolCall = (random: number): Call => ({
    calldata: [
      ...compileActionsCalldata(HARNESS_MULTISIG, HARNESS_SCALAR, [["0x0", num.toHex(random)]]),
    ],
    contractAddress: HARNESS_POOL,
    entrypoint: "compile_actions",
  });
  const executeCalldata = (call: Call): string[] =>
    transaction.getExecuteCalldata([call], "1").map((felt) => num.toHex(felt as string));
  const service = {
    async poolFee() {
      return "0x1";
    },
    async prepare() {
      throw new Error("unused");
    },
    async recordSubmission(
      input: { readonly account: { readonly id: string } },
      transactionHash: string,
    ) {
      log.recorded.push({ accountId: input.account.id, transactionHash });
    },
    async prepareRegistration(input: {
      readonly heldProof?: {
        readonly hold: (request: Strk20HeldProofRequest) => Promise<Strk20HeldProofRequest>;
        readonly resume: () => Promise<Strk20HeldProofRequest | null>;
      };
      readonly signCallSet?: (hash: string, calls: readonly Call[]) => Promise<string[]>;
    }) {
      let request = (await input.heldProof?.resume()) ?? null;
      if (!request) {
        // A new random value on every compile, as the SDK draws one.
        const call = poolCall(0x1000 + log.compiled.length);
        log.compiled.push(call);
        const digest = num.toHex(
          computeStrk20CallSetHash(HARNESS_MULTISIG, [call], STARKNET_NETWORKS.SN_MAIN.chainId),
        );
        const signature = (await input.signCallSet?.(digest, [call])) ?? [];
        const proved = options.tamper ? poolCall(0x9999) : call;
        const compiled: Strk20HeldProofRequest = {
          invocation: {
            calldata: executeCalldata(proved),
            nonce: "0x0",
            sender_address: HARNESS_POOL,
            signature,
            type: "INVOKE",
            version: "0x3",
          },
          provingBlock: COMPILED_BLOCK,
        };
        request = input.heldProof ? await input.heldProof.hold(compiled) : compiled;
      }
      log.proved.push(request);
      return {
        allowanceGrants: [],
        calls: [{ calldata: ["0x1"], contractAddress: HARNESS_POOL, entrypoint: "apply_actions" }],
        proof: PROOF,
      };
    },
  } as unknown as Strk20Service;
  return { log, service };
};

/** The `__execute__` calldata the SDK proves for `call`. */
export const sdkExecuteCalldata = (call: Call): readonly string[] =>
  transaction.getExecuteCalldata([call], "1").map((felt) => num.toHex(felt as string));
