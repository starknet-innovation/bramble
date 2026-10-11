/**
 * Regression coverage for the RPC history scan against the exact shapes the
 * bundled mainnet node returns (captured from `starknet_getEvents` and
 * `starknet_getBlockWithTxHashes` on the v0_10 gateway, September 2026). The
 * scan once read as "returns nothing" for a transaction-rich account because
 * the caller passed an ad-hoc `accountId`: every produced row was stamped with
 * it, failed `isActivityEntry` at the boundary, and was dropped without a
 * word. These cases pin both halves: real node payloads produce entries, and a
 * malformed account id fails loudly before any RPC call instead of yielding an
 * empty feed.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { isTransportRpcError } from "@bramble/starknet/provider";
import { scanTransactionHistory } from "@bramble/transactions/tx-history-scan";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { RpcProvider } from "starknet";

const ACCOUNT = "0x30470ba0f70208efa34e0eb2716d3a3c7bef2929aa6d27ecb2bc78d78a955c7";
const SEQUENCER = "0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8";
const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const strk: TokenConfig = {
  address: STRK_ADDRESS,
  decimals: 18,
  id: `SN_MAIN:STRK:${STRK_ADDRESS}`,
  name: "Starknet Token",
  networkId: "SN_MAIN",
  symbol: "STRK",
};

// Verbatim EMITTED_EVENT from the node: three keys (selector, from, to), a
// two-felt uint256 amount, and the extra fields the decoder must tolerate.
const MAINNET_TRANSFER_EVENT = {
  block_hash: "0x1475cf2e5afa57ba404f40198578421c3fec7dddb4e35e1a49276f81817c7de",
  block_number: 14_533_466,
  data: ["0x4515e38ab42a460", "0x0"],
  event_index: 6,
  from_address: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  keys: ["0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9", ACCOUNT, SEQUENCER],
  transaction_hash: "0x7241fdec0a3dba34a765ee1713788762c436422a5e18b24300142a9a3a8a363",
  transaction_index: 10,
};

// Verbatim BLOCK_WITH_TX_HASHES header for that block (transactions trimmed).
const MAINNET_BLOCK_HEADER = {
  block_hash: "0x1475cf2e5afa57ba404f40198578421c3fec7dddb4e35e1a49276f81817c7de",
  block_number: 14_533_466,
  event_commitment: "0x71d8f2622f474d74b4f371220e588d2d611bb0d197364de428f5a4e7641f136",
  event_count: 88,
  l1_da_mode: "BLOB",
  l1_data_gas_price: { price_in_fri: "0x75aafbcca", price_in_wei: "0x60fa2" },
  l1_gas_price: { price_in_fri: "0x4be63112d46c", price_in_wei: "0x3e8d90be" },
  l2_gas_price: { price_in_fri: "0x68452c9ba", price_in_wei: "0x55ef6" },
  new_root: "0x7ed6f3cf9dab93cc65276e4a11241b702d4f697c26b0f875767d5ae88641bc",
  parent_hash: "0x71f1f9ed4ab74da1757d09e19cd3f7f319793cea0e6e1332f44d952b94d454e",
  receipt_commitment: "0xd520635469b0d40b9c3228ad573cf6b6e8ce5ebf11a673b330804dabe011f4",
  sequencer_address: SEQUENCER,
  starknet_version: "0.14.3",
  state_diff_commitment: "0x4371b7989aae0641ccb513491cf41de5378ccda0e7e9744452d04a645101547",
  state_diff_length: 76,
  status: "ACCEPTED_ON_L2",
  timestamp: 1_788_832_699,
  transaction_commitment: "0x6ffbbe3403232a42c83a15ff16a48ea169520f3c838c84988c80581b867c5b8",
  transaction_count: 12,
  transactions: ["0x637d81a5c0ad2791ac11ecfeaec27a2ce478e374424432bf04527f9363bdbc1"],
};

const mainnetProvider = (calls: string[]): RpcProvider =>
  ({
    async getBlockNumber() {
      calls.push("starknet_blockNumber");
      return 14_695_247;
    },
    async getBlockWithTxHashes() {
      calls.push("starknet_getBlockWithTxHashes");
      return MAINNET_BLOCK_HEADER as unknown as Awaited<
        ReturnType<RpcProvider["getBlockWithTxHashes"]>
      >;
    },
    async getEvents(filter: { readonly keys?: readonly (readonly string[])[] }) {
      calls.push("starknet_getEvents");
      // The node honours the key filter: the outgoing filter (key 1 = account)
      // matches this event, the incoming filter (key 2 = account) does not.
      const outgoing = filter.keys?.[1]?.[0] === ACCOUNT;
      return { events: outgoing ? [MAINNET_TRANSFER_EVENT] : [] } as unknown as Awaited<
        ReturnType<RpcProvider["getEvents"]>
      >;
    },
  }) as unknown as RpcProvider;

const scanInput = {
  account: ACCOUNT,
  networkId: "SN_MAIN" as const,
  rpcUrls: ["https://wallet.nodes.starknet.org/rpc/mainnet/v0_10"],
  tokens: [strk],
};

describe("scanTransactionHistory against real mainnet payloads", () => {
  test("turns the node's Transfer event and block header into a dated entry", async () => {
    const calls: string[] = [];
    const entries = await scanTransactionHistory(
      { ...scanInput, accountId: `SN_MAIN:${ACCOUNT}` },
      () => mainnetProvider(calls),
    );

    expect(entries).toEqual([
      {
        accountId: `SN_MAIN:${ACCOUNT}`,
        amount: "0.311133446749725792",
        counterparty: SEQUENCER,
        hash: "0x7241fdec0a3dba34a765ee1713788762c436422a5e18b24300142a9a3a8a363",
        kind: "transfer",
        networkId: "SN_MAIN",
        status: "accepted",
        submittedAt: 1_788_832_699_000,
        summary: "Sent 0.311133446749725792 STRK to 0x1176…f3d8",
        token: "STRK",
      },
    ]);
    // One height read, the layout probe, one outgoing and one incoming filter,
    // one header read.
    expect(calls).toEqual([
      "starknet_blockNumber",
      "starknet_getEvents",
      "starknet_getEvents",
      "starknet_getEvents",
      "starknet_getBlockWithTxHashes",
    ]);
  });

  test("a pre-confirmed header (no status field) still dates the row", async () => {
    const { status: _status, ...preconfirmed } = MAINNET_BLOCK_HEADER;
    const calls: string[] = [];
    const entries = await scanTransactionHistory(
      { ...scanInput, accountId: `SN_MAIN:${ACCOUNT}` },
      () =>
        ({
          ...mainnetProvider(calls),
          async getBlockWithTxHashes() {
            return preconfirmed as unknown as Awaited<
              ReturnType<RpcProvider["getBlockWithTxHashes"]>
            >;
          },
        }) as unknown as RpcProvider,
    );
    expect(entries.map((entry) => entry.submittedAt)).toEqual([1_788_832_699_000]);
  });

  test("an ad-hoc account id fails loudly before any RPC call, not as an empty feed", async () => {
    const calls: string[] = [];
    let thrown: unknown;
    try {
      await scanTransactionHistory({ ...scanInput, accountId: "probe" }, () =>
        mainnetProvider(calls),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WalletError);
    expect((thrown as Error).message).toBe("History account id does not belong to the network");
    // Semantic, not transport: it must not fan out across the endpoint list.
    expect(isTransportRpcError(thrown)).toBe(false);
    expect(calls).toEqual([]);
  });

  test("an account id from another network is rejected the same way", async () => {
    const calls: string[] = [];
    await expect(
      scanTransactionHistory({ ...scanInput, accountId: `SN_SEPOLIA:${ACCOUNT}` }, () =>
        mainnetProvider(calls),
      ),
    ).rejects.toThrow("History account id does not belong to the network");
    expect(calls).toEqual([]);
  });
});
