/**
 * SNIP-12 CallSet authorization used by the privacy pool. The hash constants
 * and layout are pinned by the protocol's cross-language Cairo/TypeScript
 * golden vector; account signing remains delegated to the wallet's Krusty
 * boundary.
 */

import { sameFelt } from "@bramble/wallet-model/networks";
import type {
  BigNumberish,
  Call,
  DeclareSignerDetails,
  DeployAccountSignerDetails,
  InvocationsSignerDetails,
  Signature,
  SignerInterface,
  TypedData,
} from "starknet";
import { CallData, ec, hash, num, shortString, typedData } from "starknet";

const poseidon = ec.starkCurve.poseidonHashMany;
const toFelt = (value: BigNumberish): bigint => num.toBigInt(value);
const STARKNET_MESSAGE = BigInt(shortString.encodeShortString("StarkNet Message"));
const STARKNET_DOMAIN_TYPE_HASH =
  0x1ff2f602e42168014d405a94f75e8a93d640751d71d16311266e140d8b0a210n;
const CALL_TYPE_HASH = 0x3635c7f2a7ba93844c0d064e18e487f35ab90f7c39d00f186a781fc3f0c2ca9n;
const CALL_SET_TYPE_HASH = 0x308b7462f924efba15fc992e6827eb3a748fcc79f091914156756437fa22909n;
const CALL_SET_DOMAIN_NAME = BigInt(shortString.encodeShortString("CallSet"));

const hashCall = (call: Call): bigint =>
  poseidon([
    CALL_TYPE_HASH,
    toFelt(call.contractAddress),
    toFelt(hash.getSelectorFromName(call.entrypoint)),
    poseidon(CallData.compile(call.calldata ?? []).map(toFelt)),
  ]);

/**
 * Computes the exact SNIP-12 CallSet digest verified by the privacy pool,
 * binding the account, chain, calls, and optional additional data.
 */
export const computeStrk20CallSetHash = (
  accountAddress: BigNumberish,
  calls: readonly Call[],
  chainId: BigNumberish,
  additionalData: readonly BigNumberish[] = [],
): bigint => {
  const domainHash = poseidon([
    STARKNET_DOMAIN_TYPE_HASH,
    CALL_SET_DOMAIN_NAME,
    1n,
    toFelt(chainId),
    1n,
  ]);
  const callSetHash = poseidon([
    CALL_SET_TYPE_HASH,
    poseidon(calls.map(hashCall)),
    poseidon(additionalData.map(toFelt)),
  ]);
  return poseidon([STARKNET_MESSAGE, domainHash, toFelt(accountAddress), callSetHash]);
};

type Strk20CallSetSignerOptions = {
  readonly accountAddress: BigNumberish;
  readonly chainId: BigNumberish;
  readonly sign: (messageHash: string) => Promise<Signature>;
};

/**
 * Minimal signer implementation consumed by the official privacy SDK. Only
 * CallSet transactions and paymaster SNIP-12 messages are supported; unrelated
 * signing methods fail closed.
 */
export class Strk20CallSetSigner implements SignerInterface {
  constructor(private readonly options: Strk20CallSetSignerOptions) {}

  async signTransaction(calls: Call[], _details: InvocationsSignerDetails): Promise<Signature> {
    return this.options.sign(
      num.toHex(computeStrk20CallSetHash(this.options.accountAddress, calls, this.options.chainId)),
    );
  }

  async signMessage(message: TypedData, accountAddress: string): Promise<Signature> {
    if (!sameFelt(accountAddress, this.options.accountAddress)) {
      throw new Error("STRK20 signer account mismatch");
    }
    return this.options.sign(typedData.getMessageHash(message, accountAddress));
  }

  async getPubKey(): Promise<string> {
    throw new Error("STRK20 signer does not expose public keys");
  }

  async signDeclareTransaction(_details: DeclareSignerDetails): Promise<Signature> {
    throw new Error("STRK20 signer does not declare classes");
  }

  async signDeployAccountTransaction(_details: DeployAccountSignerDetails): Promise<Signature> {
    throw new Error("STRK20 signer does not deploy accounts");
  }
}
