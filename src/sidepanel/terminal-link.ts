/**
 * Stable public terminal origin opened by the wallet shortcut.
 *
 * Keeping this compile-time constant prevents untrusted page or wallet state
 * from choosing the external destination.
 */
export const TERMINAL_URL = "https://mc-wallet-terminal.vercel.app";

/**
 * Stable deep link to the Terminal's portfolio workspace.
 *
 * The hash is interpreted by the Terminal's client-side screen router, so the
 * destination works on the existing single-page deployment without a server
 * rewrite or an untrusted redirect parameter.
 */
export const TERMINAL_PORTFOLIO_URL = `${TERMINAL_URL}#portfolio`;
