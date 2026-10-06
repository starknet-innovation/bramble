/** Contract-aware starknet.js signer adapters for wallet account families. */

import { WalletError } from "@bramble/core/errors";
import {
  accountClassEntry,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { isStarkFieldElement, sameFelt } from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import {
  Account,
  type DeployAccountSignerDetails,
  hash,
  type RpcProvider,
  type Signature,
  Signer,
} from "starknet";
import {
  ARGENT_MULTISIG_CONTRACT,
  type ArgentMultisigConfig,
  normalizeArgentMultisigConfig,
  serializeAccountSignature,
  serializeArgentMultisigDeploySignature,
  serializeArgentMultisigSignature,
} from "../accounts/account-contracts";

/**
 * Function that signs one Stark transaction hash through the vault service.
 */
export type StarkHashSigner = (messageHash: string) => Promise<StarkSignature>;

/**
 * Hash signer for either one account signer or a collected multisig aggregate.
 */
export type AccountHashSigner = (
  messageHash: string,
) => Promise<StarkSignature | readonly StarkSignature[]>;

/**
 * Signer metadata required for an Argent multisig adapter.
 */
export type AccountSignerOptions = {
  readonly multisig?: ArgentMultisigConfig;
};

/**
 * Minimal public Argent multisig account metadata accepted by platform APIs.
 */
export type ArgentMultisigAccountDescriptor = {
  readonly accountContractType: "argent-multisig";
  readonly address: string;
  readonly classHash: string;
  readonly networkId: AccountRef["networkId"];
};

/**
 * Account metadata sufficient to construct a Starknet account adapter.
 */
export type StarknetAccountDescriptor = AccountRef | ArgentMultisigAccountDescriptor;

type ContractKind = StarknetAccountDescriptor["accountContractType"];

const exactlyOneSignature = (value: StarkSignature | readonly StarkSignature[]): StarkSignature => {
  if (Array.isArray(value)) {
    if (value.length !== 1 || !value[0]) {
      throw new WalletError("Account deployment requires exactly one signature");
    }
    return value[0];
  }
  return value as StarkSignature;
};

class FixedContractStarknetSigner extends Signer {
  // Chain id of the deploy transaction being signed, stashed by
  // signDeployAccountTransaction so the Braavos deploy signature can bind its
  // out-of-band parameters to the right chain.
  private deployChainId: string | null = null;

  public constructor(
    protected readonly signerPublicKey: string,
    protected readonly contractKind: ContractKind,
    protected readonly starkSignHash: AccountHashSigner,
    protected readonly multisig: ArgentMultisigConfig | null,
    private readonly deployment: boolean,
  ) {
    super("0x1");
  }

  public override async getPubKey(): Promise<string> {
    return this.signerPublicKey;
  }

  public override signDeployAccountTransaction(
    details: DeployAccountSignerDetails,
  ): Promise<Signature> {
    this.deployChainId = String(details.chainId);
    return super.signDeployAccountTransaction(details);
  }

  // Braavos deploys a base-style class that parses its own transaction
  // signature: [r, s] over the deploy hash, the AdditionalDeploymentParams
  // (implementation to install, no extra signer, no limits, the chain id),
  // and a second stark pair over poseidon(params), all by the same key. The
  // layout is pinned by braavos-account-cairo and proven by the vendor
  // dataset's mainnet deployments.
  private async braavosDeploySignature(transactionHash: string): Promise<Signature> {
    if (this.deployChainId === null) {
      throw new WalletError("Braavos deployment chain id unavailable");
    }
    const params = [
      BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
      "0x0", // additional signer type: none
      "0x0",
      "0x0",
      "0x0",
      "0x0", // secp256r1 public key as two u256 limbs each
      "0x0", // multisig threshold
      "0x0", // withdrawal limit
      "0x0", // fee rate
      "0x0", // stark fee rate
      this.deployChainId,
    ];
    // The parameters are signed before the transaction hash on purpose: the
    // submission safety check treats the key's last signed hash as the one
    // broadcastable transaction, and only the deploy hash is broadcastable.
    const auxHash = hash.computePoseidonHashOnElements(params);
    const aux = exactlyOneSignature(await this.starkSignHash(auxHash));
    const transaction = exactlyOneSignature(await this.starkSignHash(transactionHash));
    for (const signature of [aux, transaction]) {
      if (!sameFelt(signature.publicKey, this.signerPublicKey)) {
        throw new WalletError("Signature public key does not match the account");
      }
    }
    return [transaction.r, transaction.s, ...params, aux.r, aux.s];
  }

  protected override async signRaw(messageHash: string): Promise<Signature> {
    const hash = messageHash.startsWith("0x")
      ? messageHash
      : `0x${BigInt(messageHash).toString(16)}`;
    if (!isStarkFieldElement(hash)) {
      throw new WalletError("Invalid transaction hash");
    }
    if (this.deployment && this.contractKind === "braavos") {
      return this.braavosDeploySignature(hash);
    }
    const signed = await this.starkSignHash(hash);
    if (this.contractKind === "argent-multisig") {
      if (!this.multisig) {
        throw new WalletError("Argent multisig signer configuration is unavailable");
      }
      if (this.deployment) {
        return [
          ...serializeArgentMultisigDeploySignature(exactlyOneSignature(signed), this.multisig),
        ];
      }
      return [
        ...serializeArgentMultisigSignature(
          Array.isArray(signed) ? signed : [signed as StarkSignature],
          this.multisig,
        ),
      ];
    }
    const signature = exactlyOneSignature(signed);
    if (!sameFelt(signature.publicKey, this.signerPublicKey)) {
      throw new WalletError("Signature public key does not match the account");
    }
    // The account's own family, never a stand-in: naming OpenZeppelin here once
    // meant any other family was signed as if it were one.
    return [...serializeAccountSignature(this.contractKind, signature)];
  }
}

class ContractStarknetSigner extends FixedContractStarknetSigner {
  public constructor(
    signerPublicKey: string,
    contractKind: ContractKind,
    starkSignHash: AccountHashSigner,
    multisig: ArgentMultisigConfig | null,
    private readonly deployStarkSignHash: AccountHashSigner = starkSignHash,
  ) {
    super(signerPublicKey, contractKind, starkSignHash, multisig, false);
  }

  public override signDeployAccountTransaction(
    details: DeployAccountSignerDetails,
  ): Promise<Signature> {
    return new FixedContractStarknetSigner(
      this.signerPublicKey,
      this.contractKind,
      this.deployStarkSignHash,
      this.multisig,
      true,
    ).signDeployAccountTransaction(details);
  }
}

const signerInputs = (
  account: StarknetAccountDescriptor,
  options: AccountSignerOptions,
): {
  readonly kind: ContractKind;
  readonly multisig: ArgentMultisigConfig | null;
  readonly publicKey: string;
} => {
  if (account.accountContractType !== "argent-multisig") {
    // The stored class is the one the address was deployed with, which may be
    // any vendor release; what the account runs now, and so which encoding it
    // accepts, is checked against the chain before anything is submitted.
    if (
      account.accountContractType === "argent" &&
      accountClassEntry(account.classHash)?.family !== "argent"
    ) {
      throw new WalletError("Argent account class hash is not a release this wallet recognizes");
    }
    // A Braavos address derives from a deployment class, which is all the
    // stored class can be; the implementation it runs is checked live.
    if (
      account.accountContractType === "braavos" &&
      !deploymentClasses("braavos").some((entry) => sameFelt(entry.classHash, account.classHash))
    ) {
      throw new WalletError("Braavos account class hash is not a release this wallet recognizes");
    }
    return { kind: account.accountContractType, multisig: null, publicKey: account.publicKeyX };
  }
  if (!sameFelt(account.classHash, ARGENT_MULTISIG_CONTRACT.classHash)) {
    throw new WalletError("Argent multisig class hash does not match the pinned release");
  }
  const multisig = normalizeArgentMultisigConfig(
    options.multisig ?? { signerPublicKeys: [], threshold: 0 },
  );
  const publicKey = multisig.signerPublicKeys[0];
  if (!publicKey) {
    throw new WalletError("Argent multisig signer configuration is unavailable");
  }
  return { kind: "argent-multisig", multisig, publicKey };
};

/**
 * Builds a starknet.js account backed by the wallet hash-signing boundary.
 */
export const krustyAccount = (
  provider: RpcProvider,
  account: StarknetAccountDescriptor,
  signHash: AccountHashSigner,
  options: AccountSignerOptions = {},
): Account => {
  const inputs = signerInputs(account, options);
  return new Account({
    address: account.address,
    cairoVersion: "1",
    provider,
    signer: new ContractStarknetSigner(inputs.publicKey, inputs.kind, signHash, inputs.multisig),
  });
};

/**
 * Builds an Argent account with shape-correct dummy signatures for validated
 * query-version simulation. It never reads or signs with private material.
 */
export const argentQueryAccount = (
  provider: RpcProvider,
  account: StarknetAccountDescriptor,
  options: AccountSignerOptions = {},
): Account => {
  const inputs = signerInputs(account, options);
  if (inputs.kind === "openzeppelin") {
    throw new WalletError("Query signer is only available for Argent accounts");
  }
  const mockSign = async (): Promise<StarkSignature | readonly StarkSignature[]> => {
    const publicKeys = inputs.multisig
      ? inputs.multisig.signerPublicKeys.slice(0, inputs.multisig.threshold)
      : [inputs.publicKey];
    return publicKeys.map((publicKey) => ({ publicKey, r: "0x1", s: "0x1" }));
  };
  const mockDeploySign = async (): Promise<StarkSignature> => ({
    publicKey: inputs.publicKey,
    r: "0x1",
    s: "0x1",
  });
  return new Account({
    address: account.address,
    cairoVersion: "1",
    provider,
    signer: new ContractStarknetSigner(
      inputs.publicKey,
      inputs.kind,
      mockSign,
      inputs.multisig,
      mockDeploySign,
    ),
  });
};
