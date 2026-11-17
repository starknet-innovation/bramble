/**
 * Deterministic account birds: an SVG bird assembled from parts, each part
 * read from the account's public address, drawn to sit inside the circular
 * `.avatar` clip.
 *
 * A Starknet address is already uniformly distributed, so the parts are read
 * straight out of the canonical address by mixed-radix division rather than
 * through a secondary hash. The order of the reads is the mapping people learn
 * their bird by: reordering a read or resizing a range redraws every account,
 * which is why `account-avatar.test.ts` pins the traits of fixed addresses.
 */

const GROUND_TONES = 4;
const BODY_TONES = 5;
const ACCENT_TONES = 4;

const SHAPES = [
  { headRadius: 6, rx: 9.5, ry: 8 },
  { headRadius: 6.5, rx: 10.5, ry: 8.8 },
  { headRadius: 5.5, rx: 9, ry: 7.2 },
] as const;

const TAILS = [
  "M9 19.5 L2.5 15 L4 23 Z",
  "M9 21 L2.5 24.5 L4.5 27 L10 24 Z",
  "M9 20 L3 16.5 L5 20.5 L2.5 21.5 L5 23.5 L3.5 26 L10 23 Z",
] as const;

const BEAKS = [
  "M27.5 11.5 L31.5 13.5 L27.5 15.5 Z",
  "M27.5 12 L33.5 13.8 L27.5 15 Z",
  "M27 11 Q32.5 11 31.5 15.5 Q29.5 14 27 15 Z",
] as const;

const CRESTS = [
  "",
  "M21 7.8 Q19.8 3.5 23.2 2.5 Q22.2 5 24 7.4 Z",
  "M19.5 8.5 L18 4 L21 7.2 L21.5 2.8 L23 7 L25.5 3.8 L24.8 8 Z",
  "M17.5 10 Q18.5 4 22 4.2 Q21.5 5.6 25 5 Q23.5 6.8 26.5 8 Z",
] as const;

const EYES = 3;
const FACINGS = 2;

const INK = "var(--bramble-account-avatar-ink)";
const PAPER = "var(--bramble-account-avatar-paper)";

/**
 * Part indices of one account bird. Every field is a small integer index into
 * a fixed table, so the shape carries nothing from the address but its choices.
 */
export type AccountBirdTraits = {
  readonly accent: number;
  readonly beak: number;
  readonly body: number;
  readonly crest: number;
  readonly eye: number;
  readonly ground: number;
  readonly mirrored: boolean;
  readonly shape: number;
  readonly tail: number;
};

const canonicalAddress = (address: string): bigint => {
  try {
    const value = BigInt(address);
    return value < 0n ? 0n : value;
  } catch {
    return 0n;
  }
};

/**
 * Reads the bird's parts from a public account address. Canonical spellings of
 * one address give the same traits; malformed or negative input gives the
 * zero address's traits. Pure, with no storage, network, or randomness.
 */
export const accountBirdTraits = (address: string): AccountBirdTraits => {
  let state = canonicalAddress(address);
  const pick = (range: number): number => {
    const value = Number(state % BigInt(range));
    state /= BigInt(range);
    return value;
  };
  return {
    ground: pick(GROUND_TONES),
    body: pick(BODY_TONES),
    accent: pick(ACCENT_TONES),
    shape: pick(SHAPES.length),
    tail: pick(TAILS.length),
    beak: pick(BEAKS.length),
    crest: pick(CRESTS.length),
    eye: pick(EYES),
    mirrored: pick(FACINGS) === 1,
  };
};

const eyeMarkup = (variant: number, headRadius: number): string => {
  const cx = 22 + headRadius * 0.35;
  const cy = 12.3;
  if (variant === 1) {
    return `<circle cx="${cx}" cy="${cy}" r="2.4" fill="${PAPER}" /><circle cx="${cx + 0.7}" cy="${cy}" r="1.3" fill="${INK}" />`;
  }
  if (variant === 2) {
    return `<circle cx="${cx}" cy="${cy + 0.3}" r="1.8" fill="${PAPER}" /><circle cx="${cx + 0.5}" cy="${cy + 0.5}" r="1" fill="${INK}" /><path d="M${cx - 2.2} ${cy - 1.6} L${cx + 2} ${cy - 2.6}" stroke="${PAPER}" stroke-width="1" stroke-linecap="round" />`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="1.8" fill="${PAPER}" /><circle cx="${cx + 0.5}" cy="${cy}" r="1" fill="${INK}" />`;
};

/**
 * Renders a deterministic bird from a public account address without storage,
 * network access, or runtime randomness. Canonical address spellings draw the
 * same bird; malformed input draws the stable zero-address bird and is never
 * reflected into SVG markup. This is a visual scanning aid, not a
 * collision-resistant security check: a matching bird is cheap to grind, so
 * every surface that confirms a recipient must keep showing the address.
 */
export const accountAvatar = (address: string): string => {
  const traits = accountBirdTraits(address);
  const shape = SHAPES[traits.shape] ?? SHAPES[0];
  const tail = TAILS[traits.tail] ?? TAILS[0];
  const beak = BEAKS[traits.beak] ?? BEAKS[0];
  const crest = CRESTS[traits.crest] ?? "";
  const ground = `var(--bramble-account-avatar-ground-${traits.ground})`;
  const body = `var(--bramble-account-avatar-body-${traits.body})`;
  const accent = `var(--bramble-account-avatar-accent-${traits.accent})`;
  const flip = traits.mirrored ? "translate(36 0) scale(-1 1) " : "";

  return `<svg class="avatar" viewBox="0 0 36 36" aria-hidden="true">
    <rect width="36" height="36" fill="${ground}" />
    <g class="avatar-bird" transform="${flip}translate(18 18) scale(1.14) translate(-17.5 -17)">
      <path d="M14.5 27 V30.5 M18.5 27 V30.5" fill="none" stroke="${body}" stroke-width="1.4" stroke-linecap="round" />
      <path d="${tail}" fill="${accent}" />
      ${crest ? `<path d="${crest}" fill="${accent}" />` : ""}
      <ellipse cx="16" cy="20" rx="${shape.rx}" ry="${shape.ry}" transform="rotate(-18 16 20)" fill="${body}" />
      <circle cx="22" cy="13" r="${shape.headRadius}" fill="${body}" />
      <ellipse cx="19" cy="22.5" rx="5.5" ry="4" fill="${PAPER}" fill-opacity="0.2" />
      <path d="M8.5 18.5 Q14.5 14.5 20.5 19 Q15 25 8.5 18.5 Z" fill="${accent}" />
      <path d="${beak}" fill="${accent}" />
      ${eyeMarkup(traits.eye, shape.headRadius)}
    </g>
  </svg>`;
};
