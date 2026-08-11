/**
 * Compact stroke icons shared by every wallet UI surface.
 */

const ICONS = {
  activity: '<circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" />',
  alert:
    '<path d="M12 4 2.7 19.3a1 1 0 0 0 .9 1.7h16.8a1 1 0 0 0 .9-1.7z" /><path d="M12 10v4" /><path d="M12 17.5h.01" />',
  arrowDown: '<path d="M12 5v14" /><path d="m6 13 6 6 6-6" />',
  book: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" /><path d="M4 17a3 3 0 0 1 3-3h11" /><path d="M8 8h6" />',
  briefcase:
    '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /><rect width="20" height="14" x="2" y="6" rx="2" />',
  building:
    '<rect width="16" height="20" x="4" y="2" rx="2" ry="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" /><path d="M12 10h.01" /><path d="M12 14h.01" /><path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" />',
  check: '<path d="m5 12 4 4L19 6" />',
  coins:
    '<circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="m16.71 13.88.7.71-2.82 2.82" />',
  chevronDown: '<path d="m6 10 6 6 6-6" />',
  chevronLeft: '<path d="m14 6-6 6 6 6" />',
  chevronRight: '<path d="m10 6 6 6-6 6" />',
  copy: '<path d="M8 8h10v10H8z" /><path d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />',
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
  gamepad:
    '<line x1="6" x2="10" y1="12" y2="12" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="15" x2="15.01" y1="13" y2="13" /><line x1="18" x2="18.01" y1="11" y2="11" /><rect width="20" height="12" x="2" y="6" rx="2" />',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />',
  graduationCap:
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" /><path d="M22 10v6" /><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />',
  home: '<path d="m4 11 8-7 8 7" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-6h4v6" />',
  image:
    '<path d="M4 5h16v14H4z" /><path d="M4 15l5-5 4 4 3-3 4 4" /><path d="M9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" />',
  info: '<circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7h.01" />',
  landmark:
    '<line x1="3" x2="21" y1="22" y2="22" /><line x1="6" x2="6" y1="18" y2="11" /><line x1="10" x2="10" y1="18" y2="11" /><line x1="14" x2="14" y1="18" y2="11" /><line x1="18" x2="18" y1="18" y2="11" /><polygon points="12 2 20 7 4 7" />',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />',
  piggyBank:
    '<path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z" /><path d="M2 9v1c0 1.1.9 2 2 2h1" /><path d="M16 11h.01" />',
  plus: '<path d="M12 5v14" /><path d="M5 12h14" />',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />',
  search: '<circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />',
  swap: '<path d="M7 4 3 8l4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" />',
  shuffle:
    '<path d="M3 6h3.5c4.5 0 6.5 12 11 12H21" /><path d="m17 14 4 4-4 4" /><path d="M3 18h3.5c1.8 0 3.1-1.9 4.3-4.2" /><path d="M13.2 8.2C14.4 6.9 15.8 6 17.5 6H21" /><path d="m17 2 4 4-4 4" />',
  terminal:
    '<rect width="18" height="14" x="3" y="5" rx="2" /><path d="m7 9 2 2-2 2" /><path d="M11 13h4" />',
  trendingUp:
    '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />',
  globe:
    '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" /><path d="M3 12h18" /><path d="M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z" />',
  externalLink:
    '<path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M17 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" />',
  link: '<path d="M9 15 15 9" /><path d="M11 6l1.5-1.5a4 4 0 0 1 5.7 5.7L16.7 11.7" /><path d="M13 18l-1.5 1.5a4 4 0 0 1-5.7-5.7L7.3 12.3" />',
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3" /><path d="M6 11h12v9H6z" />',
  monitor:
    '<rect x="2.5" y="3" width="19" height="14" rx="2.5" /><path d="M6 7.5h5" /><path d="M6 12.5h7" /><path d="M14 7.5h4" /><path d="M16 12.5h2" /><path d="m9.5 17-2 4" /><path d="m14.5 17 2 4" /><path d="M7.5 21h9" />',
  moreHorizontal:
    '<circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />',
  receive: '<path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />',
  qrCode:
    '<rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><path d="M15 15h2v2h-2zM19 15h2M15 19h2M19 19h2v2h-2z" />',
  refresh: '<path d="M20 11a8 8 0 1 0-.6 4" /><path d="M20 4v6h-6" />',
  send: '<path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" />',
  settings:
    '<path d="M4 8h9" /><path d="M17 8h3" /><path d="M4 16h3" /><path d="M11 16h9" /><circle cx="15" cy="8" r="2.2" /><circle cx="9" cy="16" r="2.2" />',
  wallet: '<path d="M3 7h18v12H3z" /><path d="M3 7l3-4h12l3 4" /><path d="M16 13h2" />',
  x: '<path d="m6 6 12 12" /><path d="m18 6-12 12" />',
} as const;

/**
 * Names of icons available to wallet templates.
 */
export type IconName = keyof typeof ICONS;

/**
 * Registered icon names in stable catalog order.
 */
export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[];

/**
 * Renders an inline stroke icon with consistent sizing. Icons are decorative;
 * the owning control or adjacent copy carries the accessible name.
 */
export const icon = (name: IconName): string =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">${ICONS[name]}</svg>`;
