/**
 * The round's kept record and the pool-fee read, offline: a record round-trips
 * through its directory and is cleared, a damaged one is reported rather than
 * trusted, and the pool fee is refused above its ceiling or when malformed.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcProvider } from "starknet";
import { MAX_PROTOCOL_FEE_RAW, readProtocolFee } from "../strk20-pool-fee";
import { clearRound, ownerProfile, readRound, writeRound } from "./round-state";

const SALT = `0x${"5".repeat(62)}`;

const scratch = (): Promise<string> => mkdtemp(join(tmpdir(), "bramble-round-files-"));

describe("kept round directory", () => {
  test("is absent, then written, read back, and cleared", async () => {
    const directory = join(await scratch(), "round");
    await expect(readRound(directory)).resolves.toEqual({ kind: "none" });
    await writeRound(directory, { salt: SALT, version: 1 });
    await expect(readRound(directory)).resolves.toEqual({
      kind: "kept",
      record: { salt: SALT, version: 1 },
    });
    expect(ownerProfile(directory, "b")).toBe(join(directory, "owner-b"));
    await clearRound(directory);
    await expect(readRound(directory)).resolves.toEqual({ kind: "none" });
  });

  test("a record that cannot be trusted is reported as damaged", async () => {
    const directory = await scratch();
    await writeFile(join(directory, "round.json"), "{ not json");
    await expect(readRound(directory)).resolves.toEqual({ kind: "damaged" });
    await rm(directory, { force: true, recursive: true });
  });
});

describe("pool fee", () => {
  const answering = (answer: readonly unknown[]): RpcProvider =>
    ({ callContract: async () => answer }) as unknown as RpcProvider;

  test("reads the fee and refuses one above the ceiling or malformed", async () => {
    await expect(readProtocolFee(answering(["0x10"]))).resolves.toBe(16n);
    await expect(
      readProtocolFee(answering([`0x${(MAX_PROTOCOL_FEE_RAW + 1n).toString(16)}`])),
    ).rejects.toThrow("exceeds the live-test safety cap");
    await expect(readProtocolFee(answering([]))).rejects.toThrow("invalid protocol fee");
  });
});
