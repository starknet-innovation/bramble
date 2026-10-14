import { ArrowUpRight } from "lucide-react";
import { SiteShell } from "../components/site-shell";
import { Button } from "../components/ui/button";
import { REPOSITORY_URL } from "../lib/site-links";
import { chromeStoreUrl } from "../site";

const sections = [
  { href: "#getting-started", label: "Getting started" },
  { href: "#accounts", label: "Accounts" },
  { href: "#transactions", label: "Transactions and dApps" },
  { href: "#multisig", label: "Multisig" },
  { href: "#privacy", label: "Private balances" },
  { href: "#safety", label: "Safety and recovery" },
] as const;

export const DocsPage = () => (
  <SiteShell active="docs">
    <main className="docs-main" id="main-content">
      <div className="docs-layout">
        <aside className="docs-index">
          <nav aria-label="On this page">
            <strong>Documentation</strong>
            {sections.map((section) => (
              <a href={section.href} key={section.href}>
                {section.label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="docs-content">
          <section className="reading-hero docs-hero">
            <h1>Documentation</h1>
            <p>Learn how to install, set up, and use Bramble, the Starknet wallet for Chrome.</p>
            <Button asChild>
              <a href={chromeStoreUrl} rel="noreferrer" target="_blank">
                Download now
                <ArrowUpRight aria-hidden="true" />
              </a>
            </Button>
          </section>
          <div className="docs-note">
            <h3>Before you start</h3>
            <p>
              You will need Chrome and a safe, offline place to record your recovery phrase. Never
              share your phrase, private key, password, or viewing key.
            </p>
          </div>
          <section id="getting-started">
            <h2>Getting started</h2>
            <p>
              Install Bramble from the Chrome Web Store, pin it to the toolbar, and open the side
              panel. A new install opens setup in a full page so the recovery phrase and account
              choices have enough room.
            </p>
            <ol>
              <li>
                Choose <strong>Create wallet</strong> or <strong>Restore wallet</strong>.
              </li>
              <li>Set a strong local wallet password.</li>
              <li>Back up the recovery phrase offline and complete the verification step.</li>
              <li>Create the first Starknet account, then fund and deploy it if prompted.</li>
            </ol>
            <div className="docs-note">
              Bramble starts on Starknet Mainnet. Mainnet moves real funds; switch to Sepolia when
              you are testing.
            </div>
          </section>

          <section id="accounts">
            <h2>Accounts</h2>
            <p>
              Bramble supports OpenZeppelin and Argent account contracts. OpenZeppelin is the
              recommended default; Argent remains available when its account model fits your work.
              Ledger accounts keep signing on the hardware device.
            </p>
            <h3>Undeployed accounts</h3>
            <p>
              A new account address exists before its contract is deployed. Receive funds at that
              address, then use the deployment action Bramble presents. Deployment follows the same
              review and confirmation pattern as a transaction.
            </p>
          </section>

          <section id="transactions">
            <h2>Transactions and dApps</h2>
            <p>
              Send, swap, approve, and dApp requests move through a review before signing. Check the
              active account, network, recipient or contract, asset amount, and fee. Bramble keeps
              the final state visible until submission is confirmed or an actionable error is shown.
            </p>
            <h3>Connecting a dApp</h3>
            <p>
              A site receives access only after you approve its request. Permissions are scoped to
              that origin and can be reviewed or removed later in Settings.
            </p>
          </section>

          <section id="multisig">
            <h2>Multisig</h2>
            <p>
              Create or join an Argent M-of-N account, add participants by account address or public
              signer key, and share the exact transaction intent with the other signers. Bramble can
              coordinate signed intent updates through configured Nostr relays or through manual
              copy and paste.
            </p>
            <p>
              Every signature belongs to one exact transaction hash. If fee bounds or the nonce
              change, Bramble preserves the transfer details and clearly asks the group to review
              and sign the updated transaction.
            </p>
          </section>

          <section id="privacy">
            <h2>Private balances</h2>
            <p>
              A private balance keeps a token off the public record. Shielding moves public value
              into Starknet’s STRK20 privacy pool, where it is held as encrypted notes: you can
              hold, send, and receive it without the amount or the other party appearing on-chain.
              You activate it explicitly, from a public deposit review, and it stays separate from
              your ordinary wallet balance.
            </p>
            <p>
              A private balance is unlocked by a viewing key, derived from your account — it is what
              reveals your shielded balance and history. Activating a private balance registers a
              public commitment to that key on-chain; it never reveals the key or your balance.
              Bramble never shows, exports, or logs the viewing key — treat it like your recovery
              phrase and never share it.
            </p>
            <p>
              STRK20 is Starknet’s privacy standard, not Bramble’s own. For how it works, what it
              protects, and how it handles compliance, see{" "}
              <a href="https://strk20.starknet.io/" rel="noreferrer" target="_blank">
                the Starknet privacy hub
              </a>
              .
            </p>
          </section>

          <section id="safety">
            <h2>Safety and recovery</h2>
            <ul>
              <li>Never share a recovery phrase, private key, password, or viewing key.</li>
              <li>Read the complete transaction review before signing.</li>
              <li>Confirm the active account and network before sending funds.</li>
              <li>
                Restore from the recovery phrase in a fresh profile before relying on a backup.
              </li>
            </ul>
            <p>
              For implementation detail and the project security policy, use the project repository.
            </p>
            <a className="text-link" href={`${REPOSITORY_URL}/blob/main/SECURITY.md`}>
              Read the security policy
              <ArrowUpRight aria-hidden="true" />
            </a>
          </section>
          <section id="support">
            <h2>Support</h2>
            <p>
              Need a hand with installation, an account, or a transaction? Read common questions or
              prepare a support request. Never include wallet secrets.
            </p>
            <Button asChild>
              <a href="/support/">Contact support</a>
            </Button>
          </section>
        </article>
      </div>
    </main>
  </SiteShell>
);
