/**
 * A Sepolia verification tape (tools/vendor-dataset/sepolia-tape.ts) must
 * match a replayed request however the wallet numbers its JSON-RPC calls, hand
 * back the caller's own ids, and never be written while it carries a secret.
 * Sentinel values only: nothing here reads the seed file or touches a network.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secret } from "../../tools/vendor-dataset/sepolia-redact";
import {
  readTape,
  tapeKey,
  withRequestIds,
  writeTape,
} from "../../tools/vendor-dataset/sepolia-tape";

const URL = "https://sepolia.example/rpc";
const call = (id: number) =>
  JSON.stringify({
    id,
    jsonrpc: "2.0",
    method: "starknet_getClassHashAt",
    params: ["latest", "0x1"],
  });

describe("sepolia tape", () => {
  test("a request keys the same whatever its JSON-RPC id, single or batched", () => {
    expect(tapeKey("POST", URL, call(1))).toBe(tapeKey("POST", URL, call(99)));
    expect(tapeKey("POST", URL, `[${call(1)},${call(2)}]`)).toBe(
      tapeKey("POST", URL, `[${call(7)},${call(8)}]`),
    );
    expect(tapeKey("POST", URL, call(1))).not.toBe(tapeKey("POST", `${URL}/v2`, call(1)));
  });

  test("a non-JSON body keys on its raw text", () => {
    expect(tapeKey("GET", URL, null)).toBe(`GET ${URL} `);
    expect(tapeKey("POST", URL, "not json")).toBe(`POST ${URL} not json`);
  });

  test("a replayed answer carries the caller's ids", () => {
    const recorded = JSON.stringify({ id: 1, jsonrpc: "2.0", result: "0xabc" });
    expect(JSON.parse(withRequestIds(call(42), recorded)).id).toBe(42);
    const batch = JSON.stringify([
      { id: 1, result: "0xa" },
      { id: 2, result: "0xb" },
    ]);
    const ids = JSON.parse(withRequestIds(`[${call(5)},${call(6)}]`, batch)).map(
      (item: { id: number }) => item.id,
    );
    expect(ids).toEqual([5, 6]);
  });

  test("a non-JSON answer, such as an HTML error page, replays unchanged", () => {
    expect(withRequestIds(call(3), "<html>502</html>")).toBe("<html>502</html>");
  });

  test("a tape round-trips, and one carrying a registered secret is refused", () => {
    const path = join(mkdtempSync(join(tmpdir(), "sepolia-tape-")), "tape.json");
    const answer = { status: 200, contentType: "application/json", body: '{"result":"0x1"}' };
    writeTape(path, { b: [answer], a: [answer] });
    expect(Object.keys(readTape(path))).toEqual(["a", "b"]);

    const leaked = `0x00${"7d".repeat(30)}`;
    secret(leaked);
    expect(() => writeTape(path, { a: [{ ...answer, body: leaked }] })).toThrow(/secret/);
    expect(readTape(path)["a"]?.[0]?.body).toBe(answer.body);
  });
});
