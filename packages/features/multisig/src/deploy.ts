/**
 * Counterfactual deployment metadata for the pinned Argent Multisig 0.2
 * account. Deployment itself remains a platform operation because it owns the
 * exact DEPLOY_ACCOUNT hash, fee bounds, signature encoding, and broadcast.
 */
import { WalletError } from "@mc-wallet/core/errors";
import { isRecord } from "@mc-wallet/core/json";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentMultisigAddress,
  argentMultisigConstructorCalldata,
  normalizeArgentMultisigConfig,
} from "@mc-wallet/starknet/account-contracts";
import type { AccountDeployment } from "@mc-wallet/starknet/deployment";
import { withRpcFallback } from "@mc-wallet/starknet/provider";
import { canonicalFelt, isStarkFieldElement, sameFelt } from "@mc-wallet/wallet-model/networks";
import { hash, type RpcProvider } from "starknet";

/**
 * Reviewed constructor inputs for a new Argent multisig account. Signer keys
 * are normalized into GUID order before address derivation.
 */
export type ArgentMultisigDeployConfig = {
  readonly salt: string;
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
};

/**
 * Inputs for checking whether the pinned stable class is declared.
 */
export type ArgentMultisigClassStatusInput = {
  readonly makeProvider?: ((nodeUrl: string) => RpcProvider) | undefined;
  readonly rpcUrls: readonly string[];
};

/**
 * Validates constructor bounds and returns the one deterministic GUID-sorted
 * configuration used for both review and address derivation.
 */
export const canonicalArgentMultisigDeployConfig = (
  config: ArgentMultisigDeployConfig,
): ArgentMultisigDeployConfig => {
  const normalized = normalizeArgentMultisigConfig({
    signerPublicKeys: config.signerPublicKeys,
    threshold: config.threshold,
  });
  const salt = canonicalFelt(config.salt);
  if (salt === null || !isStarkFieldElement(salt)) {
    throw new WalletError("Invalid Argent multisig salt");
  }
  return { salt, ...normalized };
};

/**
 * Predicts the stable Argent multisig account address from canonical reviewed
 * constructor inputs. No deployer address participates in account derivation.
 */
export const predictArgentMultisigAddress = (config: ArgentMultisigDeployConfig): string => {
  const checked = canonicalArgentMultisigDeployConfig(config);
  return argentMultisigAddress(
    { signerPublicKeys: checked.signerPublicKeys, threshold: checked.threshold },
    checked.salt,
  );
};

/**
 * Builds generic DEPLOY_ACCOUNT parameters for the platform submission lane.
 * The returned contract address is re-derived from exactly the same constructor.
 */
export const argentMultisigDeployment = (config: ArgentMultisigDeployConfig): AccountDeployment => {
  const checked = canonicalArgentMultisigDeployConfig(config);
  const constructorConfig = {
    signerPublicKeys: checked.signerPublicKeys,
    threshold: checked.threshold,
  };
  return {
    addressSalt: checked.salt,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    constructorCalldata: argentMultisigConstructorCalldata(constructorConfig),
    contractAddress: argentMultisigAddress(constructorConfig, checked.salt),
  };
};

const isClassNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/class hash not found/i.test(error.message)) {
    return true;
  }
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError["code"] === 28;
};

const requirePinnedCompiledClass = (casm: unknown): void => {
  let computed: string;
  try {
    computed = hash.computeCompiledClassHash(
      casm as Parameters<typeof hash.computeCompiledClassHash>[0],
    );
  } catch {
    throw new WalletError("Declared Argent multisig class is malformed");
  }
  if (!sameFelt(computed, ARGENT_MULTISIG_CONTRACT.compiledClassHash)) {
    throw new WalletError("Declared Argent multisig class does not match the stable pin");
  }
};

/**
 * Checks declaration of the exact stable Argent Multisig 0.2 Sierra/CASM pair.
 * Only a class-not-found RPC answer maps to false; all other failures propagate.
 */
export const isArgentMultisigClassDeclared = async ({
  makeProvider,
  rpcUrls,
}: ArgentMultisigClassStatusInput): Promise<boolean> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      try {
        await provider.getClassByHash(ARGENT_MULTISIG_CONTRACT.classHash);
        requirePinnedCompiledClass(
          await provider.getCompiledCasm(ARGENT_MULTISIG_CONTRACT.classHash),
        );
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
