/**
 * The Bramble mark, as an inline filled silhouette.
 *
 * Not part of the icon registry: those are stroke glyphs drawn by `.icon`
 * (`fill: none; stroke: currentColor`), so a filled shape is invisible under
 * that rule. This is a brand mark rather than a UI glyph, so it carries its own
 * `fill="currentColor"` and takes the surrounding text colour — the same
 * treatment the letter monogram it replaced had.
 *
 * Inline rather than a reference to `icons/icon-128.png` because these templates
 * also render in UI Lab and Storybook, which serve no `icons/` path; an asset URL
 * would resolve in the extension and 404 everywhere else.
 *
 * Traced from the 128px raster at `docs/chrome-web-store/assets/icon-source.png`,
 * so the geometry approximates the artwork rather than reproducing a vector. It
 * agrees with the source on 98.1 percent of pixels and is indistinguishable from
 * it at the sizes used here; replace it if the true vector arrives.
 */
export const BRAMBLE_MARK =
  '<svg class="brand-glyph" aria-hidden="true" viewBox="0 0 128 128"><path fill="currentColor" d="M75 21L83 21L83 22L87 22L87 23C87 23 87.7 21.6 91 24C94.3 26.4 98 31 98 31L98 33L100 34L100 36L102 38L102 41L103 41L103 45L104 45L104 51L105 51L105 63L104 63L104 68L103 68L103 71L102 71L102 74L101 74C101 74 103.6 73.2 100 78C96.4 82.8 89 90 89 90L87 90L86 92L84 92C84 92 84.1 93.1 82 94C79.9 94.9 77 95 77 95L77 97L83 103L89 103L89 106L88 107L68 107L67 103L72 103L73 102L70 98L55 96L55 95L52 95L52 94L49 94L49 93L45 93L45 94L40 95L40 96L38 96L36 98L33 98L33 99L25 98L24 95L23 95L24 88C24 88 24.6 89.1 27 87C29.4 84.9 32 81 32 81L34 81L40 74L42 74L47 68L49 68L54 62L56 62L62 55L64 55L69 50L72 50L72 49L79 50L86 57L86 59L88 61C88 61 89.1 66.3 87 72C84.9 77.7 81 80 81 80L79 80L78 82L76 82L74 84L60 85L60 84L56 83L54 86L58 87L58 88L62 88L62 89L73 88L73 87L76 87L76 86C76 86 78.7 86.1 82 84C85.3 81.9 87 79 87 79L87 77L89 76L90 71L91 71L91 59L90 59L89 55L87 54L87 52L85 50L83 50L82 48L80 48L76 45L71 45L69 48L67 48L67 44L66 44L66 42L64 40L64 37L63 37L63 33L64 33C64 33 63.2 31 65 28C66.8 25 67 24.8 70 23C73 21.2 75 22 75 22L75 21ZM72 34L72 38L76 38L77 35L72 34Z"/></svg>';
