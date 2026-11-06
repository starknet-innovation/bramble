/**
 * Bundled official token logos for the common Starknet tokens as inline SVG,
 * keyed by the canonical (64-hex, zero-padded) contract address. Each value is
 * a TRUSTED STATIC CONSTANT: hand-verified, optimized vector markup sourced from
 * the tokens' official brand assets. Rendering vectors (instead of the former
 * 128px rasters) keeps the marks crisp on high-DPI displays, and — like the old
 * data URIs — needs no network at render time, so the wallet never leaks token
 * holdings to a logo CDN. Callers embed these verbatim; token-supplied data is
 * NEVER interpolated into the markup. Sources: ETH/USDT/DAI/WBTC from the
 * CoinGecko-derived cryptocurrency-icons set, USDC and wstETH from the Circle
 * and Lido brand marks, STRK from the official Starknet token logo.
 */

// One SVG per line (keeps this file well within the 500-line budget). Each mark
// is a full-bleed circle sized to 40x40 and clipped by the .token-logo frame.
// Circle's USDC brand mark, shared by native USDC (CCTP) and the StarkGate-
// bridged USDC.e — both are the same brand, distinguished in copy by
// name/symbol/address rather than by mark.
const USDC_LOGO_SVG =
  '<svg class="token-logo" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="m20 40a20 20 0 1 0 -20-20 19.952 19.952 0 0 0 20 20z" fill="#2775ca"/><g fill="#fff"><path d="m727.837 521.33c0-2.917-1.75-3.917-5.25-4.333-2.5-.333-3-1-3-2.167s.833-1.917 2.5-1.917c1.5 0 2.333.5 2.75 1.75a.627.627 0 0 0 .583.417h1.333a.57.57 0 0 0 .583-.583v-.083a4.163 4.163 0 0 0 -3.75-3.417v-2c0-.333-.25-.583-.667-.667h-1.25c-.333 0-.583.25-.667.667v1.917c-2.5.333-4.083 2-4.083 4.083 0 2.75 1.667 3.833 5.167 4.25 2.333.417 3.083.917 3.083 2.25s-1.167 2.25-2.75 2.25c-2.167 0-2.917-.917-3.167-2.167a.609.609 0 0 0 -.583-.5h-1.417a.57.57 0 0 0 -.583.583v.083c.333 2.083 1.667 3.583 4.417 4v2c0 .333.25.583.667.667h1.247c.333 0 .583-.25.667-.667v-2c2.5-.417 4.167-2.167 4.167-4.417z" transform="translate(-702.337 -498.163)"/><path d="m258.756 317.753a12.47 12.47 0 0 1 0-23.417.837.837 0 0 0 .5-.833v-1.167a.633.633 0 0 0 -.5-.667.5.5 0 0 0 -.333.083 15 15 0 0 0 0 28.583.507.507 0 0 0 .75-.333c.083-.083.083-.167.083-.333v-1.169a1.11 1.11 0 0 0 -.5-.747zm8.833-26a.507.507 0 0 0 -.75.333c-.083.083-.083.167-.083.333v1.167a1.105 1.105 0 0 0 .5.833 12.47 12.47 0 0 1 0 23.417.837.837 0 0 0 -.5.833v1.167a.633.633 0 0 0 .5.667.5.5 0 0 0 .333-.083 15.06 15.06 0 0 0 0-28.667z" transform="translate(-243.006 -285.837)"/></g></svg>';

const TOKEN_LOGOS_SVG: Readonly<Record<string, string>> = {
  // wstETH
  "0x0057912720381af14b0e5c87aa4718ed5e527eab60b3801ebf702ab09139e38b":
    '<svg class="token-logo" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path data-name="Path 4941" d="M40 20A20 20 0 1 1 20 0a20 20 0 0 1 20 20Z" fill="#00a3ff" fill-rule="evenodd"/><g fill="#fff"><path data-name="Path 4976" d="m10.925 17.448-.239.358a10.694 10.694 0 0 0 1.553 13.493A10.644 10.644 0 0 0 20 34.523Z"/><path data-name="Path 4977" d="m20 22.583-9.075-5.254L20 34.523Z" opacity=".6"/><path data-name="Path 4978" d="m29.075 17.448.239.358a10.694 10.694 0 0 1-1.552 13.492A10.84 10.84 0 0 1 20 34.522Z" opacity=".6"/><path data-name="Path 4979" d="m20 22.583 9.075-5.254L20 34.523Z" opacity=".2"/><path data-name="Path 4980" d="M20 11v8.955l7.881-4.418Z" opacity=".2"/><path data-name="Path 4981" d="m20 11-7.881 4.537L20 19.955Z" opacity=".6"/><path data-name="Path 4982" d="m20 3.478-7.881 12.06L20 11.001Z"/><path data-name="Path 4983" d="m20 11 7.881 4.537L20 3.478Z" opacity=".6"/></g></svg>',
  // ETH
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7":
    '<svg class="token-logo" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 32 32" fill="none" aria-hidden="true"><g fill="none" fill-rule="evenodd"><circle cx="16" cy="16" r="16" fill="#627EEA"/><g fill="#FFF" fill-rule="nonzero"><path fill-opacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path d="M16.498 4L9 16.22l7.498-3.35z"/><path fill-opacity=".602" d="M16.498 21.968v6.027L24 17.616z"/><path d="M16.498 27.995v-6.028L9 17.616z"/><path fill-opacity=".2" d="M16.498 20.573l7.497-4.353-7.497-3.348z"/><path fill-opacity=".602" d="M9 16.22l7.498 4.353v-7.701z"/></g></g></svg>',
  // USDC (native, Circle CCTP)
  "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb": USDC_LOGO_SVG,
  // USDC.e (StarkGate-bridged USDC) — same Circle brand mark
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": USDC_LOGO_SVG,
  // USDT
  "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8":
    '<svg class="token-logo" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 32 32" fill="none" aria-hidden="true"><g fill="none" fill-rule="evenodd"><circle cx="16" cy="16" r="16" fill="#26A17B"/><path fill="#FFF" d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.658 0-.809 2.902-1.486 6.79-1.66v2.644c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.643c3.88.173 6.775.85 6.775 1.658 0 .81-2.895 1.485-6.775 1.657m0-3.59v-2.366h5.414V7.819H8.595v3.608h5.414v2.365c-4.4.202-7.709 1.074-7.709 2.118 0 1.044 3.309 1.915 7.709 2.118v7.582h3.913v-7.584c4.393-.202 7.694-1.073 7.694-2.116 0-1.043-3.301-1.914-7.694-2.117"/></g></svg>',
  // DAI
  "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3":
    '<svg class="token-logo" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 32 32" fill="none" aria-hidden="true"><g fill="none" fill-rule="evenodd"><circle fill="#F4B731" fill-rule="nonzero" cx="16" cy="16" r="16"/><path d="M9.277 8h6.552c3.985 0 7.006 2.116 8.13 5.194H26v1.861h-1.611c.031.294.047.594.047.898v.046c0 .342-.02.68-.06 1.01H26v1.86h-2.08C22.767 21.905 19.77 24 15.83 24H9.277v-5.131H7v-1.86h2.277v-1.954H7v-1.86h2.277V8zm1.831 10.869v3.462h4.72c2.914 0 5.078-1.387 6.085-3.462H11.108zm11.366-1.86H11.108v-1.954h11.37c.041.307.063.622.063.944v.045c0 .329-.023.65-.067.964zM15.83 9.665c2.926 0 5.097 1.424 6.098 3.528h-10.82V9.666h4.72z" fill="#FFF"/></g></svg>',
  // WBTC
  "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac":
    '<svg class="token-logo" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 32 32" fill="none" aria-hidden="true"><g fill="none"><circle fill="#201A2D" cx="16" cy="16" r="16"/><g fill="#FFF"><path d="M22.818 9.586l-.6.6a8.494 8.494 0 010 11.464l.6.6a9.352 9.352 0 000-12.678v.014zM10.2 9.638a8.494 8.494 0 0111.464 0l.6-.6a9.352 9.352 0 00-12.678 0l.614.6zm-.562 12.018a8.494 8.494 0 010-11.458l-.6-.6a9.352 9.352 0 000 12.678l.6-.62zm12.018.554a8.494 8.494 0 01-11.464 0l-.6.6a9.352 9.352 0 0012.678 0l-.614-.6zm-1.942-8.286c-.12-1.252-1.2-1.672-2.566-1.8V10.4h-1.056v1.692h-.844V10.4H14.2v1.736h-2.142v1.13s.78-.014.768 0a.546.546 0 01.6.464v4.752a.37.37 0 01-.128.258.366.366 0 01-.272.092c.014.012-.768 0-.768 0l-.2 1.262h2.122v1.764h1.056V20.12h.844v1.73h1.058v-1.744c1.784-.108 3.028-.548 3.184-2.218.126-1.344-.506-1.944-1.516-2.186.614-.302.994-.862.908-1.778zm-1.48 3.756c0 1.312-2.248 1.162-2.964 1.162v-2.328c.716.002 2.964-.204 2.964 1.166zm-.49-3.28c0 1.2-1.876 1.054-2.472 1.054v-2.116c.596 0 2.472-.188 2.472 1.062z"/><path d="M15.924 26.852C9.89 26.851 5 21.959 5 15.925 5 9.892 9.892 5 15.925 5c6.034 0 10.926 4.89 10.927 10.924a10.926 10.926 0 01-10.928 10.928zm0-21c-5.559.004-10.062 4.513-10.06 10.072.002 5.559 4.51 10.064 10.068 10.064 5.559 0 10.066-4.505 10.068-10.064A10.068 10.068 0 0015.924 5.852z"/></g></g></svg>',
  // STRK
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d":
    '<svg class="token-logo" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 158 158" fill="none" aria-hidden="true"><path fill="#0C0C4F" fill-rule="evenodd" clip-rule="evenodd" d="M0,79c0,43.6,35.4,79,79,79c43.6,0,79-35.4,79-79c0-43.6-35.4-79-79-79C35.4,0,0,35.4,0,79z"/><path fill="#FAFAFA" fill-rule="evenodd" clip-rule="evenodd" d="M44.2,60.4l2-6c0.4-1.2,1.4-2.2,2.6-2.6l6.1-1.9c0.8-0.3,0.8-1.4,0-1.7l-6-2c-1.2-0.4-2.2-1.4-2.6-2.6l-1.9-6.1c-0.3-0.8-1.4-0.8-1.7,0l-2,6c-0.4,1.2-1.4,2.2-2.6,2.6L32,48.1c-0.8,0.3-0.8,1.4,0,1.7l6,2c1.2,0.4,2.2,1.4,2.6,2.6l1.9,6.1C42.7,61.2,43.9,61.2,44.2,60.4z"/><path fill="#EC796B" fill-rule="evenodd" clip-rule="evenodd" d="M139.8,56.9c-2.5-2.8-6.4-4.4-10.2-5c-3.8-0.6-7.8-0.6-11.6,0.1c-7.6,1.3-14.6,4.4-20.6,8.3c-3.1,1.9-5.8,4.1-8.6,6.4c-1.3,1.1-2.6,2.4-3.8,3.5l-3.5,3.4c-3.8,3.9-7.5,7.5-11.1,10.5c-3.6,3-7,5.2-10.3,6.8c-3.3,1.6-6.9,2.5-11.5,2.7c-4.6,0.2-10-0.7-15.8-2c-5.8-1.4-12-3.3-18.8-5c2.4,6.6,6,12.5,10.6,17.9c4.7,5.3,10.5,10.1,18,13.2c7.4,3.2,16.7,4.4,25.4,2.6c8.7-1.7,16.4-5.7,22.5-10.4c6.2-4.7,11.2-10.1,15.4-15.7c1.2-1.5,1.8-2.4,2.6-3.6l2.3-3.5c1.6-2.1,3.1-4.6,4.7-6.7c3.1-4.4,6.2-8.9,9.9-12.9c1.8-2.1,3.7-4.1,6-6c1.1-0.9,2.3-1.8,3.7-2.7C136.6,58.1,138.1,57.4,139.8,56.9z"/><path fill="#FAFAFA" fill-rule="evenodd" clip-rule="evenodd" d="M139.8,56.9c-2.7-6.8-7.7-12.5-14.4-16.7c-6.6-4.2-15.9-6.3-25-4.5c-4.5,0.9-8.9,2.6-12.7,4.8c-3.8,2.2-7.3,4.9-10.2,7.8c-1.5,1.4-2.8,3-4.2,4.5l-3.5,4.4l-5.3,7.1c-6.8,9.1-14.2,19.9-26.2,23c-11.8,3.1-17,0.4-24.2-0.8c1.3,3.4,3,6.7,5.2,9.6c2.2,3,4.7,5.8,7.9,8.2c1.6,1.1,3.3,2.3,5.2,3.2c1.9,0.9,3.9,1.7,6.1,2.4c4.3,1.2,9.2,1.6,13.9,1c4.7-0.6,9.2-2.1,13.1-4.1c4-2,7.4-4.4,10.5-6.9c6.1-5.1,10.9-10.7,14.9-16.4c2-2.8,3.9-5.7,5.6-8.6l2-3.4c0.6-1,1.2-2,1.9-3c2.5-3.8,5-6.8,8-9.1c3-2.3,7.1-4.1,12.6-4.5C126.5,54.6,132.9,55.3,139.8,56.9z"/><path fill="#EC796B" fill-rule="evenodd" clip-rule="evenodd" d="M110.1,113.1c0,5,4,9,9,9c5,0,9-4,9-9c0-5-4-9-9-9C114.1,104.1,110.1,108.1,110.1,113.1z"/></svg>',
};

/**
 * The canonical (64-hex, zero-padded) addresses that ship a bundled logo, read
 * from the logo map itself so a generator mirroring the set onto another
 * platform (the mobile apps) can never keep a second list that drifts.
 */
export const bundledTokenLogoAddresses = (): readonly string[] => Object.keys(TOKEN_LOGOS_SVG);

/**
 * Returns the inline SVG logo for a token address, or null when the token is
 * not one of the bundled common tokens (callers fall back to a letter badge).
 * The returned string is a trusted static constant safe to embed as HTML.
 */
export const tokenLogoSvg = (address: string): string | null => {
  let canonical: string;
  try {
    canonical = `0x${BigInt(address.trim().toLowerCase()).toString(16).padStart(64, "0")}`;
  } catch {
    return null;
  }
  return TOKEN_LOGOS_SVG[canonical] ?? null;
};
