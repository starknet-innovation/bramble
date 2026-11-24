/**
 * The hash block: SNIP-9 v2 outside executions as starknet.js builds them (the builder the
 * extension rebuilds the gateway's body with, `outsideExecution.getTypedData`) and the message hash
 * starknet.js gives (`typedData.getMessageHash`, the hash the extension signs), next to the hash
 * Krusty gives for the same JSON (`computeTypedDataMessageHash`, the function wallet-core would
 * call). `@bramble/kms-krusty`'s adapter does not expose Krusty's SNIP-12 hash, so this calls the
 * pinned WASM package directly, the way `mobile-parity.ts` loads it. Nothing here hashes on its own.
 */

import { sameFelt } from "@bramble/wallet-model/networks";
import { typedData as snip12 } from "starknet";
import { ACCOUNT, ETH, feeTransfer, MAX_FELT, outsideTypedData, RECIPIENT, USDC } from "./shared";

const FEE_CALL = feeTransfer();

type Krusty = typeof import("@starknetfoundation/krusty-kms-wasm");

const krusty = async (): Promise<Krusty> => {
  const module = await import("@starknetfoundation/krusty-kms-wasm");
  await module.default();
  return module;
};

type CallSet = {
  readonly name: string;
  readonly calls: Parameters<typeof outsideTypedData>[0];
  readonly terms?: Parameters<typeof outsideTypedData>[1];
};

const longCalldata = Array.from({ length: 128 }, (_, index) => `0x${(index * 7919).toString(16)}`);

const CALL_SETS: readonly CallSet[] = [
  {
    calls: [
      { calldata: [RECIPIENT, "0x10", "0x0"], contractAddress: USDC, entrypoint: "transfer" },
      FEE_CALL,
    ],
    name: "a USDC transfer and the fee transfer",
  },
  {
    calls: [
      { calldata: [RECIPIENT, "0xffffffff", "0x0"], contractAddress: ETH, entrypoint: "approve" },
      {
        calldata: [ETH, "0xffffffff", "0x0", USDC, "0x1"],
        contractAddress: RECIPIENT,
        entrypoint: "multi_route_swap",
      },
      FEE_CALL,
    ],
    name: "an approve, a swap and the fee transfer",
  },
  { calls: [], name: "no calls" },
  {
    calls: [
      {
        calldata: [MAX_FELT, MAX_FELT, MAX_FELT],
        contractAddress: MAX_FELT,
        entrypoint: "transfer",
      },
    ],
    name: "the largest felts everywhere",
    terms: { after: "0x0", before: "0xffffffffffffffffffffffffffffffff", nonce: MAX_FELT },
  },
  {
    calls: [{ calldata: longCalldata, contractAddress: USDC, entrypoint: "multicall" }, FEE_CALL],
    name: "128 felts of calldata",
  },
  {
    calls: [{ calldata: [], contractAddress: USDC, entrypoint: "0x1234" }, FEE_CALL],
    name: "an entrypoint spelled as a felt (starknet.js hashes its text as a name), no calldata",
  },
  {
    calls: [FEE_CALL],
    name: "any caller",
    terms: { caller: "0x414e595f43414c4c4552" },
  },
];

/** Account address spellings, one per account class the extension offers gasless on. */
const ADDRESSES: readonly (readonly [string, string])[] = [
  ["argent 0.4, as stored", ACCOUNT],
  ["openzeppelin, a short felt", "0x1d1777db36cdd06dd62cfde77b1b6ae0"],
  [
    "xverse argent, padded to 64 digits",
    "0x0005dccf9cfdcabb9e4ef45814bda1b056bb23063d0e9b64e5a845e9dfb3d23f",
  ],
];

const CHAINS = ["SN_MAIN", "SN_SEPOLIA"] as const;

const krustyHash = (module: Krusty, typedData: unknown, address: string): string => {
  try {
    return module.computeTypedDataMessageHash(JSON.stringify(typedData), address);
  } catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
};

/**
 * Every call set on both chains: the typed data once, then per account spelling the hash
 * starknet.js and Krusty give.
 */
export const computeHashes = async (): Promise<readonly object[]> => {
  const module = await krusty();
  return CALL_SETS.flatMap((set) =>
    CHAINS.map((chainId) => {
      const typedData = outsideTypedData(set.calls, { ...set.terms, chainId });
      return {
        chainId,
        hashes: ADDRESSES.map(([account, accountAddress]) => {
          const starknetJs = snip12.getMessageHash(typedData, accountAddress);
          const krustyAsBuilt = krustyHash(module, typedData, accountAddress);
          return {
            account,
            accountAddress,
            agree: sameFelt(krustyAsBuilt, starknetJs),
            krusty: krustyAsBuilt,
            starknetJs,
          };
        }),
        name: `${set.name}, ${chainId}`,
        typedData,
      };
    }),
  );
};
