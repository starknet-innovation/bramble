/** Valid Argent multisig presentation fixtures built through the platform hash boundary. */

import type { ArgentMultisigCall } from "@mc-wallet/multisig/chain";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@mc-wallet/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import { prepareArgentMultisigInvokeV3 } from "@mc-wallet/starknet/multisig-invoke";
import { account } from "@mc-wallet/testkit/sidepanel";
import { ec, RpcProvider } from "starknet";
import type {
  ArgentMultisigDeploymentReview,
  ArgentMultisigIntentPackage,
  ArgentMultisigView,
} from "../../src/popup/responses/multisig-responses";
import type { WalletStatus } from "../../src/popup/responses/responses";

const ADDRESS = "0x123";
const ACCOUNT_ID = `SN_MAIN:${ADDRESS}`;
const PRIVATE_KEY = "0x456";
const PUBLIC_KEY = `0x${ec.starkCurve.getStarkKey(PRIVATE_KEY).replace(/^0x/, "")}`;
const signerAccount = { ...account, publicKeyX: PUBLIC_KEY };

const provider = new RpcProvider({ nodeUrl: "http://127.0.0.1:5050/rpc" });
provider.getChainId = async () => "0x534e5f4d41494e";
provider.getNonceForAddress = async () => "0x7";
provider.getEstimateFeeBulk = (async () => [
  {
    data_gas_consumed: 0n,
    data_gas_price: 0n,
    gas_consumed: 0n,
    gas_price: 0n,
    overall_fee: 44n,
    resourceBounds: {
      l1_data_gas: { max_amount: 1n, max_price_per_unit: 2n },
      l1_gas: { max_amount: 3n, max_price_per_unit: 4n },
      l2_gas: { max_amount: 5n, max_price_per_unit: 6n },
    },
    unit: "FRI" as const,
  },
]) as RpcProvider["getEstimateFeeBulk"];

/** Complete valid fixture used at untrusted response, model, runtime, and view boundaries. */
export const makeArgentMultisigFixture = async (
  calls: readonly ArgentMultisigCall[] = [
    { calldata: ["0x1"], contractAddress: "0xdef", entrypoint: "transfer" },
  ],
): Promise<{
  readonly deploymentReview: ArgentMultisigDeploymentReview;
  readonly intent: ArgentMultisigSigningIntent;
  readonly intentPackage: ArgentMultisigIntentPackage;
  readonly readyIntent: ArgentMultisigSigningIntent;
  readonly record: ArgentMultisigRecord;
  readonly status: WalletStatus;
  readonly view: ArgentMultisigView;
}> => {
  const signerGuids = [argentSignerGuid(signerAccount.publicKeyX)];
  const record: ArgentMultisigRecord = {
    accountContractType: "argent-multisig",
    address: ADDRESS,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    currentConfig: { signerPublicKeys: [signerAccount.publicKeyX], threshold: 1 },
    id: ACCOUNT_ID,
    name: "Treasury",
    networkId: "SN_MAIN",
  };
  const prepared = await prepareArgentMultisigInvokeV3(
    {
      account: record,
      calls,
      config: { signerPublicKeys: [signerAccount.publicKeyX], threshold: 1 },
      rpcUrls: ["http://127.0.0.1:5050/rpc"],
    },
    () => provider,
  );
  const intent: ArgentMultisigSigningIntent = {
    accountId: record.id,
    configSnapshot: {
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      signerGuids,
      threshold: 1,
    },
    id: `${record.id}:${prepared.transactionHash}`,
    prepared,
    signatures: [],
    state: "collecting",
    summary: "Send funds",
  };
  const view: ArgentMultisigView = {
    config: {
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      signerGuids,
      threshold: 1,
    },
    record,
  };
  const signature = ec.starkCurve.sign(prepared.transactionHash, PRIVATE_KEY);
  const readyIntent: ArgentMultisigSigningIntent = {
    ...intent,
    signatures: [
      {
        publicKey: PUBLIC_KEY,
        r: `0x${signature.r.toString(16)}`,
        s: `0x${signature.s.toString(16)}`,
      },
    ],
    state: "ready",
  };
  return {
    deploymentReview: {
      address: record.address,
      fee: { overallFee: "44", unit: "FRI" },
      name: "Treasury",
      networkId: record.networkId,
      salt: "0x0",
      signerAccountId: signerAccount.id,
      signerPublicKeys: [signerAccount.publicKeyX],
      threshold: 1,
    },
    intent,
    intentPackage: {
      intent,
      kind: "mc-wallet.argent-multisig-intent",
      version: 1,
    },
    readyIntent,
    record,
    status: {
      accountCount: 1,
      accounts: [signerAccount],
      activeAccountId: signerAccount.id,
      hasVault: true,
      locked: false,
      network: "Starknet Mainnet",
      networkId: "SN_MAIN",
      networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
      ready: true,
    },
    view,
  };
};
