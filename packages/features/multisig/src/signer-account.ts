/** Read-only signer-key discovery for supported single-signer accounts. */
import { WalletError } from "@mc-wallet/core/errors";
import { ARGENT_ACCOUNT_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import {
  createRpcProvider,
  isContractNotFoundError,
  withRpcFallback,
} from "@mc-wallet/starknet/provider";
import {
  type AccountContractType,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { withPinnedBlock } from "./chain-pinned-read";

/**
 * Public signer metadata returned only after an untrusted account address is
 * matched to a pinned account class and its key response is validated.
 */
export type MultisigSignerAccount = {
  readonly accountContractType: AccountContractType;
  readonly address: string;
  readonly publicKeyX: string;
};

/**
 * Untrusted address and endpoint inputs used for fail-closed signer discovery.
 */
export type MultisigSignerAccountInput = {
  readonly address: string;
  readonly makeProvider?: ((nodeUrl: string) => RpcProvider) | undefined;
  readonly rpcUrls: readonly string[];
};

const requireFelt = (value: unknown, label: string): string => {
  const canonical = typeof value === "string" ? canonicalFelt(value) : null;
  if (canonical === null || !isNonZeroStarkFieldElement(canonical)) {
    throw new WalletError(`Invalid ${label}`);
  }
  return canonical;
};

const oneFelt = (response: readonly string[], label: string): string => {
  if (response.length !== 1) throw new WalletError(`Invalid ${label} response`);
  return requireFelt(response[0], label);
};

const argentOwnerAt = async (
  provider: RpcProvider,
  account: string,
  blockHash: string,
): Promise<string> => {
  const [owner, ownerType] = await Promise.all([
    provider.callContract(
      { calldata: [], contractAddress: account, entrypoint: "get_owner" },
      blockHash,
    ),
    provider.callContract(
      { calldata: [], contractAddress: account, entrypoint: "get_owner_type" },
      blockHash,
    ),
  ]);
  if (ownerType.length !== 1 || !sameFelt(ownerType[0] ?? "", "0x0")) {
    throw new WalletError(
      "This Argent account does not use a Stark public-key owner. Ask the participant to share a supported public key.",
    );
  }
  return oneFelt(owner, "Argent signer public key");
};

/**
 * Whether a wallet account can be enrolled as an Argent multisig member. Argent
 * validates `(r, s)` per member, so an account whose contract validates another
 * scheme can never satisfy it — offering one would let the user build a multisig
 * with a threshold it can never reach. Lives here rather than in each picker so a
 * new contract family cannot be offered by one list and refused by another.
 */
export const canSignArgentMultisig = (account: {
  readonly accountContractType: AccountContractType;
}): boolean => account.accountContractType !== "ml-dsa";

/**
 * Resolves the public Stark signer of a pinned OpenZeppelin or Argent account.
 * Unknown, undeployed, non-Stark, and malformed accounts fail closed; an
 * account address is never treated as signing authority by itself.
 */
export const getMultisigSignerAccount = async ({
  address,
  makeProvider,
  rpcUrls,
}: MultisigSignerAccountInput): Promise<MultisigSignerAccount> => {
  const account = requireFelt(address, "signer account address");
  try {
    return await withRpcFallback(
      rpcUrls,
      async (provider) =>
        withPinnedBlock(provider, async ({ blockHash }) => {
          const classHash = await provider.getClassHashAt(account, blockHash);
          if (typeof classHash !== "string" || !isStarkFieldElement(classHash)) {
            throw new WalletError("Invalid signer account class response");
          }
          if (sameFelt(classHash, OPENZEPPELIN_ACCOUNT_CLASS_HASH)) {
            return {
              accountContractType: "openzeppelin",
              address: account,
              publicKeyX: oneFelt(
                await provider.callContract(
                  { calldata: [], contractAddress: account, entrypoint: "get_public_key" },
                  blockHash,
                ),
                "OpenZeppelin signer public key",
              ),
            };
          }
          if (sameFelt(classHash, ARGENT_ACCOUNT_CONTRACT.classHash)) {
            return {
              accountContractType: "argent",
              address: account,
              publicKeyX: await argentOwnerAt(provider, account, blockHash),
            };
          }
          throw new WalletError(
            "This account type cannot provide a signer key automatically. Ask the participant to copy their public key from Receive.",
          );
        }),
      makeProvider ?? createRpcProvider,
    );
  } catch (error) {
    if (isContractNotFoundError(error)) {
      throw new WalletError(
        "This account is not deployed yet. Ask the participant to copy their public key from Receive.",
      );
    }
    throw error;
  }
};
