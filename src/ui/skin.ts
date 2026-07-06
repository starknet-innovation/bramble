/**
 * Swappable UI skin tokens for popup rendering.
 */
export const SKIN_TOKENS = [
  "--mc-accent",
  "--mc-accent-text",
  "--mc-bg",
  "--mc-border",
  "--mc-danger",
  "--mc-muted",
  "--mc-panel",
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

const hasExactSkinTokens = (skin: Skin): boolean => {
  const tokens = Reflect.ownKeys(skin.tokens);
  return (
    tokens.length === SKIN_TOKENS.length &&
    tokens.every((token) => typeof token === "string" && isSkinToken(token)) &&
    SKIN_TOKENS.every((token) => {
      const value = skin.tokens[token];
      return typeof value === "string" && value.length > 0;
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
