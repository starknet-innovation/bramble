/**
 * SNIP-12 signing for a connected Argent multisig. A threshold of 1 with a
 * local signer returns the aggregate the account's is_valid_signature accepts.
 * A higher threshold cannot be completed in one wallet, so the request is
 * refused before a card is queued.
 */

import type { ArgentMultisigConfig } from "@bramble/multisig/chain";
import type { ArgentMultisigRecord, MultisigStore } from "@bramble/multisig/repository";
import {
  ARGENT_MULTISIG_CONTRACT,
  serializeArgentMultisigSignature,
} from "@bramble/starknet/account-contracts";
import { typedDataHashForChain } from "@bramble/starknet/typed-data";
import type { RelaySignatureLog } from "@bramble/transactions/relay-signatures";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { DappMultisigAccount } from "@bramble/wallet-protocol/results";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { AccountHashSignerDeps } from "../ledger/account-hash-signer";
import { accountHashSigner } from "../ledger/account-hash-signer";
import { matchesArgentPublicConfig } from "../multisig/multisig-config-reconcile";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { recordRelaySignature } from "../transactions/relay-record";
import {
  type GrantedDappAccount,
  isGrantedMultisig,
  multisigMemberAccount,
  multisigRecordById,
} from "./dapp-account";

const MULTISIG_SIGNER_MISSING = "This wallet doesn't hold a signer for this multisig.";
const MULTISIG_THRESHOLD = "This multisig needs more than one signer.";
const MULTISIG_SIGNERS_UNAVAILABLE = "This multisig's signers aren't available yet.";
/** Refusal when the live class is not the pinned Argent multisig. */
export const MULTISIG_CLASS = "This multisig isn't the pinned account.";
const MULTISIG_CHANGED = "This multisig changed since this request was reviewed.";

type SignRpc = Pick<RuntimeRpc, "getClassHashAt"> & {
  readonly multisig?: Pick<NonNullable<RuntimeRpc["multisig"]>, "getConfig">;
};

/**
 * Refuses a signature when the live signer set no longer matches the watched
 * record. A missing read fails closed: a stale config must not be signed.
 */
const freshSignerConfig = async (
  rpc: SignRpc,
  address: string,
  stored: NonNullable<ArgentMultisigRecord["currentConfig"]>,
  rpcUrls: readonly string[],
): Promise<{ readonly error: string } | null> => {
  const read = rpc.multisig?.getConfig;
  if (!read) return { error: MULTISIG_SIGNERS_UNAVAILABLE };
  let chain: ArgentMultisigConfig;
  try {
    chain = await read({ address, rpcUrls });
  } catch {
    return { error: MULTISIG_SIGNERS_UNAVAILABLE };
  }
  return matchesArgentPublicConfig(stored, chain) ? null : { error: MULTISIG_CHANGED };
};

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
  origin: string,
): Promise<RuntimeResponse | null> => {
  if (!isGrantedMultisig(account)) return null;
  return (
    (await executeMultisigTypedData(deps, account, typedData, credential, rpcUrls, origin)) ?? {
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
    /** Signed OutsideExecution messages, recorded for Activity. */
    readonly relaySignatures?: Pick<RelaySignatureLog, "record">;
    readonly runtimeRpc?: SignRpc;
    readonly wallet: Pick<WalletStatusReader, "readVault">;
  },
  account: GrantedDappAccount,
  typedData: unknown,
  credential: string,
  rpcUrls: readonly string[],
  origin: string,
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
  // A relay authorization is listed in Activity as signed. Recording can
  // neither fail nor delay the signature the contract already accepted.
  void recordRelaySignature(deps.relaySignatures, {
    account,
    messageHash: signed.messageHash,
    origin,
    typedData,
  });
  return { ok: true, signature: [...signed.felts] };
};

/**
 * Signs typed data as a one-signer multisig aggregate. The live class must
 * still be the pinned Argent multisig, and the live signer set must still
 * match the watched record.
 */
const signGrantedMultisig = async (
  deps: AccountHashSignerDeps & { readonly runtimeRpc: SignRpc },
  account: DappMultisigAccount,
  record: ArgentMultisigRecord,
  typedData: unknown,
  credential: string,
  accounts: readonly AccountRef[],
  rpcUrls: readonly string[],
): Promise<
  { readonly error: string } | { readonly felts: readonly string[]; readonly messageHash: string }
> => {
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
  const changed = await freshSignerConfig(deps.runtimeRpc, account.address, config, rpcUrls);
  if (changed) return changed;
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
  return { felts: serializeArgentMultisigSignature([signed], config), messageHash };
};
