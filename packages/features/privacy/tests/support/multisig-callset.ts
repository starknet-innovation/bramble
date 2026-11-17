/**
 * Builds multisig STRK20 CallSet authorizations in the exact shape the privacy
 * SDK produces: one `compile_actions(user, key, Span<ClientAction>)` call on
 * the pool, redacted for the shared scalar. `pool-client-actions-abi.test.ts`
 * pins this layout to the vendored pool ABI.
 */
import {
  type MultisigStrk20Authorization,
  multisigStrk20CallSetHash,
} from "@bramble/privacy/multisig-strk20";
import { redactStrk20Calldata } from "@bramble/privacy/multisig-strk20-redaction";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { ec, num } from "starknet";

/** One client action as `[variant index, ...member felts]`. */
export type ClientActionFelts = readonly string[];

export const setViewingKey = (): ClientActionFelts => ["0x0", "0x5"];
export const openChannel = (recipient: string): ClientActionFelts => [
  "0x1",
  recipient,
  "0x0",
  "0x1",
  "0x2",
];
export const deposit = (token: string, amount: bigint): ClientActionFelts => [
  "0x5",
  token,
  num.toHex(amount),
];
export const useNote = (token: string): ClientActionFelts => ["0x6", "0x8", token, "0x0"];
export const encNote = (recipient: string, token: string, amount: bigint): ClientActionFelts => [
  "0x3",
  recipient,
  "0x9",
  token,
  num.toHex(amount),
  "0x2",
  "0x4",
];
export const withdraw = (recipient: string, token: string, amount: bigint): ClientActionFelts => [
  "0x7",
  recipient,
  token,
  num.toHex(amount),
  "0x6",
];
export const invokeExternal = (target: string): ClientActionFelts => ["0x8", target, "0x0"];
export const openNote = (recipient: string, token: string): ClientActionFelts => [
  "0x4",
  recipient,
  "0x9",
  token,
  "0x0",
  "0x1",
];

/** Restored `compile_actions` calldata for `account`, keyed by `scalar`. */
export const compileActionsCalldata = (
  account: string,
  scalar: string,
  actions: readonly ClientActionFelts[],
): readonly string[] => [account, scalar, num.toHex(actions.length), ...actions.flat()];

/** Inputs for {@link callSetAuthorization}. Fields default to a 2-of-2 on mainnet. */
export type CallSetInput = {
  readonly accountAddress: string;
  readonly accountId: string;
  readonly actions: readonly ClientActionFelts[];
  readonly calldata?: readonly string[];
  readonly chainId: string;
  readonly entrypoint?: string;
  readonly pool: string;
  readonly scalar: string;
  readonly signerPublicKeys: readonly string[];
  readonly signWith?: readonly { readonly privateKey: string; readonly publicKey: string }[];
  readonly summary?: string;
  readonly threshold: number;
};

/**
 * A self-consistent authorization: its hash is recomputed from its own
 * account, chain, and calls, and every fragment verifies. Whether it is bound
 * to a particular multisig is exactly what the code under test decides.
 */
export const callSetAuthorization = (input: CallSetInput): MultisigStrk20Authorization => {
  const restored =
    input.calldata ?? compileActionsCalldata(input.accountAddress, input.scalar, input.actions);
  const calls = [
    {
      calldata: redactStrk20Calldata(restored, input.scalar) ?? [],
      contractAddress: input.pool,
      entrypoint: input.entrypoint ?? "compile_actions",
    },
  ];
  const hash =
    multisigStrk20CallSetHash(input.accountAddress, calls, input.chainId, input.scalar) ?? "0x0";
  const fragments = (input.signWith ?? [])
    .map((signer) => {
      const signed = ec.starkCurve.sign(hash, signer.privateKey);
      return { publicKey: signer.publicKey, r: num.toHex(signed.r), s: num.toHex(signed.s) };
    })
    .sort((left, right) =>
      BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey)) ? -1 : 1,
    );
  return {
    accountAddress: input.accountAddress,
    accountId: input.accountId,
    calls,
    chainId: input.chainId,
    fragments,
    hash,
    id: `${input.accountId}:${hash}`,
    request: { kind: "register" },
    signerPublicKeys: input.signerPublicKeys,
    state: fragments.length >= input.threshold ? "ready" : "collecting",
    summary: input.summary ?? "Register this multisig's private balance",
    threshold: input.threshold,
  };
};
