import { byteArray, CallData, constants, hash } from "starknet";
import { describe, expect, test } from "vitest";
import {
  buildTokenDeployment,
  formatTokenAmount,
  parseTokenAmount,
  parseU256List,
  type TokenDraft,
} from "./token-create";
import { TOKEN_PRESETS } from "./token-presets";

const OWNER = "0x0123";
const RECIPIENT = "0x0456";
const SALT = "0x77";

const text = (value: string): string[] => CallData.compile([byteArray.byteArrayFromString(value)]);
const hex = (values: readonly (string | bigint | number)[]): string[] =>
  values.map((value) => `0x${BigInt(value).toString(16)}`);

const erc20: TokenDraft = {
  name: "Bramble Test",
  recipient: RECIPIENT,
  standard: "erc20",
  supply: "1000.5",
  symbol: "BRT",
};

describe("token amounts", () => {
  test("parses whole tokens into 18-decimal base units", () => {
    expect(parseTokenAmount("1000.5")).toBe(1_000_500_000_000_000_000_000n);
    expect(parseTokenAmount("0.000000000000000001")).toBe(1n);
    expect(formatTokenAmount(1_000_500_000_000_000_000_000n)).toBe("1000.5");
    expect(formatTokenAmount(10n ** 18n)).toBe("1");
  });

  test.each(["0", "0.0", "-1", "1e3", "1.0000000000000000001", " ", "01", `${2n ** 256n}`])(
    "refuses %p",
    (value) => {
      expect(() => parseTokenAmount(value)).toThrow();
    },
  );

  test("token id lists accept commas or spaces and refuse bad entries", () => {
    expect(parseU256List("1, 2 3", "Token ids")).toEqual([1n, 2n, 3n]);
    expect(() => parseU256List("", "Token ids")).toThrow();
    expect(() => parseU256List("1.5", "Token ids")).toThrow();
    expect(() => parseU256List(`${2n ** 256n}`, "Token ids")).toThrow();
    expect(() => parseU256List(Array.from({ length: 51 }, (_, i) => i).join(","), "Token ids")).toThrow();
  });
});

describe("buildTokenDeployment", () => {
  test("ERC-20: one UDC call with the preset's exact constructor layout", () => {
    const supply = 1_000_500_000_000_000_000_000n;
    const expected = hex([...text("Bramble Test"), ...text("BRT"), supply, 0n, RECIPIENT, OWNER]);
    const deployment = buildTokenDeployment(erc20, OWNER, SALT);
    expect(deployment.constructorCalldata).toEqual(expected);
    expect(deployment.call.contractAddress).toBe(constants.UDC.ADDRESS);
    expect(deployment.call.entrypoint).toBe("deploy_contract");
    expect(deployment.call.calldata).toEqual(
      CallData.compile([TOKEN_PRESETS.erc20.classHash, SALT, 0, expected]),
    );
    expect(deployment.address).toBe(
      hash.calculateContractAddressFromHash(SALT, TOKEN_PRESETS.erc20.classHash, expected, 0),
    );
    expect(deployment.details).toContainEqual({ label: "Supply", value: "1000.5 BRT" });
    expect(deployment.details).toContainEqual({ label: "Owner (can upgrade)", value: OWNER });
  });

  test("ERC-721: ids are a Span<u256> before the owner", () => {
    const deployment = buildTokenDeployment(
      {
        baseUri: "ipfs://bafy/",
        name: "Garden",
        recipient: RECIPIENT,
        standard: "erc721",
        symbol: "GRDN",
        tokenIds: "1,2",
      },
      OWNER,
      SALT,
    );
    expect(deployment.constructorCalldata).toEqual(
      hex([...text("Garden"), ...text("GRDN"), ...text("ipfs://bafy/"), RECIPIENT, 2, 1, 0, 2, 0, OWNER]),
    );
    expect(deployment.classHash).toBe(TOKEN_PRESETS.erc721.classHash);
  });

  test("ERC-1155: ids and amounts are paired spans, with no name or symbol", () => {
    const deployment = buildTokenDeployment(
      {
        amounts: "10 1",
        baseUri: "https://example.org/{id}.json",
        recipient: RECIPIENT,
        standard: "erc1155",
        tokenIds: "7 8",
      },
      OWNER,
      SALT,
    );
    expect(deployment.constructorCalldata).toEqual(
      hex([...text("https://example.org/{id}.json"), RECIPIENT, 2, 7, 0, 8, 0, 2, 10, 0, 1, 0, OWNER]),
    );
    expect(deployment.details).toContainEqual({ label: "Tokens", value: "#7 × 10, #8 × 1" });
  });

  test("a u256 above 2^128 is split into low and high limbs", () => {
    const large = (1n << 200n) + 5n;
    const deployment = buildTokenDeployment(
      { ...erc20, supply: formatTokenAmount(large) },
      OWNER,
      SALT,
    );
    expect(deployment.constructorCalldata.slice(-4, -2)).toEqual(hex([5n, 1n << 72n]));
  });

  test.each<[string, TokenDraft]>([
    ["an empty name", { ...erc20, name: "  " }],
    ["a non-ASCII name", { ...erc20, name: "Café" }],
    ["a long name", { ...erc20, name: "x".repeat(49) }],
    ["a symbol with spaces", { ...erc20, symbol: "B R" }],
    ["a twelve-letter symbol", { ...erc20, symbol: "ABCDEFGHIJKL" }],
    ["a zero recipient", { ...erc20, recipient: "0x0" }],
    ["a non-felt recipient", { ...erc20, recipient: "bramble.stark" }],
    [
      "an http base URI",
      { baseUri: "http://x/", name: "A", recipient: RECIPIENT, standard: "erc721", symbol: "A", tokenIds: "1" },
    ],
    [
      "a base URI with a space",
      { baseUri: "ipfs://a b", name: "A", recipient: RECIPIENT, standard: "erc721", symbol: "A", tokenIds: "1" },
    ],
    [
      "repeated token ids",
      { baseUri: "ipfs://a/", name: "A", recipient: RECIPIENT, standard: "erc721", symbol: "A", tokenIds: "1,1" },
    ],
    [
      "unpaired amounts",
      { amounts: "1", baseUri: "ipfs://a/", recipient: RECIPIENT, standard: "erc1155", tokenIds: "1,2" },
    ],
    [
      "a zero amount",
      { amounts: "0", baseUri: "ipfs://a/", recipient: RECIPIENT, standard: "erc1155", tokenIds: "1" },
    ],
  ])("refuses %s", (_label, draft) => {
    expect(() => buildTokenDeployment(draft, OWNER, SALT)).toThrow();
  });

  test("refuses a zero owner or salt", () => {
    expect(() => buildTokenDeployment(erc20, "0x0", SALT)).toThrow();
    expect(() => buildTokenDeployment(erc20, OWNER, "0x0")).toThrow();
  });
});
