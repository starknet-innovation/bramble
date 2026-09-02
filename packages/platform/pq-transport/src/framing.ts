/**
 * Length-prefixed framing for the Bluetooth pipe, and the only place the byte
 * layout is decided.
 *
 * **This file is one half of a pair.** The other is `BleWire.kt` in the
 * `pq-signer` repository, and the two must agree byte for byte: the same UUIDs,
 * the same four-byte big-endian length, the same ceiling, the same refusals. A
 * disagreement does not present as a clear error — it presents as a chooser that
 * finds nothing, or a wallet waiting on bytes that never come. Change one side
 * and you change both; the same cases are asserted in both test suites.
 *
 * This adds no payload format. What travels is one of the strings the clipboard
 * transport already carries — a base64url request out, hex back — so the phone's
 * existing parser needs no change and there is no second contract to drift. The
 * strings are base64url and lowercase hex, so they are ASCII by construction: a
 * character is a byte, and the length prefix counts both.
 *
 * Web Bluetooth exposes no MTU and no way to negotiate one, so the phone sizes
 * its notifications from the value only it can see (`onMtuChanged` on Android,
 * `maximumUpdateValueLength` on iOS) and this side reassembles by the prefix
 * alone. There are no sequence numbers: GATT delivers writes and notifications
 * in order on a single connection, so a gap can only be a truncation, and a
 * truncation fails the length check rather than yielding a short message.
 *
 * Every frame carries a **tag**, because the payload arrives unsolicited and its
 * kind cannot be inferred from its bytes. Over the clipboard the user chose a
 * screen, so both sides knew what to expect; here the phone must be told whether
 * it is being asked to enroll or to sign, and the wallet must be told whether it
 * received a key, a signed hash, or a refusal. Sniffing was the first design and
 * it is wrong twice over: base64url and hex overlap, and a refusal has no shape
 * of its own at all.
 *
 * Fail-closed on every path. A declared length that is zero, oversize, or never
 * satisfied is `invalid`, as is an unknown tag, a frame followed by bytes that do
 * not belong to it, and any payload that is not valid UTF-8. A caller that treats
 * `invalid` as retryable rather than fatal is the one way to misuse this.
 */

// The service the phone advertises and the two characteristics it serves. The
// structure is deliberate rather than random: `7071` is "pq" in ASCII hex and
// `6d6377616c74` is "mcwalt", `31` is the protocol version, and the byte after it
// names the role. Bumping the version changes the SERVICE uuid, so an old app and
// a new wallet fail to find each other in the chooser instead of connecting and
// then mis-reading each other's frames.

/**
 * Service UUID the chooser filters on. Must equal `BLE_SERVICE_UUID` in the
 * phone's `BleWire.kt`.
 */
export const PQ_SERVICE_UUID = "70713100-0000-4000-8000-6d6377616c74";

/**
 * Characteristic this side writes a framed request to, in pieces of its choosing.
 */
export const PQ_REQUEST_UUID = "70713101-0000-4000-8000-6d6377616c74";

/**
 * Characteristic the phone notifies a framed reply on, in pieces of its choosing.
 */
export const PQ_RESPONSE_UUID = "70713102-0000-4000-8000-6d6377616c74";

/**
 * Bytes of big-endian payload length in front of every frame, followed by one
 * tag byte. The length counts the payload alone, so it never has to be adjusted
 * when a field is added ahead of it.
 */
export const PQ_FRAME_HEADER_BYTES = 5;

/**
 * What one frame is.
 *
 * The two directions are deliberately disjoint. A phone that answers a `sign`
 * with `paired` is a broken phone, and naming the directions apart makes that a
 * refusal at the boundary rather than something a caller has to check for.
 */
export type PqFrameTag = "pair" | "sign" | "paired" | "signed" | "refused";

// Distinct high bit for replies, so a frame read in the wrong direction cannot
// be mistaken for a valid one. `refused` is a reply only.
const TAG_BYTES: Readonly<Record<PqFrameTag, number>> = {
  pair: 0x01,
  paired: 0x81,
  refused: 0xff,
  sign: 0x02,
  signed: 0x82,
};

const TAG_NAMES = new Map<number, PqFrameTag>(
  Object.entries(TAG_BYTES).map(([name, byte]) => [byte, name as PqFrameTag]),
);

/**
 * Hard ceiling on one framed payload. The largest real message is the pairing
 * reply at roughly 7 KB (a 1952-byte key and a 3309-byte proof, hex inside
 * base64url JSON), so this leaves headroom without letting a buggy or hostile
 * peripheral make the panel allocate without bound.
 */
export const PQ_MAX_PAYLOAD_BYTES = 16_384;

/**
 * Bytes per `writeValue` call on the request characteristic. 512 is the ATT
 * ceiling for a single attribute write, and Chrome performs the long write
 * beneath it, so this is a hard cap rather than a tuning knob.
 */
export const PQ_WRITE_CHUNK_BYTES = 512;

/**
 * The state of an in-progress reassembly. `invalid` is terminal and names why,
 * so a caller can map it to a rejection code without inspecting the buffer.
 */
export type PqReassembly =
  | { readonly kind: "incomplete" }
  | { readonly kind: "complete"; readonly payload: string; readonly tag: PqFrameTag }
  | {
      readonly kind: "invalid";
      readonly reason: "empty-frame" | "oversize" | "trailing" | "not-utf8" | "unknown-tag";
    };

/**
 * Accepts chunks in arrival order and reports when one whole frame has landed.
 * Stateful, single-use per message: construct one per request, and stop feeding
 * it once it reports `complete` or `invalid`.
 */
export type PqReassembler = {
  readonly push: (chunk: Uint8Array) => PqReassembly;
};

const readLength = (buffered: Uint8Array): number =>
  ((buffered[0] ?? 0) << 24) |
  ((buffered[1] ?? 0) << 16) |
  ((buffered[2] ?? 0) << 8) |
  (buffered[3] ?? 0);

/**
 * Frames one outbound message: big-endian payload length, the tag, then the
 * payload's ASCII bytes. Throws {@link RangeError} above
 * {@link PQ_MAX_PAYLOAD_BYTES} rather than truncating, because a silently short
 * request would be a different message and the phone would refuse it with
 * nothing useful to point at.
 */
export const framePayload = (tag: PqFrameTag, payload: string): Uint8Array => {
  const bytes = new TextEncoder().encode(payload);
  if (bytes.length === 0 || bytes.length > PQ_MAX_PAYLOAD_BYTES) {
    throw new RangeError(`pq frame payload must be 1..${PQ_MAX_PAYLOAD_BYTES} bytes`);
  }
  const framed = new Uint8Array(PQ_FRAME_HEADER_BYTES + bytes.length);
  framed[0] = (bytes.length >>> 24) & 0xff;
  framed[1] = (bytes.length >>> 16) & 0xff;
  framed[2] = (bytes.length >>> 8) & 0xff;
  framed[3] = bytes.length & 0xff;
  framed[4] = TAG_BYTES[tag];
  framed.set(bytes, PQ_FRAME_HEADER_BYTES);
  return framed;
};

/**
 * Splits a framed buffer into write-sized pieces, in order. Every byte appears
 * exactly once; the last piece is whatever remains.
 */
export const chunkForWrite = (framed: Uint8Array): readonly Uint8Array[] => {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < framed.length; offset += PQ_WRITE_CHUNK_BYTES) {
    chunks.push(framed.subarray(offset, offset + PQ_WRITE_CHUNK_BYTES));
  }
  return chunks;
};

/**
 * Creates a reassembler for one inbound frame. See {@link PqReassembly} for the
 * terminal states; the decoder is strict, so a payload that is not valid UTF-8
 * is refused rather than replaced with substitution characters.
 */
export const createPqReassembler = (): PqReassembler => {
  let buffered = new Uint8Array(0);

  const append = (chunk: Uint8Array): void => {
    const grown = new Uint8Array(buffered.length + chunk.length);
    grown.set(buffered);
    grown.set(chunk, buffered.length);
    buffered = grown;
  };

  return {
    push: (chunk): PqReassembly => {
      append(chunk);
      if (buffered.length < PQ_FRAME_HEADER_BYTES) {
        return { kind: "incomplete" };
      }
      const declared = readLength(buffered);
      if (declared === 0) {
        return { kind: "invalid", reason: "empty-frame" };
      }
      if (declared > PQ_MAX_PAYLOAD_BYTES) {
        return { kind: "invalid", reason: "oversize" };
      }
      const total = PQ_FRAME_HEADER_BYTES + declared;
      if (buffered.length < total) {
        return { kind: "incomplete" };
      }
      if (buffered.length > total) {
        return { kind: "invalid", reason: "trailing" };
      }
      const tag = TAG_NAMES.get(buffered[4] ?? -1);
      if (!tag) {
        return { kind: "invalid", reason: "unknown-tag" };
      }
      try {
        return {
          kind: "complete",
          payload: new TextDecoder("utf-8", { fatal: true }).decode(
            buffered.subarray(PQ_FRAME_HEADER_BYTES),
          ),
          tag,
        };
      } catch {
        return { kind: "invalid", reason: "not-utf8" };
      }
    },
  };
};
