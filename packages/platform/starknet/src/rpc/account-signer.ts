/** Contract-aware starknet.js signer adapters for wallet account families. */

import { WalletError } from "@mc-wallet/core/errors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { isStarkFieldElement, sameFelt } from "@mc-wallet/wallet-model/networks";
import {
  type AccountSignature,
  requireStarkSignature,
  type StarkSignature,
} from "@mc-wallet/wallet-model/signing";
import {
  Account,
  type DeployAccountSignerDetails,
  type RpcProvider,
  type Signature,
  Signer,
} from "starknet";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
  type ArgentMultisigConfig,
  normalizeArgentMultisigConfig,
  serializeAccountSignature,
  serializeArgentAccountSignature,
  serializeArgentMultisigDeploySignature,
  serializeArgentMultisigSignature,
} from "../accounts/account-contracts";

/**
 * Function that signs one transaction hash through the vault service, a hardware
 * device, or a paired signer. The result is scheme-tagged: a consumer that can
 * only serialize `(r, s)` must narrow with `requireStarkSignature` and fail
 * closed on anything else.
 */
export type StarkHashSigner = (messageHash: string) => Promise<AccountSignature>;

/**
 * Hash signer for either one account signer or a collected multisig aggregate.
 * The aggregate stays Stark-only — Argent multisig validates `(r, s)` members.
 */
export type AccountHashSigner = (
  messageHash: string,
) => Promise<AccountSignature | readonly StarkSignature[]>;

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

const exactlyOneSignature = (
  value: AccountSignature | readonly StarkSignature[],
): StarkSignature => {
  if (Array.isArray(value)) {
    if (value.length !== 1 || !value[0]) {
      throw new WalletError("Account deployment requires exactly one signature");
    }
    return value[0];
  }
  return requireStarkSignature(value as AccountSignature);
};

class FixedContractStarknetSigner extends Signer {
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

  protected override async signRaw(messageHash: string): Promise<Signature> {
    const hash = messageHash.startsWith("0x")
      ? messageHash
      : `0x${BigInt(messageHash).toString(16)}`;
    if (!isStarkFieldElement(hash)) {
      throw new WalletError("Invalid transaction hash");
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
          Array.isArray(signed) ? signed : [requireStarkSignature(signed as AccountSignature)],
          this.multisig,
        ),
      ];
    }
    const signature = exactlyOneSignature(signed);
    if (!sameFelt(signature.publicKey, this.signerPublicKey)) {
      throw new WalletError("Signature public key does not match the account");
    }
    return this.contractKind === "argent"
      ? [...serializeArgentAccountSignature(signature)]
      : [...serializeAccountSignature("openzeppelin", signature)];
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
    if (
      account.accountContractType === "argent" &&
      !sameFelt(account.classHash, ARGENT_ACCOUNT_CONTRACT.classHash)
    ) {
      throw new WalletError("Argent account class hash does not match the pinned release");
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
  const mockSign = async (): Promise<AccountSignature | readonly StarkSignature[]> => {
    const publicKeys = inputs.multisig
      ? inputs.multisig.signerPublicKeys.slice(0, inputs.multisig.threshold)
      : [inputs.publicKey];
    return publicKeys.map((publicKey) => ({ publicKey, r: "0x1", s: "0x1" }));
  };
  const mockDeploySign = async (): Promise<AccountSignature> => ({
    kind: "stark",
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
