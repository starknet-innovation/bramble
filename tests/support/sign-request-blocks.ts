/**
 * Shared readers for the sign approval card's rendered blocks, used by every
 * sign-request suite so the "which block did this value land in" assertion has
 * exactly one implementation.
 *
 * `signRequestView` is the boundary under test: it returns the card body plus
 * whether the decoder could place every value on one side of the signature.
 * These helpers only parse that body — they assert nothing themselves.
 */
import { signRequestView } from "../../src/sidepanel/sign-request";

/** The not-signed block labels the card emits, one per decoded object. */
export const UNSIGNED_DOMAIN_LABEL = "Domain — shown by the site but NOT signed";
/** Message-side counterpart of {@link UNSIGNED_DOMAIN_LABEL}. */
export const UNSIGNED_MESSAGE_LABEL = "Message — shown by the site but NOT signed";
/** The signed block labels, which carry no payload-supplied text at all. */
export const SIGNED_DOMAIN_LABEL = "Domain";
/** Message-side counterpart of {@link SIGNED_DOMAIN_LABEL}. */
export const SIGNED_MESSAGE_LABEL = "Message";

/** Renders the card body for a payload, discarding the classification verdict. */
export const signHtml = (typedData: unknown): string => signRequestView(typedData).html;

/**
 * The rendered blocks in document order, as (eyebrow label, block body) pairs.
 * The class is matched loosely because the not-signed block carries an extra
 * modifier class; assertions are about which block a value lands in.
 */
export const signBlocks = (html: string): readonly (readonly [string, string])[] =>
  [
    ...html.matchAll(
      /<p class="eyebrow">([^<]*)<\/p><div class="sign-block[^"]*">(.*?)<\/div>(?=\s)/gs,
    ),
  ].map(([, label, body]) => [label ?? "", body ?? ""] as const);

/** The body of one labelled block, or undefined when the card emitted none. */
export const signBlockBody = (html: string, label: string): string | undefined =>
  signBlocks(html).find(([found]) => found === label)?.[1];
