import { describe, expect, it } from "vitest";
import { parseWalletActivity } from "./starkscan";

describe("Starkscan connected-wallet activity", () => {
  it("prefers indexed operation labels and falls back to transaction semantics", () => {
    const rows = parseWalletActivity({
      items: [
        {
          blockNumber: 100,
          timestampIso: "2026-07-24T13:42:00.000Z",
          txHash: "0x1",
          kinds: ["from", "token_in", "token_out"],
          counterparty: "0x1234567890abcdef",
          transferCount: 3,
          operationKind: "swap",
          operationLabel: "Swap on Ekubo",
          operationProtocolName: "Ekubo",
          finalityStatus: "ACCEPTED_ON_L1",
        },
        {
          blockNumber: 99,
          timestampIso: "2026-07-24T13:40:00.000Z",
          txHash: "0x2",
          kinds: ["from", "token_out"],
          counterparty: null,
          transferCount: 1,
          operationKind: null,
          operationLabel: null,
          operationProtocolName: null,
          finalityStatus: "ACCEPTED_ON_L2",
        },
      ],
      nextCursor: null,
    });

    expect(rows[0]).toMatchObject({
      detail: "Ekubo · 3 token movements · 0x12345…bcdef",
      finality: "final",
      title: "Swap on Ekubo",
    });
    expect(rows[1]).toMatchObject({
      detail: "1 token movement",
      finality: "pending",
      title: "Sent tokens",
    });
  });
});
