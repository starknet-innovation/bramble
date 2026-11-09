import { BRAMBLE_MARK } from "@bramble/ui-kit/brand-mark";
import { ICON_NAMES, icon } from "@bramble/ui-kit/icons";
import { accountAvatar, tokenGlyph } from "@bramble/wallet-ui/lab";
import type { Meta } from "@storybook/html-vite";
import {
  LEDGER_ADDRESS,
  SECOND_ADDRESS,
  SOFTWARE_ADDRESS,
  USDC_ADDRESS,
} from "../../fixtures/fixtures";
import {
  CATALOG_META,
  type CatalogArgs,
  type CatalogStory,
  catalogFrame,
} from "../../runtime/catalog-frame";
import { catalogGroup, catalogSample } from "../../runtime/catalog-markup";

const meta = {
  ...CATALOG_META,
  title: "Design system/07 Assets",
} satisfies Meta<CatalogArgs>;

export default meta;

// Fixed sample of uniformly distributed addresses, so the grid shows the
// spread a real wallet population would see rather than a hand-picked best case.
const BIRD_SAMPLE_ADDRESSES = [
  "0x0af45f8fe325cb5f14bff114153a80240ddd34b307cec2904b32aeeaffef6259",
  "0x01c83a8070f45c472a96eda9c4f10f7cbe462f023ae0f1ad5f4a2675b055174b",
  "0x05728dbeaa625df97fe2f26535503f4f368045e51d996ebb9238771d7bb96c33",
  "0x06f96d646c2b8fe09297e8d364c91c1f7403752e678f7b0ae329a8fe4f070e95",
  "0x025a2052e75fd2f7fe419d9265eb3ee1e94a707c0f20e08b493f63e8d16e5992",
  "0x057c1d26f07514350ed1b7a6c91e2bd38a297ad2c1d07a57e2f95b32317ae640",
  "0x0031808c7d8db9d27c74a4c8f6c2b175a6b23d0610737a36a7f5ea9b61e1c785",
  "0x0a607606dafc3a83f120ada9d93ed3977c3ac30f249ff54c39e3968c902cad6d",
  "0x0b78694b54593636586f449cb019f1cae1596a6ccfc3bfe8af0944a2d1f09ee9",
  "0x0f3a1e7e0b6f698cca86807d90e7e3848bd1cc2547f12446e198c67c935ede34",
  "0x0dd7d4f7839db7bc28f53746a3d641d7857ad65bf93fc216db826767d8f84255",
  "0x06f8331be36baf4c991afee0d8c140425320a11cc680de047ef05d82536a895b",
  "0x05d85d75f072a2ce35e534ba21c8712377fa9c1c3eeb4e4f039e96a1edba6d05",
  "0x032ffcfb8a104efac8eea95409a8289ca181a32ec5230782c801f714c954ecd4",
  "0x0ace191dd2bec2fc4ac03a4dfe3ccf9dabe9dfaeaa3457f3f918895b35067794",
  "0x0234784de10de66e3600c2cff0c2acda48e66eb7896842cf7bb6727517488532",
  "0x04e2eff4c310dd17d0ddd54b424c0b7826e41c14f016a459faae36e632f35b91",
  "0x0a0028857505a5c0aeb1b55507aef0a06a15a025b5f0cabdd29a239278b4431b",
  "0x0483ec509cf4fc0fca52c791150d5e670a6856c7589bb93f9cdee006692e78aa",
  "0x0e10c1793f1c9d2a33f568f297ca058049ce12e414231621e5e88485c1ea643c",
  "0x06a851cedca508f24510e6e42ef73b142cdc903d734097c7ae0c91ba2638e807",
  "0x0f90ea4ac26fd369790659493aaf74cb2a32245a602eff58baf8d78c19de6912",
  "0x0c6d2d1ee04461cf77f71195e176199f96eaf487c620687d9e564ce03cc1c93f",
  "0x0237e0cd7f433688b18ad087a90f8c97319d3226b7106ff289693e636ce98041",
  "0x094e11a379da84058ad7f8658dac92d7a5a9f4e9a23305795da3701680a3f396",
  "0x04b2d63911599107897ac79cc6f0f7cbf759d11a032bd8980f4f29de9d86c0ed",
  "0x09d1f8975e20792c11b0ec0c782669aa4fc1f95d3b7334b5bbe4b5fd8eba5b66",
  "0x02063a53f2dd7d7700a90815625fd236ed2e82fc397e5598c2f7bd15c654ea19",
  "0x0f10e86db08e04af7ea20532d0f8b98c52ef98dee496b3092393428944c45f43",
  "0x0ab476f0d124856d7a154f0a460ad05234c170bace1ece14924c5eb07cdca1be",
] as const;

export const Icons: CatalogStory = {
  render: (args) =>
    catalogFrame(
      "Icons",
      "One shared registry keeps glyph geometry, sizing, and accessibility consistent across every wallet surface.",
      catalogGroup(
        "Registered glyphs",
        "Icons are decorative; the owning control or adjacent copy carries the accessible name.",
        `<div class="catalog-icon-grid">${ICON_NAMES.map(
          (name) => `<span class="catalog-icon">${icon(name)}<code>${name}</code></span>`,
        ).join("")}</div>`,
      ),
      args.theme,
    ),
};

export const IdentityMarks: CatalogStory = {
  name: "Identity marks",
  render: (args) =>
    catalogFrame(
      "Identity marks",
      "Deterministic account avatars and token marks improve scanning without asserting unverified brand identity.",
      catalogGroup(
        "Account and token identity",
        "Account marks are derived locally from the full public address. Known tokens use bundled vector marks; unknown tokens fall back to escaped deterministic initials.",
        `<div class="catalog-grid">
          ${catalogSample(
            "Brand mark",
            `<div class="catalog-row"><span class="brand-mark">${BRAMBLE_MARK}</span><span>The website's bird, used wherever no account is selected</span></div>`,
          )}
          ${catalogSample(
            "Address identities",
            `<div class="catalog-row">
              <span class="brand-mark" title="Daily account">${accountAvatar(SOFTWARE_ADDRESS)}</span>
              <span class="brand-mark" title="Ledger vault">${accountAvatar(LEDGER_ADDRESS)}</span>
              <span class="brand-mark" title="Trading account">${accountAvatar(SECOND_ADDRESS)}</span>
              <span>Each address draws its own bird</span>
            </div>`,
          )}
          ${catalogSample(
            "Thirty sample addresses",
            `<div class="catalog-row">${BIRD_SAMPLE_ADDRESSES.map(
              (address) => `<span class="brand-mark">${accountAvatar(address)}</span>`,
            ).join("")}</div>`,
          )}
          ${catalogSample("Known token", `<div class="catalog-row">${tokenGlyph(USDC_ADDRESS, "USDC")}<span>USD Coin</span></div>`)}
          ${catalogSample("Fallback token", `<div class="catalog-row">${tokenGlyph("0x999", "NEW")}<span>Unverified token</span></div>`)}
        </div>`,
      ),
      args.theme,
    ),
};
