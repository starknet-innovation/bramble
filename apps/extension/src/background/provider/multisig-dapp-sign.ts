/**
 * SNIP-12 signing for a connected Argent multisig. A threshold of 1 with a
 * local signer returns the aggregate the account's is_valid_signature accepts.
 * A higher threshold cannot be completed in one wallet, so the request is
 * refused before a card is queued.
 */

import type { ArgentMultisigRecord, MultisigStore } from "@bramble/multisig/repository";
import {
  ARGENT_MULTISIG_CONTRACT,
  serializeArgentMultisigSignature,
} from "@bramble/starknet/account-contracts";
import { typedDataHashForChain } from "@bramble/starknet/typed-data";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { DappMultisigAccount } from "@bramble/wallet-protocol/results";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { AccountHashSignerDeps } from "../ledger/account-hash-signer";
import { accountHashSigner } from "../ledger/account-hash-signer";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import {
  type GrantedDappAccount,
  isGrantedMultisig,
  multisigMemberAccount,
  multisigRecordById,
} from "./dapp-account";

const MULTISIG_SIGNER_MISSING = "This wallet doesn't hold a signer for this multisig.";
const MULTISIG_THRESHOLD = "This multisig needs more than one signer.";
const MULTISIG_SIGNERS_UNAVAILABLE = "This multisig's signers aren't available yet.";
const MULTISIG_CLASS = "This multisig isn't the pinned account.";

/**
 * Refuses a sign request that this wallet cannot finish. Null means a
 * threshold of 1 and a local signer, so a review card may be queued.
 */
const refuseUnsignedMultisig = (
  record: ArgentMultisigRecord | null,
  accounts: readonly AccountRef[],
): RuntimeResponse | null => {
  const config = record?.currentConfig;
  if (!record || !config) return { error: MULTISIG_SIGNERS_UNAVAILABLE };
  if (config.threshold !== 1) return { error: MULTISIG_THRESHOLD };
  return multisigMemberAccount(accounts, config.signerPublicKeys, record.networkId)
    ? null
    : { error: MULTISIG_SIGNER_MISSING };
};

/**
 * Refuses a queued sign when the connected account is a multisig this wallet
 * cannot finish. Null means the caller should continue, including for a
 * single-signer account.
 */
export const queuedMultisigSignBlock = async (
  deps: {
    readonly multisigStore?: Pick<MultisigStore, "listMultisigs">;
    readonly wallet: Pick<WalletStatusReader, "readVault">;
  },
  account: GrantedDappAccount,
  credential: string,
): Promise<RuntimeResponse | null> => {
  if (!isGrantedMultisig(account)) return null;
  const vault = await deps.wallet.readVault(credential);
  const record = deps.multisigStore
    ? await multisigRecordById(deps.multisigStore, account.id)
    : null;
  return refuseUnsignedMultisig(record, vault.accounts);
};

/**
 * Signs a multisig account. Null when `account` is a single signer.
 * A multisig this wallet cannot finish is an error, not null.
 */
export const signMultisigIfGranted = async (
  deps: Parameters<typeof executeMultisigTypedData>[0],
  account: GrantedDappAccount,
  typedData: unknown,
  credential: string,
  rpcUrls: readonly string[],
): Promise<RuntimeResponse | null> => {
  if (!isGrantedMultisig(account)) return null;
  return (
    (await executeMultisigTypedData(deps, account, typedData, credential, rpcUrls)) ?? {
      error: "Argent multisig not found",
    }
  );
};

/**
 * Signs when the connected account is a multisig. Null means it is not.
 */
export const executeMultisigTypedData = async (
  deps: AccountHashSignerDeps & {
    readonly multisigStore?: Pick<MultisigStore, "listMultisigs">;
    readonly runtimeRpc?: Pick<RuntimeRpc, "getClassHashAt">;
    readonly wallet: Pick<WalletStatusReader, "readVault">;
  },
  account: GrantedDappAccount,
  typedData: unknown,
  credential: string,
  rpcUrls: readonly string[],
): Promise<RuntimeResponse | null> => {
  if (!isGrantedMultisig(account)) return null;
  const vault = await deps.wallet.readVault(credential);
  const record = deps.multisigStore
    ? await multisigRecordById(deps.multisigStore, account.id)
    : null;
  if (!record) return { error: "Argent multisig not found" };
  const signed = await signGrantedMultisig(
    { ...deps, runtimeRpc: deps.runtimeRpc ?? {} },
    account,
    record,
    typedData,
    credential,
    vault.accounts,
    rpcUrls,
  );
  if ("error" in signed) return signed;
  return { ok: true, signature: [...signed.felts] };
};

/**
 * Signs typed data as a one-signer multisig aggregate. The live class must
 * still be the pinned Argent multisig.
 */
const signGrantedMultisig = async (
  deps: AccountHashSignerDeps & { readonly runtimeRpc: Pick<RuntimeRpc, "getClassHashAt"> },
  account: DappMultisigAccount,
  record: ArgentMultisigRecord,
  typedData: unknown,
  credential: string,
  accounts: readonly AccountRef[],
  rpcUrls: readonly string[],
): Promise<{ readonly error: string } | { readonly felts: readonly string[] }> => {
  const blocked = refuseUnsignedMultisig(record, accounts);
  if (blocked && "error" in blocked) return blocked;
  const config = record.currentConfig;
  const member =
    config && multisigMemberAccount(accounts, config.signerPublicKeys, record.networkId);
  if (!config || !member) return { error: MULTISIG_SIGNER_MISSING };
  const live = await deps.runtimeRpc.getClassHashAt?.({ address: account.address, rpcUrls });
  if (!live || !sameFelt(live, ARGENT_MULTISIG_CONTRACT.classHash)) {
    return { error: MULTISIG_CLASS };
  }
  let messageHash: string;
  try {
    messageHash = typedDataHashForChain(
      typedData,
      account.address,
      STARKNET_NETWORKS[account.networkId].chainId,
    );
  } catch {
    return { error: "invalid typed data" };
  }
  const signed = await accountHashSigner(deps, member, credential)(messageHash);
  return { felts: serializeArgentMultisigSignature([signed], config) };
};
