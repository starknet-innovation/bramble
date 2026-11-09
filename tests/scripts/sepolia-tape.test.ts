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
  answersFor,
  isUnrecorded,
  looseIndex,
  looseKey,
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

  test("a JSON-RPC call falls back across endpoints and blocks; nothing else does", () => {
    const at = (url: string, blockId: unknown) =>
      tapeKey(
        "POST",
        url,
        JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "starknet_getClassHashAt",
          params: { block_id: blockId, contract_address: "0x1" },
        }),
      );
    const loose = looseKey(at(URL, { block_number: 7 }));
    expect(loose).toBeDefined();
    expect(looseKey(at("https://other.example/rpc", { block_number: 9 }))).toBe(loose);
    expect(looseKey(at(URL, { block_hash: "0xab" }))).toBe(loose);
    expect(looseKey(at(URL, "latest"))).not.toBe(loose);
    const events = (from: number) =>
      tapeKey(
        "POST",
        URL,
        JSON.stringify({
          id: 2,
          jsonrpc: "2.0",
          method: "starknet_getEvents",
          params: { filter: { address: "0x1", from_block: { block_number: from }, keys: [] } },
        }),
      );
    expect(looseKey(events(100))).toBe(looseKey(events(250)));
    expect(looseKey(tapeKey("GET", URL, null))).toBeUndefined();
    expect(looseKey(tapeKey("POST", URL, '{"query":"x"}'))).toBeUndefined();
  });

  test("a replay serves successes first, exact then any endpoint, failures last", () => {
    const body = call(1);
    const here = tapeKey("POST", URL, body);
    const there = tapeKey("POST", "https://other.example/rpc", body);
    const ok = { status: 200, contentType: "application/json", body: '{"result":"0x1"}' };
    const limited = { status: 429, contentType: "text/plain", body: "slow down" };
    const pick = (tape: Record<string, (typeof ok)[]>) =>
      answersFor(tape, looseIndex(tape), here).answers.map((a) => a.status);

    expect(pick({ [here]: [limited, ok] })).toEqual([200]);
    expect(pick({ [here]: [limited], [there]: [ok] })).toEqual([200]);
    expect(pick({ [here]: [limited] })).toEqual([429]);
    expect(pick({ [there]: [limited] })).toEqual([429]);
    expect(pick({})).toEqual([]);
  });

  test("a viewing key or other secret-named field never reaches the key, and still matches", () => {
    const preflight = (viewingKey: string) =>
      tapeKey(
        "POST",
        `${URL}/strk20/preflight_check`,
        JSON.stringify({
          sender_address: "0x1",
          viewing_key: viewingKey,
          nested: { privateKey: "0x2" },
        }),
      );
    const key = preflight("0xabc123");
    expect(key).not.toContain("0xabc123");
    expect(key).not.toContain('"0x2"');
    expect(key).toContain('"viewing_key":"[omitted]"');
    expect(preflight("0xdef456")).toBe(key);
  });

  test("the privacy service is never recorded; node and other hosts are", () => {
    expect(
      isUnrecorded(
        "https://wallet.nodes.starknet.org/api/strk20/discovery/v1/sync/preflight_check",
      ),
    ).toBe(true);
    expect(isUnrecorded("https://privacy.example/strk20/notes")).toBe(true);
    expect(isUnrecorded("https://wallet.nodes.starknet.org/rpc/sepolia/v0_10")).toBe(false);
    expect(isUnrecorded("https://starkscan.co/v1/SN_SEPOLIA/token/0x1?q=strk20/")).toBe(false);
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

    expect(() => writeTape(path, { a: [{ ...answer, body: '{"viewing_key":"0x1234"}' }] })).toThrow(
      /secret/,
    );
    expect(() => writeTape(path, { [`POST ${URL} {"viewingKey":"0x1"}`]: [answer] })).toThrow(
      /secret/,
    );
    // A key made by tapeKey carries only the placeholder, so it is written.
    writeTape(`${path}.masked`, { [tapeKey("POST", URL, '{"viewing_key":"0x1"}')]: [answer] });

    const leaked = `0x00${"7d".repeat(30)}`;
    secret(leaked);
    expect(() => writeTape(path, { a: [{ ...answer, body: leaked }] })).toThrow(/secret/);
    expect(readTape(path)["a"]?.[0]?.body).toBe(answer.body);
  });
});
