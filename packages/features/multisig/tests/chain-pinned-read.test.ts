/**
 * Pinned-block read policy: absorbing load-balanced node skew without giving up
 * read consistency or freshness.
 *
 * Sibling of chain-reads.test.ts, which was already at the file budget.
 */
import { describe, expect, test } from "bun:test";
import { getArgentMultisigConfig } from "@mc-wallet/multisig/chain";
import { ARGENT_MULTISIG_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import type { RpcProvider } from "starknet";

const ADDRESS = "0x111";
const GUID_A = "0x123";
const RPC_URLS = ["https://rpc.example"];

describe("pinned-block reads survive load-balanced node skew", () => {
  // A block hash read from the endpoint moments earlier is not guaranteed to
  // exist on the sibling node that answers the next request. Reproduced against
  // the wallet's own mainnet endpoint at roughly one attempt in eight, and this
  // read pins three requests to that hash, so it compounds. Re-pinning must
  // absorb it; the alternative is reporting a chain-state failure the chain
  // never had.
  const blockNotFound = () =>
    Object.assign(new Error("24: Block not found: undefined"), {
      baseError: { code: 24, message: "Block not found" },
    });

  const skewedProvider = (missesBeforeSuccess: number, heads: string[]) => {
    let misses = 0;
    let head = 0;
    return (): RpcProvider =>
      ({
        async callContract(request: { readonly entrypoint: string }) {
          if (misses < missesBeforeSuccess) {
            misses += 1;
            throw blockNotFound();
          }
          return request.entrypoint === "get_threshold" ? ["0x1"] : ["0x1", GUID_A];
        },
        async getBlockLatestAccepted() {
          head += 1;
          const hash = `0xbeef${head}`;
          heads.push(hash);
          return { block_hash: hash, block_number: 100 + head };
        },
        async getClassHashAt() {
          return ARGENT_MULTISIG_CONTRACT.classHash;
        },
      }) as unknown as RpcProvider;
  };

  test("re-pins to a fresh head when the answering node lacks the block", async () => {
    const heads: string[] = [];
    await expect(
      getArgentMultisigConfig({
        address: ADDRESS,
        makeProvider: skewedProvider(1, heads),
        rpcUrls: RPC_URLS,
      }),
    ).resolves.toEqual({
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      signerGuids: [GUID_A],
      threshold: 1,
    });
    // Two pins: the missed one and the one that answered. Each attempt re-reads
    // the head, so an attempt stays internally consistent and stays current -
    // neither property is traded away to absorb the skew.
    expect(heads).toEqual(["0xbeef1", "0xbeef2"]);
  });

  test("a node that never has the block still fails closed", async () => {
    const heads: string[] = [];
    await expect(
      getArgentMultisigConfig({
        address: ADDRESS,
        makeProvider: skewedProvider(Number.MAX_SAFE_INTEGER, heads),
        rpcUrls: RPC_URLS,
      }),
    ).rejects.toThrow();
    // Bounded: it does not re-pin forever against a node that cannot answer.
    expect(heads.length).toBe(3);
  });
});
