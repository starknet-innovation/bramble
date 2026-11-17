import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { constants } from "starknet";
import {
  buildPunkDeployment,
  buildPunkMintCall,
  buildPunkTransferCall,
  isFelt,
  parsePunkId,
  punkImageUrl,
  punkMetadataUri,
  PUNK_CLASS_HASH,
  readPunkContractClass,
} from "./punk-contract";

describe("Punk contract helpers", () => {
  test("accepts only catalog ids from 0 through 9999", () => {
    expect(parsePunkId("0")).toBe(0);
    expect(parsePunkId("9999")).toBe(9999);
    expect(parsePunkId("0001")).toBeNull();
    expect(parsePunkId("-1")).toBeNull();
    expect(parsePunkId("10000")).toBeNull();
    expect(parsePunkId("1.5")).toBeNull();
  });

  test("uses official zero-padded artwork and self-contained metadata", () => {
    expect(punkImageUrl(42)).toBe(
      "https://www.larvalabs.com/public/images/cryptopunks/punk0042.png",
    );
    const uri = punkMetadataUri(42);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    const metadata = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(uri.split(",")[1] ?? ""), (character) => character.charCodeAt(0)),
      ),
    );
    expect(metadata).toMatchObject({
      image: "https://www.larvalabs.com/public/images/cryptopunks/punk0042.png",
      name: "Starknet Test Punk #42",
    });
  });

  test("builds deterministic deploy, mint, and wallet-transfer calls", () => {
    const deployment = buildPunkDeployment("MC Punks", "MCPUNK", "0x1234", "0x99");
    expect(deployment.call).toMatchObject({
      contractAddress: constants.UDC.ADDRESS,
      entrypoint: constants.UDC.ENTRYPOINT,
    });
    expect(deployment.address).toMatch(/^0x[0-9a-f]+$/);
    expect(BigInt(deployment.call.calldata?.[0] ?? "0")).toBe(BigInt(PUNK_CLASS_HASH));

    const mint = buildPunkMintCall("0xabc", "0x1234", 42);
    expect(mint.entrypoint).toBe("mint");
    expect(BigInt(mint.calldata?.[0] ?? "0")).toBe(0x1234n);
    expect(mint.calldata?.some((value) => BigInt(value) === 42n)).toBe(true);

    const transfer = buildPunkTransferCall("0xabc", "0x1234", "0x5678", 42);
    expect(transfer.entrypoint).toBe("transfer_from");
    expect(transfer.calldata?.slice(0, 4).map((value) => BigInt(value))).toEqual([
      0x1234n,
      0x5678n,
      42n,
      0n,
    ]);
  });

  test("re-proves the class hash of the shipped Sierra artifact", async () => {
    const source = await readFile(
      resolve(process.cwd(), "public/contracts/punk_collection.contract_class.json"),
      "utf8",
    );
    const contract = readPunkContractClass(JSON.parse(source));
    expect(contract.sierra_program.length).toBeGreaterThan(4_000);
  });

  test("refuses zero written with leading zeros (Sherlock 167)", () => {
    for (const zero of ["0x0", "0x00", "0x000", " 0X0000 "]) {
      expect(isFelt(zero)).toBe(false);
    }
    expect(isFelt("0x01")).toBe(true);
    expect(() => buildPunkDeployment("Punks", "MCP", "0x00", "0x1")).toThrow(
      "valid non-zero Starknet felts",
    );
    expect(() => buildPunkMintCall("0x123", "0x000", 1)).toThrow("valid Starknet addresses");
    expect(() => buildPunkTransferCall("0x123", "0x1", "0x00", 1)).toThrow(
      "valid Starknet addresses",
    );
  });
});
