/** Contract-aware starknet.js signer adapters for wallet account families. */

import { WalletError } from "@mc-wallet/core/errors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { isStarkFieldElement, sameFelt } from "@mc-wallet/wallet-model/networks";
import {
  type AccountSignature,
  type MlDsa65Signature,
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
  estimateMode,
  normalizeArgentMultisigConfig,
  serializeAccountSignature,
  serializeArgentAccountSignature,
  serializeArgentMultisigDeploySignature,
  serializeArgentMultisigSignature,
  usesValidatedQueryEstimate,
} from "../accounts/account-contracts";

/**
 * Function that signs one transaction hash through the vault service, a hardware
 * device, or a paired signer. The result is scheme-tagged: a consumer that can
 * only serialize `(r, s)` must narrow with `requireStarkSignature` and fail
 * closed on anything else.
 */
export type AccountHashSigner = (messageHash: string) => Promise<AccountSignature>;

/**
 * Hash signer that may answer with a collected set of member signatures instead
 * of one, which only an Argent multisig does. Every {@link AccountHashSigner}
 * satisfies this — its return type is the narrower half — so a single-signer
 * path passes its signer straight in and the contract-aware adapter collapses
 * the set with `exactlyOneSignature` where exactly one is required. The
 * aggregate half stays Stark-only: Argent multisig validates `(r, s)` members.
 */
export type AggregateHashSigner = (
  messageHash: string,
) => Promise<AccountSignature | readonly StarkSignature[]>;

/**
 * The ML-DSA calldata builders this module needs, supplied rather than imported.
 *
 * Both are pure functions of public material, but they live in Krusty KMS behind
 * the WASM boundary, and this package may not depend on the adapter that loads
 * it. So they arrive the same way {@link AccountHashSigner} does — as functions
 * passed in by whoever composed the wallet. `KmsPort` satisfies this shape.
 */
export type MlDsaCalldata = {
  readonly mlDsaSignaturePayload: (
    publicKey: string,
    transactionHash: string,
    signature: string,
  ) => Promise<readonly string[]>;
  readonly mlDsaEstimationSignature: (publicKey: string) => Promise<readonly string[]>;
};

/**
 * Signer metadata required for an Argent multisig adapter.
 */
export type AccountSignerOptions = {
  readonly multisig?: ArgentMultisigConfig;
  readonly mlDsa?: MlDsaCalldata;
};

/**
 * Signer options carrying an ML-DSA port, or none when there is no port.
 *
 * A one-line helper because the alternative is an inline conditional at each of
 * the seven call sites: `exactOptionalPropertyTypes` forbids handing on
 * `mlDsa: undefined`, so an absent port has to be an absent key.
 */
export const mlDsaOptions = (mlDsa: MlDsaCalldata | undefined): AccountSignerOptions =>
  mlDsa ? { mlDsa } : {};

// An ML-DSA account cannot sign or be priced without these, and a missing
// wiring must not degrade into a Stark path that would produce calldata the
// contract rejects. So it aborts here rather than further down.
const requireMlDsaCalldata = (mlDsa: MlDsaCalldata | undefined): MlDsaCalldata => {
  if (!mlDsa) {
    throw new WalletError("ML-DSA calldata builders are unavailable");
  }
  return mlDsa;
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

// The paired-phone signer is the only producer of this scheme, and it returns a
// single signature rather than a member list. Anything else reaching here is a
// wiring mistake, so it aborts the submit rather than serializing something the
// account cannot validate.
const requireMlDsa65Signature = (
  value: AccountSignature | readonly StarkSignature[],
): MlDsa65Signature => {
  if (Array.isArray(value) || (value as AccountSignature).kind !== "ml-dsa-65") {
    throw new WalletError("ML-DSA account requires a post-quantum signature");
  }
  return value as MlDsa65Signature;
};

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
    protected readonly signHash: AggregateHashSigner,
    protected readonly multisig: ArgentMultisigConfig | null,
    private readonly deployment: boolean,
    protected readonly mlDsa?: MlDsaCalldata,
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
    const signed = await this.signHash(hash);
    if (this.contractKind === "ml-dsa") {
      // Not `serializeAccountSignature`: that seam takes a Stark `(r, s)`, and
      // this contract validates neither. Its calldata is the packed
      // verification key plus the felt-native signature and the hints the
      // on-chain check needs, all of which depend on the hash just signed.
      const { publicKey, signature } = requireMlDsa65Signature(signed);
      return [
        ...(await requireMlDsaCalldata(this.mlDsa).mlDsaSignaturePayload(
          publicKey,
          hash,
          signature,
        )),
      ];
    }
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
    signHash: AggregateHashSigner,
    multisig: ArgentMultisigConfig | null,
    private readonly deploySignHash: AggregateHashSigner = signHash,
    mlDsa?: MlDsaCalldata,
  ) {
    super(signerPublicKey, contractKind, signHash, multisig, false, mlDsa);
  }

  public override signDeployAccountTransaction(
    details: DeployAccountSignerDetails,
  ): Promise<Signature> {
    return new FixedContractStarknetSigner(
      this.signerPublicKey,
      this.contractKind,
      this.deploySignHash,
      this.multisig,
      true,
      this.mlDsa,
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
  signHash: AggregateHashSigner,
  options: AccountSignerOptions = {},
): Account => {
  const inputs = signerInputs(account, options);
  return new Account({
    address: account.address,
    cairoVersion: "1",
    provider,
    signer: new ContractStarknetSigner(
      inputs.publicKey,
      inputs.kind,
      signHash,
      inputs.multisig,
      signHash,
      options.mlDsa,
    ),
  });
};

// Emits a fixed signature array and never consults a signer. The ML-DSA
// estimation dummy is the same felts for every transaction of an account, so
// there is nothing per-hash to compute and nothing to prompt for.
class FixedCalldataSigner extends Signer {
  // A thunk rather than an array: building the calldata is now an async call
  // across the WASM boundary, and taking it lazily here is what keeps
  // `mlDsaQueryAccount` synchronous for its five call sites.
  public constructor(private readonly calldata: () => Promise<readonly string[]>) {
    super("0x1");
  }

  public override async getPubKey(): Promise<string> {
    return "0x0";
  }

  protected override async signRaw(): Promise<Signature> {
    return [...(await this.calldata())];
  }
}

/**
 * Builds an ML-DSA account whose signatures are the fee-estimation dummy, for
 * simulating a query-version transaction with validation enabled.
 *
 * The point is what it does *not* do: it never reaches the paired phone. The
 * account contract runs its full verifier under a query version and tolerates
 * the failing verdict, so this measures the true cost of validation — which for
 * this family is nearly the whole transaction — with no signing round trip. It
 * reads only the public key already on the record.
 */
export const mlDsaQueryAccount = (
  provider: RpcProvider,
  account: StarknetAccountDescriptor,
  options: AccountSignerOptions = {},
): Account => {
  if (account.accountContractType !== "ml-dsa") {
    throw new WalletError("ML-DSA query signer is only available for ML-DSA accounts");
  }
  const mlDsa = requireMlDsaCalldata(options.mlDsa);
  const publicKey = account.publicKey;
  return new Account({
    address: account.address,
    cairoVersion: "1",
    provider,
    signer: new FixedCalldataSigner(() => mlDsa.mlDsaEstimationSignature(publicKey)),
  });
};

/**
 * The account a fee estimate must be taken through, and whether that estimate
 * skips validation.
 *
 * One function for every estimate path — invoke, deploy, and the reviews that
 * price them — because a review taken a different way from the submission that
 * follows it is not a ceiling on anything.
 */
export const estimatingAccountFor = (
  provider: RpcProvider,
  account: StarknetAccountDescriptor,
  submittingAccount: Account,
  options: AccountSignerOptions = {},
): { readonly account: Account; readonly skipValidate: boolean } => {
  const mode = estimateMode(account.accountContractType);
  if (mode === "argent-query") {
    return { account: argentQueryAccount(provider, account, options), skipValidate: false };
  }
  if (mode === "ml-dsa-query") {
    return { account: mlDsaQueryAccount(provider, account, options), skipValidate: false };
  }
  return { account: submittingAccount, skipValidate: true };
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
  if (!usesValidatedQueryEstimate(inputs.kind)) {
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
