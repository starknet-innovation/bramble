/**
 * Connected-sites layer of the side panel stylesheet: each site is a
 * disclosure row whose body lists the accounts it was given, each with its
 * own Disconnect, above the site-wide "Disconnect all".
 */
import { SPACE } from "@bramble/ui-kit/tokens";

/**
 * Connected-sites stylesheet fragment consumed by SIDEPANEL_STYLES.
 */
export const CONNECTED_SITES_STYLES = `
  .connected-sites { display: grid; gap: ${SPACE.sm}; }
  /* Origins are long and unbroken; wrap them rather than push the chevron
     out of a 320px panel. */
  details.connected-site > summary { padding-block: ${SPACE.sm}; }
  details.connected-site > summary .menu-copy strong {
    overflow-wrap: anywhere;
    text-wrap: wrap;
  }
  /* The disclosure body already insets the account rows; dropping their own
     inline padding keeps name and Disconnect on one line at 320px. */
  .connected-site .address-book > li { padding-inline: 0; }
  .connected-site .address-book > li + li::before { left: 0; }
  .connected-site .disclosure-body > button { justify-self: start; }
`;
