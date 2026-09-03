# Bramble website

Static public website for Bramble, the Starknet browser-extension wallet.

```bash
bun run --filter @mc-wallet/website dev
bun run --filter @mc-wallet/website check
```

The Vite build writes `apps/website/dist/` with real `/`, `/docs/`, and `/support/` entry
documents. Set `VITE_CHROME_STORE_URL` to the exact Bramble listing URL before deployment. Until
that URL is configured, download links lead to the Chrome Web Store root instead of guessing an
item identifier.
