/**
 * What a refused sign-hash looks like through the shipped Starknet client
 * (mc-wallet 876). The Ledger Starknet app 2.4.0 to 2.4.3 answers
 * `Ins::SignHash` with 0x6985 (`UserCancelled`, legacy Ledger Rust SDK io) both
 * when the user rejects the hash and when Blind signing is off ("This
 * transaction cannot be clear-signed", then either button), after the same
 * 0x9000 for the path APDU. The pinned `@ledgerhq/hw-app-starknet` does not
 * accept 0x6985, so the transport throws and `signHash` reports ExecutionError.
 * The fake transport below applies the same status-list rule as
 * `@ledgerhq/hw-transport`'s `send`, so this runs the real library path.
 */
import { describe, expect, test } from "bun:test";
import { newStarknetClient } from "@bramble/ledger-browser/webhid";
import { ledgerSignHashOnDevice } from "@bramble/ledger-protocol/client";
import { ledgerMessage } from "@bramble/ledger-protocol/errors";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";

const PATH = ledgerAccountPath(0);
const INS_SIGN_HASH = 0x02;
const SW_USER_CANCELLED = 0x6985;

// A Starknet app that refuses every sign-hash with `signStatus`, counting the
// hash APDUs so a test can prove nothing asked the device twice.
const refusingApp = (signStatus: number) => {
  let hashApdus = 0;
  const transport = {
    close: async (): Promise<void> => undefined,
    send: async (
      _cla: number,
      ins: number,
      p1: number,
      _p2: number,
      _data?: Buffer,
      statusList: readonly number[] = [0x9000],
    ): Promise<Buffer> => {
      let sw = 0x6e01;
      if (ins === INS_SIGN_HASH && p1 === 0) sw = 0x9000;
      if (ins === INS_SIGN_HASH && p1 === 1) {
        hashApdus += 1;
        sw = signStatus;
      }
      if (!statusList.includes(sw)) {
        throw Object.assign(new Error(`Ledger device: UNKNOWN_ERROR (0x${sw.toString(16)})`), {
          name: "TransportStatusError",
          statusCode: sw,
        });
      }
      return Buffer.from([sw >> 8, sw & 0xff]);
    },
  };
  return { client: newStarknetClient(transport), hashApdus: () => hashApdus };
};

const refusalCode = async (signStatus: number) => {
  const app = refusingApp(signStatus);
  const error = await ledgerSignHashOnDevice(app.client, PATH, "0x1234").then(
    () => null,
    (thrown: unknown) => thrown,
  );
  return { app, error };
};

describe("a refused sign-hash from the Starknet app", () => {
  test("0x6985 (a reject or Blind signing off) shows the copy that covers both", async () => {
    const { error } = await refusalCode(SW_USER_CANCELLED);
    expect(error).toMatchObject({ code: "rejected-or-blind-signing-off", statusWord: 0x6f00 });
    expect(ledgerMessage("rejected-or-blind-signing-off")).toBe(
      "Rejected on your Ledger. If you didn't reject it, turn on Blind signing in the Starknet app settings, then retry.",
    );
  });

  test("UserRejected (0x6e04) keeps the rejection copy", async () => {
    const { error } = await refusalCode(0x6e04);
    expect(error).toMatchObject({ code: "rejected-on-device", statusWord: 0x6e04 });
    expect(ledgerMessage("rejected-on-device")).toBe(
      "You rejected the request on your Ledger. Nothing was submitted.",
    );
  });

  test("other statuses stay generic device errors", async () => {
    for (const status of [0x6e00, 0x6e01, 0x6e02]) {
      const { error } = await refusalCode(status);
      expect(error).toMatchObject({ code: "unexpected-device-error", statusWord: status });
    }
  });

  // Known limit: the library swallows a transport throw during the hash APDU
  // (e.g. a disconnect) into the same ExecutionError, so it lands here too.
  test("a transport failure during the hash APDU is indistinguishable", async () => {
    const transport = {
      close: async (): Promise<void> => undefined,
      send: async (_cla: number, _ins: number, p1: number): Promise<Buffer> => {
        if (p1 === 0) return Buffer.from([0x90, 0x00]);
        throw Object.assign(new Error("Device disconnected"), { name: "DisconnectedDevice" });
      },
    };
    const error = await ledgerSignHashOnDevice(newStarknetClient(transport), PATH, "0x1").then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toMatchObject({ code: "rejected-or-blind-signing-off", statusWord: 0x6f00 });
  });

  test("a refusal asks the device for the hash exactly once", async () => {
    for (const status of [SW_USER_CANCELLED, 0x6e04]) {
      const { app } = await refusalCode(status);
      expect(app.hashApdus()).toBe(1);
    }
  });
});
