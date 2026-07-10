/**
 * Icon gradient palette, ported from the approved mockup. Token/perp icons are
 * gradient squares seeded by list index so a given symbol reads consistently.
 */
export const ICON_GRADIENTS: readonly string[] = [
  "#2fcf8e,#1a9c68",
  "#4c8bf5,#2b5fb8",
  "#e8b64b,#b8860f",
  "#f0616d,#b8323d",
  "#a06bf5,#6a3cc0",
  "#f7931a,#b86a10",
  "#3ec7d4,#1f8a94",
  "#ec6ec4,#b03d8f",
];

/**
 * Returns the `background` CSS value for the icon gradient at `index`
 * (wrapping), matching the mockup's `g(i)` helper.
 */
export const iconGradient = (index: number): string => {
  const stops = ICON_GRADIENTS[index % ICON_GRADIENTS.length] ?? ICON_GRADIENTS[0];
  return `linear-gradient(135deg,${stops})`;
};
