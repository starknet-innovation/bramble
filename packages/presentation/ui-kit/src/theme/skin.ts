/**
 * Swappable UI skin tokens for popup rendering.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";

/**
 * CSS variable tokens every replaceable skin must provide.
 */
export const SKIN_TOKENS = [
  "--mc-accent",
  "--mc-accent-text",
  "--mc-account-avatar-0",
  "--mc-account-avatar-1",
  "--mc-account-avatar-2",
  "--mc-account-avatar-3",
  "--mc-account-avatar-ink",
  "--mc-account-avatar-paper",
  "--mc-bg",
  "--mc-border",
  "--mc-danger",
  "--mc-elevated",
  "--mc-muted",
  "--mc-panel",
  "--mc-positive",
  "--mc-sunken",
  "--mc-text",
] as const;

/**
 * CSS custom property names required by every popup skin.
 */
export type SkinToken = (typeof SKIN_TOKENS)[number];

/**
 * Replaceable popup skin contract.
 */
export type Skin = {
  readonly name: string;
  readonly tokens: Readonly<Record<SkinToken, string>>;
};

const isSkinToken = (value: string): value is SkinToken =>
  SKIN_TOKENS.some((token) => token === value);

const hasExactSkinTokens = (skin: unknown): skin is Skin => {
  if (
    !isRecord(skin) ||
    !hasOnlyKnownKeys(skin, ["name", "tokens"]) ||
    typeof skin["name"] !== "string" ||
    skin["name"].trim().length === 0 ||
    !isRecord(skin["tokens"])
  ) {
    return false;
  }

  const skinTokens = skin["tokens"];
  const tokens = Reflect.ownKeys(skinTokens);
  return (
    tokens.length === SKIN_TOKENS.length &&
    tokens.every((token) => typeof token === "string" && isSkinToken(token)) &&
    SKIN_TOKENS.every((token) => {
      const descriptor = Object.getOwnPropertyDescriptor(skinTokens, token);
      return (
        descriptor?.enumerable === true &&
        "value" in descriptor &&
        typeof descriptor.value === "string" &&
        descriptor.value.length > 0
      );
    })
  );
};

/**
 * Applies skin tokens to an explicit UI root.
 */
export const applySkin = (skin: Skin, root: HTMLElement): void => {
  if (!hasExactSkinTokens(skin)) {
    throw new Error("Invalid skin token set");
  }

  for (const token of SKIN_TOKENS) {
    root.style.setProperty(token, skin.tokens[token]);
  }
};
