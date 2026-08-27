/**
 * The M1 clipboard envelope is the contract between the panel and the phone
 * app, carried by hand through a copy and a paste. It must survive that trip
 * intact — base64url so nothing needs escaping, self-contained so no session
 * state is implied — and it must state its version, because a phone that cannot
 * read an envelope has to say so rather than guess at the fields.
 */
import { describe, expect, test } from "bun:test";
import { mlDsa65Fixture } from "@mc-wallet/testkit/ml-dsa-fixtures";
import type { MobilePqSignRequestSummary } from "../../../../src/popup/responses/responses";
import {
  encodeMobilePqSignEnvelope,
  MOBILE_PQ_ENVELOPE_VERSION,
} from "../../../../src/sidepanel/journeys/mobile/sign-envelope";

const device = mlDsa65Fixture(51);

const request: MobilePqSignRequestSummary = {
  accountId: "SN_MAIN:0xdef",
  deviceId: "phone-1",
  id: "mobile-pq-sign-7",
  messageHash: "0x1e240",
  publicKey: device.publicKey,
};

const decode = (envelope: string): Record<string, unknown> =>
  JSON.parse(atob(envelope.replaceAll("-", "+").replaceAll("_", "/"))) as Record<string, unknown>;

describe("encodeMobilePqSignEnvelope", () => {
  test("is base64url with no padding, so a copy carries it unescaped", () => {
    const envelope = encodeMobilePqSignEnvelope(request);
    expect(envelope).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain("=");
    expect(envelope).not.toContain("+");
    expect(envelope).not.toContain("/");
  });

  test("carries everything the phone needs and nothing it does not", () => {
    expect(decode(encodeMobilePqSignEnvelope(request))).toEqual({
      accountId: request.accountId,
      // The queue id is the correlation id: the response is matched back by it.
      correlationId: request.id,
      deviceId: request.deviceId,
      messageHash: request.messageHash,
      publicKey: request.publicKey,
      version: MOBILE_PQ_ENVELOPE_VERSION,
    });
  });

  test("is deterministic, so re-rendering the prompt does not change what was copied", () => {
    expect(encodeMobilePqSignEnvelope(request)).toBe(encodeMobilePqSignEnvelope(request));
  });

  test("distinct requests produce distinct envelopes", () => {
    const other = encodeMobilePqSignEnvelope({ ...request, messageHash: "0x1e241" });
    expect(other).not.toBe(encodeMobilePqSignEnvelope(request));
  });
});
