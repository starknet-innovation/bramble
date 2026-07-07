/**
 * Compact stroke icons for the side panel UI.
 */

const ICONS = {
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4" />',
  alert:
    '<path d="M12 4 2.7 19.3a1 1 0 0 0 .9 1.7h16.8a1 1 0 0 0 .9-1.7z" /><path d="M12 10v4" /><path d="M12 17.5h.01" />',
  book: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" /><path d="M4 17a3 3 0 0 1 3-3h11" /><path d="M8 8h6" />',
  check: '<path d="m5 12 4 4L19 6" />',
  chevronLeft: '<path d="m14 6-6 6 6 6" />',
  chevronRight: '<path d="m10 6 6 6-6 6" />',
  copy: '<path d="M8 8h10v10H8z" /><path d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />',
  home: '<path d="m4 11 8-7 8 7" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-6h4v6" />',
  globe:
    '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" /><path d="M3 12h18" /><path d="M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z" />',
  link: '<path d="M9 15 15 9" /><path d="M11 6l1.5-1.5a4 4 0 0 1 5.7 5.7L16.7 11.7" /><path d="M13 18l-1.5 1.5a4 4 0 0 1-5.7-5.7L7.3 12.3" />',
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3" /><path d="M6 11h12v9H6z" />',
  receive: '<path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />',
  refresh:
    '<path d="M21 12a9 9 0 0 1-15.5 6.2" /><path d="M3 12A9 9 0 0 1 18.5 5.8" /><path d="M3 5v7h7" /><path d="M21 19v-7h-7" />',
  send: '<path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" />',
  settings:
    '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /><path d="M4 12h2" /><path d="M18 12h2" /><path d="m6.3 6.3 1.4 1.4" /><path d="m16.3 16.3 1.4 1.4" /><path d="m17.7 6.3-1.4 1.4" /><path d="m7.7 16.3-1.4 1.4" />',
  wallet: '<path d="M3 7h18v12H3z" /><path d="M3 7l3-4h12l3 4" /><path d="M16 13h2" />',
  x: '<path d="m6 6 12 12" /><path d="m18 6-12 12" />',
} as const;

/**
 * Names of icons available to side panel templates.
 */
export type IconName = keyof typeof ICONS;

/**
 * Renders an inline stroke icon with consistent sizing and accessibility.
 */
export const icon = (name: IconName): string =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">${ICONS[name]}</svg>`;
