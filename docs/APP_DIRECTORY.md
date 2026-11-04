# App directory

Bramble's app directory lists Starknet apps that the Starknet Foundation has reviewed by hand.
The list is bundled with the extension (`packages/features/permissions/src/app-directory-data.ts`)
and changes only through a reviewed pull request and a release. The directory adds no network
traffic: the extension never fetches a listing, an icon or a manifest.

What a listing does in the wallet:

- The app appears on the **App directory** screen for each network it declares. The screen and
  its menu row are hidden while a network has no listed app.
- A connection or signing request from the app's exact origin shows **Listed app: _name_** under
  the site. The background decides this from the validated sender, never from anything the page
  says about itself, and never for an origin on the phishing blocklist.
- A transaction request from a listed app that calls a contract its listing does not declare for
  that network is flagged on the approval card.
- Activity rows record the requesting site. A row from a listed app shows a listed mark, decided
  when the row is shown, so delisting an app also clears its past rows.

## Admission standard

An app must meet **all four** standards. SNF's judgement comes on top of them, never in place of
them.

1. **Standard wallet connection.** The app connects through get-starknet / wallet-standard
   discovery and works with Bramble's provider methods, with no wallet-specific workarounds.
2. **Verified contracts.** Every contract the app asks users to call is declared in the listing,
   per network, and has its source verified on a public explorer.
3. **Domain manifest.** The app serves `/.well-known/starknet-app.json` from its own https origin,
   declaring its name, networks and contracts, and it must match the listing:

   ```json
   {
     "name": "Example DEX",
     "chains": {
       "SN_MAIN": { "contracts": ["0x…"] },
       "SN_SEPOLIA": { "contracts": ["0x…"] }
     }
   }
   ```

4. **Audit.** A public audit report covers the contracts that hold user funds, linked from the
   listing. SNF checks the report by hand at admission.

## Applying

Open a pull request that adds one entry to `LISTED_APPS`:

```ts
{
  id: "example-dex",                    // lowercase slug, unique
  name: "Example DEX",                  // 1-40 characters
  origin: "https://app.example.xyz",    // exact origin: https, host, optional port; no path or wildcard
  category: "defi",                     // defi | gaming | infrastructure | nft | payments | social
  chains: {
    SN_MAIN: { contracts: ["0x…"] },    // canonical non-zero felts (lowercase, no leading zeros)
  },
  audit: "https://…",                   // public https link to the audit report
},
```

Include in the pull request description:

- the explorer link for each declared contract, showing verified source;
- the audit report link and which contracts it covers;
- confirmation that the manifest is live at the origin.

CI runs the schema checks (`packages/features/permissions/tests/app-directory.test.ts`): a
malformed entry, a repeated id or origin, a non-https origin or a contract that is not a canonical
felt fails the build. A maintainer then runs the manifest check, which is dev-only and never part
of CI because CI must not depend on applicants' sites:

```bash
bun run scripts/check-app-manifest.ts example-dex
```

An SNF maintainer approves the pull request. A listing ships with the next release.

## Delisting

A delisted app's origin moves from `LISTED_APPS` to `REVOKED_APPS`. Bramble then warns on the
next connection or signing request from that origin. It does not revoke the user's existing grant:
that stays the user's decision on the Connected sites screen. A delisting reaches users when they
update.
