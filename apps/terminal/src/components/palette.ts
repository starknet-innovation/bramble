/**
 * Muted solid asset colors. Token/perp icons are seeded by list index so a given
 * symbol reads consistently without turning the interface into a color field.
 */
export const ICON_COLORS: readonly string[] = [
  "#47505c",
  "#5a4958",
  "#555044",
  "#4a5350",
  "#514b5d",
  "#5b4d47",
  "#46545a",
  "#554955",
];

/**
 * Returns the solid asset color at `index`, wrapping at the palette length.
 */
export const iconColor = (index: number): string =>
  ICON_COLORS[index % ICON_COLORS.length] ?? ICON_COLORS[0]!;
