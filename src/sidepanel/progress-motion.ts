/**
 * Framework-free adaptation of Amicro's Liquid Dots progress treatment.
 * The MIT attribution is retained in ../../THIRD_PARTY_NOTICES.md.
 *
 * IDs are deliberately closed over known wallet surfaces: the matching SVG
 * filter URL is selected by static CSS, never assembled from untrusted input.
 */
export type LiquidDotsId = "approval" | "ledger" | "send";

/**
 * Renders the visible Liquid Dots mark. The surrounding status region owns the
 * accessible progress copy, so the decorative motion stays hidden.
 */
export const liquidDots = (id: LiquidDotsId, compact = false): string => `
  <span class="liquid-dots${compact ? " liquid-dots-compact" : ""}" data-liquid-dots="${id}" aria-hidden="true">
    <span class="liquid-dot"></span>
    <span class="liquid-dot"></span>
  </span>`;

/**
 * Renders the SVG goo filter paired with one static Liquid Dots surface. It
 * contains no dynamic or secret material and occupies no visual layout space.
 */
export const liquidDotsFilter = (id: LiquidDotsId): string => `
  <svg class="liquid-dots-defs" aria-hidden="true">
    <defs>
      <filter id="mc-liquid-dots-${id}">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
        <feBlend in="SourceGraphic" in2="goo" />
      </filter>
    </defs>
  </svg>`;
