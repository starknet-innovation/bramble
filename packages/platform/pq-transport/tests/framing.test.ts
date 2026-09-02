/**
 * The Bluetooth pipe's byte layout. Chunk boundaries are the interesting part:
 * Web Bluetooth gives no MTU, so a frame arrives split at sizes this side never
 * chose — including a length prefix delivered across two notifications — and a
 * reassembler that assumes otherwise reads a wrong length and hangs. Every
 * malformed frame must reach a terminal `invalid`, never `incomplete`, or a
 * caller waits for bytes that will not come.
 */
import { describe, expect, test } from "bun:test";
import {
  chunkForWrite,
  createPqReassembler,
  framePayload,
  PQ_FRAME_HEADER_BYTES,
  PQ_MAX_PAYLOAD_BYTES,
  PQ_WRITE_CHUNK_BYTES,
} from "@mc-wallet/pq-transport/framing";

// A real reply: 3309 bytes as lowercase `0x` hex, the largest thing the phone
// sends on the signing path.
const SIGNED_REPLY = `0x${"ab".repeat(3309)}`;

const framedWith = (declared: number, payload: Uint8Array, tagByte = 0x82): Uint8Array => {
  const framed = new Uint8Array(PQ_FRAME_HEADER_BYTES + payload.length);
  framed[0] = (declared >>> 24) & 0xff;
  framed[1] = (declared >>> 16) & 0xff;
  framed[2] = (declared >>> 8) & 0xff;
  framed[3] = declared & 0xff;
  framed[4] = tagByte;
  framed.set(payload, PQ_FRAME_HEADER_BYTES);
  return framed;
};

const pushAll = (chunks: readonly Uint8Array[]) => {
  const reassembler = createPqReassembler();
  let last = reassembler.push(new Uint8Array(0));
  for (const chunk of chunks) {
    last = reassembler.push(chunk);
  }
  return last;
};

describe("pq framing", () => {
  test("round-trips a signing reply through write-sized chunks", () => {
    const chunks = chunkForWrite(framePayload("signed", SIGNED_REPLY));

    expect(chunks.length).toBeGreaterThan(1);
    expect(pushAll(chunks)).toEqual({ kind: "complete", payload: SIGNED_REPLY, tag: "signed" });
  });

  test("reassembles a length prefix split across notifications", () => {
    const framed = framePayload("signed", "0xdeadbeef");

    // The phone sizes its own chunks and can split anywhere: inside the four
    // length bytes, and on the boundary between the length and the tag.
    expect(
      pushAll([
        framed.subarray(0, 2),
        framed.subarray(2, 4),
        framed.subarray(4, 7),
        framed.subarray(7),
      ]),
    ).toEqual({ kind: "complete", payload: "0xdeadbeef", tag: "signed" });
  });

  test("reassembles one byte at a time", () => {
    const framed = framePayload("sign", "abc");
    const reassembler = createPqReassembler();
    // Array.from first: Uint8Array.prototype.map coerces its callback result to
    // a number, which would silently turn every `kind` into 0.
    const seen = Array.from(framed).map((byte) => reassembler.push(new Uint8Array([byte])).kind);

    // Only the final byte may complete it; everything before is incomplete.
    expect(seen.slice(0, -1).every((kind) => kind === "incomplete")).toBe(true);
    expect(seen.at(-1)).toBe("complete");
  });

  test("a declared length of zero is invalid, not incomplete", () => {
    expect(pushAll([framedWith(0, new Uint8Array(0))])).toEqual({
      kind: "invalid",
      reason: "empty-frame",
    });
  });

  test("an oversize declared length is refused before anything is buffered for it", () => {
    expect(pushAll([framedWith(PQ_MAX_PAYLOAD_BYTES + 1, new Uint8Array(0))])).toEqual({
      kind: "invalid",
      reason: "oversize",
    });
  });

  test("bytes past the end of the frame are invalid", () => {
    const framed = framePayload("sign", "abc");
    const extra = new Uint8Array(framed.length + 1);
    extra.set(framed);

    expect(pushAll([extra])).toEqual({ kind: "invalid", reason: "trailing" });
  });

  test("a payload that is not valid UTF-8 is refused, not substituted", () => {
    expect(pushAll([framedWith(2, new Uint8Array([0xff, 0xfe]))])).toEqual({
      kind: "invalid",
      reason: "not-utf8",
    });
  });

  test("framing refuses an empty or oversize payload rather than truncating", () => {
    expect(() => framePayload("sign", "")).toThrow(RangeError);
    expect(() => framePayload("sign", "x".repeat(PQ_MAX_PAYLOAD_BYTES + 1))).toThrow(RangeError);
    expect(framePayload("sign", "x".repeat(PQ_MAX_PAYLOAD_BYTES))).toHaveLength(
      PQ_FRAME_HEADER_BYTES + PQ_MAX_PAYLOAD_BYTES,
    );
  });

  test("carries the tag through, so a reply's kind is read rather than guessed", () => {
    // The reason the tag exists: a refusal has no shape of its own, and hex is
    // itself valid base64url, so neither direction can be inferred from bytes.
    expect(pushAll(chunkForWrite(framePayload("refused", "declined")))).toEqual({
      kind: "complete",
      payload: "declined",
      tag: "refused",
    });
    expect(pushAll(chunkForWrite(framePayload("paired", "eyJhIjoxfQ")))).toEqual({
      kind: "complete",
      payload: "eyJhIjoxfQ",
      tag: "paired",
    });
  });

  test("an unknown tag is invalid rather than passed on", () => {
    expect(pushAll([framedWith(3, new TextEncoder().encode("abc"), 0x7f)])).toEqual({
      kind: "invalid",
      reason: "unknown-tag",
    });
  });

  test("write chunks cover every byte exactly once, in order", () => {
    const framed = framePayload("signed", SIGNED_REPLY);
    const chunks = chunkForWrite(framed);
    const rejoined = new Uint8Array(framed.length);
    let offset = 0;
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(PQ_WRITE_CHUNK_BYTES);
      rejoined.set(chunk, offset);
      offset += chunk.length;
    }

    expect(offset).toBe(framed.length);
    expect(Array.from(rejoined)).toEqual(Array.from(framed));
  });
});
