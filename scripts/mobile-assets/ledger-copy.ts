/**
 * The Ledger catalog as the mobile apps show it: the extension's `LEDGER_MESSAGES`, with the
 * sentences that assume a USB cable or a browser reworded for a Ledger on Bluetooth. Each override
 * states the same fact and the same next step; the extension's catalog is unchanged.
 */
import { LEDGER_MESSAGES } from "@bramble/ledger-protocol/errors";

/** Mobile's Bluetooth wording, by rejection code. */
const BLUETOOTH_WORDING: Partial<Record<keyof typeof LEDGER_MESSAGES, string>> = {
  "device-busy":
    "Something else is using your Ledger. Close other wallet apps and Ledger Live, then try again.",
  "picker-cancelled": "No Ledger was chosen. Unlock it, open the Starknet app, then try again.",
  replug: "Couldn't reach your Ledger. Keep it unlocked and nearby, then try again.",
  "unexpected-device-error":
    "Something went wrong talking to your Ledger. Unlock it, open the Starknet app, close other wallet apps, then try again.",
  "webhid-unavailable": "This device can't connect to a Ledger over Bluetooth.",
};

/** The catalog the mobile `FriendlyErrorRules.ledgerMessages` tables are generated from. */
export const MOBILE_LEDGER_MESSAGES: Readonly<Record<string, string>> = {
  ...LEDGER_MESSAGES,
  ...BLUETOOTH_WORDING,
};
