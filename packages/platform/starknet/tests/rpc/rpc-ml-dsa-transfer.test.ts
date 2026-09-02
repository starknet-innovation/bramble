/**
 * A paired-phone account reaches the signer only if the ML-DSA calldata builders
 * travel with the submission. They are optional on every input that carries
 * them, so a wrapper that forgets to forward them still compiles and still
 * estimates — it aborts at the signer with "ML-DSA calldata builders are
 * unavailable", after the user has read and approved a fee.
 *
 * `submitErc20Transfer` forgot exactly that, which is why the public send was
 * the one path a paired phone could not use. These pin the forwarding at the
 * boundary where the omission was invisible.
 */

import { describe, expect, test } from "bun:test";
import { submitErc20Transfer } from "@mc-wallet/starknet/rpc";
import type { MobilePqAccountRef } from "@mc-wallet/wallet-model/accounts";
import type { TokenConfig } from "@mc-wallet/wallet-model/preferences";
import { logger, type RpcProvider } from "starknet";

// The V3 estimate's tip analysis warns about the empty fake block; the estimate
// still falls back to a zero tip, so silence it rather than fabricate a busy one.
logger.setLogLevel("FATAL");

const RPC_URLS = ["https://rpc.example"] as const;
const ADDRESS = "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const CLASS_HASH = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

// Public key and signature are opaque here: the builders that would parse them
// are the stubs under test, so nothing in this file reads their contents.
const account: MobilePqAccountRef = {
  accountContractType: "ml-dsa",
  address: ADDRESS,
  classHash: CLASS_HASH,
  derivation: { deviceId: "phone-1", kind: "mobile-pq", transport: { kind: "clipboard" } },
  id: `SN_MAIN:${ADDRESS}`,
  networkId: "SN_MAIN",
  publicKey: `0x${"ab".repeat(1952)}`,
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const eth: TokenConfig = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
  id: "SN_MAIN:ETH:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

const RECIPIENT = "0x0777000000000000000000000000000000000000000000000000000000000abc";

const feeEstimate = {
  data_gas_consumed: "0x1",
  data_gas_price: "0x1",
  gas_consumed: "0x1",
  gas_price: "0x1",
  l1_data_gas_consumed: "0x1",
  l1_data_gas_price: "0x1",
  l1_gas_consumed: "0x1",
  l1_gas_price: "0x1",
  l2_gas_consumed: "0x1",
  l2_gas_price: "0x1",
  overall_fee: "0x3e8",
  unit: "FRI",
};

const channelResponses: Readonly<Record<string, unknown>> = {
  getBlockWithTxs: { block_number: 100, timestamp: 1_700_000_000, transactions: [] },
  getChainId: "0x534e5f4d41494e",
  getEstimateFee: [feeEstimate],
  getNonceForAddress: "0x0",
  specVersion: "0.8.1",
};

const provider = (signedHash: () => string): RpcProvider => {
  const channel = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") {
          return undefined;
        }
        const method = String(property);
        return async () =>
          method === "invoke" ? { transaction_hash: signedHash() } : channelResponses[method];
      },
    },
  );
  return {
    channel,
    async getChainId() {
      return "0x534e5f4d41494e";
    },
    // ml-dsa is a pinned-class family, so the deployment check compares what the
    // node reports against the account's own class hash.
    async getClassHashAt() {
      return CLASS_HASH;
    },
    async waitForTransaction() {
      return { execution_status: "SUCCEEDED" };
    },
  } as unknown as RpcProvider;
};

describe("submitErc20Transfer for a paired-phone account", () => {
  test("forwards the ML-DSA calldata builders to the invoke it wraps", async () => {
    const built: string[] = [];
    let signedHash = "0x0";
    const submission = await submitErc20Transfer(
      {
        account,
        amount: "1.5",
        mlDsa: {
          mlDsaEstimationSignature: async (publicKey) => {
            built.push(`estimation:${publicKey.length}`);
            return ["0x1"];
          },
          mlDsaSignaturePayload: async (_publicKey, transactionHash) => {
            built.push(`payload:${transactionHash}`);
            return ["0x1"];
          },
        },
        recipient: RECIPIENT,
        reviewedFee: { overallFee: "9999999", unit: "FRI" },
        rpcUrls: RPC_URLS,
        signHash: async (messageHash) => {
          signedHash = messageHash;
          return { kind: "ml-dsa-65", publicKey: account.publicKey, signature: "0xabcdef" };
        },
        token: eth,
      },
      () => provider(() => signedHash),
    );
    expect(submission.call.entrypoint).toBe("transfer");
    // The account calldata was built from the signature the phone returned; a
    // dropped port aborts before this and never reaches the node.
    expect(built).toContain(`payload:${signedHash}`);
    expect(submission.transactionHash).toBe(signedHash);
  });

  test("without the builders it refuses rather than signing a Stark payload", async () => {
    let signedHash = "0x0";
    await expect(
      submitErc20Transfer(
        {
          account,
          amount: "1.5",
          recipient: RECIPIENT,
          reviewedFee: { overallFee: "9999999", unit: "FRI" },
          rpcUrls: RPC_URLS,
          signHash: async (messageHash) => {
            signedHash = messageHash;
            return { kind: "ml-dsa-65", publicKey: account.publicKey, signature: "0xabcdef" };
          },
          token: eth,
        },
        () => provider(() => signedHash),
      ),
    ).rejects.toThrow("ML-DSA calldata builders are unavailable");
  });
});
