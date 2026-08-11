/**
 * Framework-free SVG adaptation of Boring Avatars' Beam character.
 *
 * The original React component and its deterministic helpers are MIT-licensed;
 * attribution and the full license text live in ../../THIRD_PARTY_NOTICES.md.
 */

const AVATAR_SIZE = 36;

const canonicalAvatarName = (address: string): string => {
  try {
    const value = BigInt(address);
    return value < 0n ? "0x0" : `0x${value.toString(16)}`;
  } catch {
    return "0x0";
  }
};

const avatarHash = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const digitAt = (value: number, index: number): number => Math.floor(value / 10 ** index) % 10;

const avatarUnit = (value: number, range: number, index?: number): number => {
  const unit = value % range;
  return index !== undefined && digitAt(value, index) % 2 === 0 ? -unit : unit;
};

const avatarBoolean = (value: number, index: number): boolean => digitAt(value, index) % 2 === 0;

/**
 * Renders a deterministic Boring Avatars Beam character from a public account
 * address without React, storage, network access, or runtime randomness.
 * Canonical address spellings map to the same character; malformed input maps
 * to the stable zero-address fallback and is never reflected into SVG markup.
 * This is a visual scanning aid, not a collision-resistant security check.
 */
export const accountAvatar = (address: string): string => {
  const identity = avatarHash(canonicalAvatarName(address));
  const wrapperTone = identity % 4;
  const backgroundTone = (identity + 13) % 4;
  const faceInk =
    wrapperTone === 1 || wrapperTone === 2
      ? "var(--mc-account-avatar-ink)"
      : "var(--mc-account-avatar-paper)";
  const preTranslateX = avatarUnit(identity, 10, 1);
  const preTranslateY = avatarUnit(identity, 10, 2);
  const wrapperTranslateX = preTranslateX < 5 ? preTranslateX + AVATAR_SIZE / 9 : preTranslateX;
  const wrapperTranslateY = preTranslateY < 5 ? preTranslateY + AVATAR_SIZE / 9 : preTranslateY;
  const wrapperRotate = avatarUnit(identity, 360);
  const wrapperScale = 1 + avatarUnit(identity, AVATAR_SIZE / 12) / 10;
  const mouthOpen = avatarBoolean(identity, 2);
  const circular = avatarBoolean(identity, 1);
  const eyeSpread = avatarUnit(identity, 5);
  const mouthSpread = avatarUnit(identity, 3);
  const faceRotate = avatarUnit(identity, 10, 3);
  const faceTranslateX =
    wrapperTranslateX > AVATAR_SIZE / 6 ? wrapperTranslateX / 2 : avatarUnit(identity, 8, 1);
  const faceTranslateY =
    wrapperTranslateY > AVATAR_SIZE / 6 ? wrapperTranslateY / 2 : avatarUnit(identity, 7, 2);

  return `<svg class="avatar" viewBox="0 0 36 36" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <rect width="36" height="36" fill="var(--mc-account-avatar-${backgroundTone})" />
    <rect class="avatar-head" width="36" height="36" rx="${circular ? 36 : 6}" transform="translate(${wrapperTranslateX} ${wrapperTranslateY}) rotate(${wrapperRotate} 18 18) scale(${wrapperScale})" fill="var(--mc-account-avatar-${wrapperTone})" />
    <g class="avatar-character" transform="translate(${faceTranslateX} ${faceTranslateY}) rotate(${faceRotate} 18 18)" fill="${faceInk}" stroke="${faceInk}" stroke-linecap="round">
      ${
        mouthOpen
          ? `<path class="avatar-mouth" d="M15 ${19 + mouthSpread}c2 1 4 1 6 0" fill="none" />`
          : `<path class="avatar-mouth" d="M13 ${19 + mouthSpread}a1 .75 0 0 0 10 0" stroke="none" />`
      }
      <g class="avatar-eyes" stroke="none">
        <rect x="${14 - eyeSpread}" y="14" width="1.5" height="2" rx="1" />
        <rect x="${20 + eyeSpread}" y="14" width="1.5" height="2" rx="1" />
      </g>
    </g>
  </svg>`;
};
