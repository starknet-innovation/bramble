/**
 * Deployment of new multisig contracts from the repo's pinned MultisigWallet
 * class (contracts/multisig, a thin preset around OpenZeppelin's audited
 * MultisigComponent v3.0.0). Deploys go through the public Universal Deployer
 * Contract as a plain invoke from the active account, so the existing signing
 * and verification path is reused unchanged. The class hashes below are
 * reproducible from the vendored build and enforced by check:multisig; when
 * the class is not declared on the active network, deployment fails closed
 * and the wallet offers an explicit user-paid declare of the bundled class.
 */

import type { Call, RpcProvider } from "starknet";
import { CallData, constants, hash } from "starknet";
import { WalletError } from "../shared/errors";
import { isRecord } from "../shared/json";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "./networks";
import { withRpcFallback } from "./provider";

/**
 * Class hash of contracts/multisig `MultisigWallet`, computed from the
 * scarb-built Sierra artifact. Reproduce with `bun run vendor:multisig` and
 * verify with `bun run check:multisig`.
 */
export const MULTISIG_CLASS_HASH =
  "0xbb216b0643679b992e7953b6ea6f5057804237053e79fdd064cf2b5adea035";

/**
 * Compiled (CASM) class hash matching {@link MULTISIG_CLASS_HASH}, required
 * by DECLARE v3. Pinned at vendor time so the runtime never compiles Cairo.
 */
export const MULTISIG_COMPILED_CLASS_HASH =
  "0x42d945a7f59ead19b20435fbea7d168449299b03d71f8da205517166a2c80c8";

/**
 * Packaged path of the bundled Sierra contract class used for the explicit
 * declare flow. Copied into dist by build-extension.ts.
 */
export const MULTISIG_CLASS_ARTIFACT = "vendor/multisig/multisig.contract_class.json";

const MAX_DEPLOY_SIGNERS = 32;

/**
 * Constructor configuration for a new multisig: initial signer set and
 * quorum, plus the deployment salt that individualizes the address.
 */
export type MultisigDeployConfig = {
  readonly quorum: number;
  readonly salt: string;
  readonly signers: readonly string[];
};

/**
 * Inputs for checking whether the pinned multisig class is declared.
 */
export type MultisigClassStatusInput = {
  readonly makeProvider?: ((nodeUrl: string) => RpcProvider) | undefined;
  readonly rpcUrls: readonly string[];
};

const requireConfig = (config: MultisigDeployConfig): MultisigDeployConfig => {
  const unique = new Set(config.signers.map((signer) => BigInt(signer).toString(16)));
  if (
    config.signers.length === 0 ||
    config.signers.length > MAX_DEPLOY_SIGNERS ||
    unique.size !== config.signers.length ||
    !config.signers.every((signer) => isNonZeroStarkFieldElement(signer))
  ) {
    throw new WalletError("Invalid multisig signer list");
  }
  if (
    !Number.isSafeInteger(config.quorum) ||
    config.quorum < 1 ||
    config.quorum > config.signers.length
  ) {
    throw new WalletError("Quorum must be between 1 and the number of signers");
  }
  if (!isStarkFieldElement(config.salt)) {
    throw new WalletError("Invalid multisig salt");
  }
  return config;
};

// constructor(quorum: u32, signers: Span<ContractAddress>)
const constructorCalldata = (config: MultisigDeployConfig): string[] =>
  CallData.compile([config.quorum, [...config.signers]]);

/**
 * Predicts the deployed multisig address for a config. The UDC is invoked
 * with `not_from_zero = 0`, so the address depends only on class hash, salt,
 * and constructor calldata — never on which account submits the deploy.
 */
export const predictMultisigAddress = (config: MultisigDeployConfig): string =>
  hash.calculateContractAddressFromHash(
    requireConfig(config).salt,
    MULTISIG_CLASS_HASH,
    constructorCalldata(config),
    0,
  );

/**
 * Builds the UDC `deploy_contract` invoke that instantiates the pinned
 * multisig class with the given signers and quorum.
 */
export const buildMultisigDeployCall = (config: MultisigDeployConfig): Call => ({
  calldata: CallData.compile([
    MULTISIG_CLASS_HASH,
    requireConfig(config).salt,
    0,
    constructorCalldata(config),
  ]),
  contractAddress: constants.UDC.ADDRESS,
  entrypoint: constants.UDC.ENTRYPOINT,
});

const isClassNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/class hash not found/i.test(error.message)) {
    return true;
  }
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError.code === 28;
};

const requirePinnedCompiledClass = (casm: unknown): void => {
  let computed: string;
  try {
    computed = hash.computeCompiledClassHash(
      casm as Parameters<typeof hash.computeCompiledClassHash>[0],
    );
  } catch {
    throw new WalletError("Declared multisig class is malformed");
  }
  if (BigInt(computed) !== BigInt(MULTISIG_COMPILED_CLASS_HASH)) {
    throw new WalletError("Declared multisig class does not match the pinned compiled class hash");
  }
};

/**
 * Reads whether the pinned multisig class is declared on the network behind
 * the given endpoints. Both the Sierra and compiled class hashes must match
 * the pins. Transport failures propagate; only the node's class-hash-not-found
 * answer maps to `false`.
 */
export const isMultisigClassDeclared = async ({
  makeProvider,
  rpcUrls,
}: MultisigClassStatusInput): Promise<boolean> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      try {
        await provider.getClassByHash(MULTISIG_CLASS_HASH);
        requirePinnedCompiledClass(await provider.getCompiledCasm(MULTISIG_CLASS_HASH));
        return true;
      } catch (error) {
        if (isClassNotFoundError(error)) {
          return false;
        }
        throw error;
      }
    },
    makeProvider,
  );

/**
 * Validates the bundled Sierra artifact before it is declared: it must be a
 * contract-class object whose recomputed class hash matches the pin, so a
 * corrupted or swapped bundle can never be declared under this wallet's name.
 */
export const requireMultisigContractClass = (artifact: unknown): unknown => {
  if (!isRecord(artifact) || !Array.isArray(artifact.sierra_program)) {
    throw new WalletError("Bundled multisig class is malformed");
  }
  const computed = hash.computeContractClassHash(
    artifact as Parameters<typeof hash.computeContractClassHash>[0],
  );
  if (BigInt(computed) !== BigInt(MULTISIG_CLASS_HASH)) {
    throw new WalletError("Bundled multisig class does not match the pinned class hash");
  }
  return artifact;
};
