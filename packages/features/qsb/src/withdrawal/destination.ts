/**
 * Where a QSB withdrawal may pay: one Bitcoin mainnet address of a standard
 * single-key or script type, and the output script Bramble derives from it
 * itself. Neither qsb-app's client nor its server restricts the type or
 * checks dust, and `btc.Address(NETWORK).decode` accepts P2A (anyone can
 * spend), so Bramble does both here. The payout is fixed before a search that
 * takes hours and can never change after disclosure, so anything doubtful is
 * refused up front.
 *
 * Accepted: P2WPKH, P2TR, P2WSH, P2PKH and P2SH, each in its canonical
 * encoding (the text must round-trip, so a mixed- or upper-case bech32 copy
 * is refused rather than normalized). Dust thresholds are Bitcoin Core's for
 * each type at its default relay rate. Pure.
 */
import { bytesToHex } from "@bramble/core/hex";
import { Address, NETWORK, OutScript } from "@scure/btc-signer";

/** Bitcoin Core's dust threshold per accepted output type, in satoshis. */
export const QSB_DESTINATION_DUST_SAT = {
  pkh: 546,
  sh: 540,
  tr: 330,
  wpkh: 294,
  wsh: 330,
} as const;

type DestinationType = keyof typeof QSB_DESTINATION_DUST_SAT;

// The coordinator's `destination` bounds (`withdrawalSchema`).
const MIN_ADDRESS_LENGTH = 14;
const MAX_ADDRESS_LENGTH = 100;

/** A checked destination: its address, its output script and its dust floor. */
export type QsbDestination = {
  readonly address: string;
  readonly dustSat: number;
  readonly outputScript: string;
};

const isDestinationType = (type: string): type is DestinationType =>
  Object.hasOwn(QSB_DESTINATION_DUST_SAT, type);

/**
 * The destination `address` names, or null unless it is a canonical mainnet
 * address of an accepted type whose script Bramble could derive.
 */
export const qsbDestination = (address: unknown): QsbDestination | null => {
  if (
    typeof address !== "string" ||
    address.length < MIN_ADDRESS_LENGTH ||
    address.length > MAX_ADDRESS_LENGTH
  ) {
    return null;
  }
  try {
    const decoded = Address(NETWORK).decode(address);
    if (!isDestinationType(decoded.type) || Address(NETWORK).encode(decoded) !== address) {
      return null;
    }
    return {
      address,
      dustSat: QSB_DESTINATION_DUST_SAT[decoded.type],
      outputScript: bytesToHex(OutScript.encode(decoded)),
    };
  } catch {
    return null;
  }
};
