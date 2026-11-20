/**
 * ERC721 ownership reads and ERC20 approve-call construction. `getNftOwner` is
 * driven through a spied `RpcProvider.prototype.callContract` (the module builds
 * its own provider via withRpcFallback's default factory): it returns canonical
 * hex from the snake_case `owner_of` entrypoint, falls back to camelCase
 * `ownerOf` when the first entrypoint faults semantically, rethrows transport
 * failures, and throws when neither entrypoint yields a field-element owner.
 * buildErc20ApproveCall's invalid-address guard is asserted the way
 * tests/starknet/starknet-rpc.test.ts asserts the transfer-call guard.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  buildErc20ApproveCall,
  getNftOwner,
  getNftOwnership,
  getNftTokenUri,
} from "@bramble/starknet/rpc-assets";
import { byteArray, RpcProvider, shortString } from "starknet";
import { digestApprovalPayload } from "../../apps/extension/src/background/approvals/approval-context";

const CONTRACT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const OWNER = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

type CallArg = { readonly entrypoint: string };

const spies: { mockRestore: () => void }[] = [];
const spyCallContract = (impl: (call: CallArg) => Promise<readonly string[]>): void => {
  const spy = spyOn(RpcProvider.prototype, "callContract").mockImplementation(((call: CallArg) =>
    impl(call)) as never);
  spies.push(spy);
};

const encodedByteArray = (value: string): readonly string[] => {
  const encoded = byteArray.byteArrayFromString(value);
  return [
    String(encoded.data.length),
    ...encoded.data.map(String),
    String(encoded.pending_word),
    String(encoded.pending_word_len),
  ];
};

afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

describe("getNftOwner", () => {
  test("reads the owner via owner_of and returns canonical hex", async () => {
    const seen: string[] = [];
    // The node returns a leading-zero-padded felt; the reader canonicalizes it.
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      return ["0x00000abc"];
    });

    const owner = await getNftOwner({
      contractAddress: CONTRACT,
      rpcUrls: ["https://rpc.example"],
      tokenId: "42",
    });

    expect(owner).toBe("0xabc");
    // The snake_case entrypoint answered first, so no fallback was needed.
    expect(seen).toEqual(["owner_of"]);
  });

  test("falls back to ownerOf when owner_of faults semantically", async () => {
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      if (call.entrypoint === "owner_of") {
        // A semantic RPC error (baseError.code present) is not transport-level,
        // so it is swallowed and the camelCase entrypoint is tried next.
        throw Object.assign(new Error("entrypoint not found"), {
          baseError: { code: 21, message: "entrypoint not found" },
        });
      }
      return [OWNER];
    });

    const owner = await getNftOwner({
      contractAddress: CONTRACT,
      rpcUrls: ["https://rpc.example"],
      tokenId: "7",
    });

    expect(owner).toBe(`0x${BigInt(OWNER).toString(16)}`);
    expect(seen).toEqual(["owner_of", "ownerOf"]);
  });

  test("rethrows a transport error instead of masking it as unreadable", async () => {
    spyCallContract(async () => {
      // No baseError.code → transport-level → must propagate.
      throw new Error("fetch failed");
    });

    await expect(
      getNftOwner({ contractAddress: CONTRACT, rpcUrls: ["https://rpc.example"], tokenId: "1" }),
    ).rejects.toThrow("fetch failed");
  });

  test("throws when neither entrypoint returns a field-element owner", async () => {
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      // A malformed response: no valid felt in slot 0.
      return call.entrypoint === "owner_of" ? [] : ["not-a-felt"];
    });

    await expect(
      getNftOwner({ contractAddress: CONTRACT, rpcUrls: ["https://rpc.example"], tokenId: "9" }),
    ).rejects.toThrow("Could not read NFT owner");
    // Both entrypoints were attempted before giving up.
    expect(seen).toEqual(["owner_of", "ownerOf"]);
  });

  test("rejects an invalid NFT contract address before any RPC call", async () => {
    let called = false;
    spyCallContract(async () => {
      called = true;
      return [OWNER];
    });

    await expect(
      getNftOwner({ contractAddress: "0x0", rpcUrls: ["https://rpc.example"], tokenId: "1" }),
    ).rejects.toThrow("Invalid NFT contract address");
    expect(called).toBe(false);
  });
});

describe("getNftTokenUri", () => {
  test("decodes a Cairo ByteArray from token_uri", async () => {
    const uri = 'data:application/json,{"name":"Punk"}';
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      return encodedByteArray(uri);
    });

    await expect(
      getNftTokenUri({
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "0",
      }),
    ).resolves.toBe(uri);
    expect(seen).toEqual(["token_uri"]);
  });

  test("falls back to tokenURI when token_uri is unsupported", async () => {
    const uri = "ipfs://bafybeigdyrzt/0.json";
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      if (call.entrypoint === "token_uri") {
        throw Object.assign(new Error("entrypoint not found"), {
          baseError: { code: 21, message: "entrypoint not found" },
        });
      }
      return encodedByteArray(uri);
    });

    await expect(
      getNftTokenUri({
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "5",
      }),
    ).resolves.toBe(uri);
    expect(seen).toEqual(["token_uri", "tokenURI"]);
  });

  test("rejects malformed ByteArray responses", async () => {
    spyCallContract(async () => ["1000000", "0x1", "0x0", "0"]);

    await expect(
      getNftTokenUri({
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "5",
      }),
    ).rejects.toThrow("Could not read NFT metadata URI");
  });

  test("decodes a legacy felt-array token URI (a SPOK on Mainnet)", async () => {
    // The real token_uri reply for SPOK 0x2f8a65: a length, then short strings.
    const legacy = [
      "0x9",
      "0x68747470733a2f2f636c6f75642e617267656e742d6170692e636f6d2f7631",
      "0x2f6d6f6d656e74732f6d657461646174612f332f",
      "0x33",
      "0x31",
      "0x31",
      "0x35",
      "0x36",
      "0x32",
      "0x31",
    ];
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      return legacy;
    });

    await expect(
      getNftTokenUri({
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "3115621",
      }),
    ).resolves.toBe("https://cloud.argent-api.com/v1/moments/metadata/3/3115621");
    expect(seen).toEqual(["token_uri"]);
  });

  test("decodes a legacy URI split into more one-byte pieces than 31-byte words would need", async () => {
    const uri = `https://metadata.example/${"a".repeat(1200)}`;
    spyCallContract(async () => [
      `0x${uri.length.toString(16)}`,
      ...[...uri].map((char) => `0x${char.charCodeAt(0).toString(16)}`),
    ]);

    await expect(
      getNftTokenUri({
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "5",
      }),
    ).resolves.toBe(uri);
  });

  test.each([
    ["a count that doesn't match the pieces", ["0x2", shortString.encodeShortString("https://")]],
    ["an empty piece", ["0x2", shortString.encodeShortString("https://"), "0x0"]],
    ["a control byte", ["0x1", "0x68740a"]],
    ["a non-ASCII byte", ["0x1", "0x68ff"]],
    ["a piece longer than 31 bytes", ["0x1", `0x${"61".repeat(32)}`]],
    ["a zero count", ["0x0"]],
    ["a non-numeric count", ["nope", "0x61"]],
    ["a non-hex piece", ["0x1", "97"]],
    ["a zero-padded piece past felt length", ["0x1", `0x${"0".repeat(64)}61`]],
    ["more pieces than the URI byte bound", ["0x8001", ...Array<string>(0x8001).fill("0x61")]],
  ])("rejects a legacy felt-array URI with %s", async (_label, response) => {
    spyCallContract(async () => response);

    await expect(
      getNftTokenUri({
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "5",
      }),
    ).rejects.toThrow("Could not read NFT metadata URI");
  });

  test("reads an ERC1155 uri and substitutes the standard id placeholder", async () => {
    const template = "https://metadata.example/{id}.json";
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      if (call.entrypoint !== "uri") {
        throw Object.assign(new Error("entrypoint not found"), {
          baseError: { code: 21, message: "entrypoint not found" },
        });
      }
      return encodedByteArray(template);
    });

    await expect(
      getNftTokenUri({
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "342",
      }),
    ).resolves.toBe(
      "https://metadata.example/0000000000000000000000000000000000000000000000000000000000000156.json",
    );
    expect(seen).toEqual(["token_uri", "tokenURI", "uri"]);
  });
});

describe("getNftOwnership", () => {
  test("falls back from ERC721 owner reads to an ERC1155 balance", async () => {
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      if (call.entrypoint === "balance_of") {
        return ["0x2", "0x0"];
      }
      throw Object.assign(new Error("entrypoint not found"), {
        baseError: { code: 21, message: "entrypoint not found" },
      });
    });

    await expect(
      getNftOwnership({
        accountAddress: OWNER,
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "342",
      }),
    ).resolves.toEqual({ balance: "2", standard: "ERC1155" });
    expect(seen).toEqual(["owner_of", "ownerOf", "balance_of"]);
  });

  test("returns a zero ERC721 balance without misclassifying the contract", async () => {
    spyCallContract(async () => ["0x999"]);

    await expect(
      getNftOwnership({
        accountAddress: OWNER,
        contractAddress: CONTRACT,
        rpcUrls: ["https://rpc.example"],
        tokenId: "5",
      }),
    ).resolves.toEqual({ balance: "0", standard: "ERC721" });
  });
});

describe("buildErc20ApproveCall", () => {
  test("builds an approve call for valid addresses", () => {
    expect(buildErc20ApproveCall("0x1", "0x2", 5n)).toEqual({
      calldata: ["0x2", "0x5", "0x0"],
      contractAddress: "0x1",
      entrypoint: "approve",
    });
  });

  test("rejects a zero token or spender address", () => {
    expect(() => buildErc20ApproveCall("0x0", "0x2", 5n)).toThrow(WalletError);
    expect(() => buildErc20ApproveCall("0x1", "0x0", 5n)).toThrow("Invalid approval address");
  });

  test("returns plain calldata a review digest can hash", async () => {
    const call = buildErc20ApproveCall("0x1", "0x2", 6000000000000000000n);

    // `CallData.compile` tags its result with a non-enumerable `__compiled__`
    // property. The approval-payload normalizer rejects non-enumerable own
    // properties, so a tagged array reaches the user as "Invalid approval
    // payload" and blocks every relay submission that carries an approval.
    expect(Object.getOwnPropertyNames(call.calldata)).toEqual(["0", "1", "2", "length"]);
    await expect(digestApprovalPayload(call)).resolves.toContain("sha256:");
    // The values themselves must not change: the CallSet signature depends on
    // recompiling this calldata to the identical felts.
    expect(call.calldata).toEqual(["0x2", "0x53444835ec580000", "0x0"]);
  });
});
