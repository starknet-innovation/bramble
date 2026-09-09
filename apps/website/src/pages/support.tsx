import { type FormEvent, useState } from "react";
import { SiteShell } from "../components/site-shell";
import { Button } from "../components/ui/button";
import { createSupportIssueUrl, REPOSITORY_URL } from "../lib/site-links";

const questions = [
  [
    "I lost my seed phrase. What now?",
    "Support cannot recover your seed phrase or reset your wallet password. If you can still unlock your wallet, back up the recovery phrase from the wallet’s settings and keep it offline. Do not remove the extension or clear its data before securing a backup.",
  ],
  [
    "A transaction is stuck as pending",
    "Check the transaction on Starkscan on the same network as your wallet. Confirm its status before trying again. For a support request, include the network and steps you took, and only transaction details you are comfortable sharing.",
  ],
  [
    "The side panel will not open",
    "Check that Bramble is enabled in Chrome’s extensions page. Pin it to the toolbar and select its icon to open the side panel. Avoid reinstalling or clearing extension data unless you have backed up your recovery phrase.",
  ],
  [
    "Which networks does Bramble support?",
    "Bramble starts on Starknet Mainnet. Switch to Sepolia in the wallet when testing. Always check the active network before sharing a receive address or approving a transaction.",
  ],
] as const;

export const SupportPage = () => {
  const [question, setQuestion] = useState("");
  const submitQuestion = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    window.location.assign(createSupportIssueUrl(question));
  };
  return (
    <SiteShell active="support">
      <main className="reading-main" id="main-content">
        <section className="reading-hero support-hero">
          <h1>Support</h1>
          <p>Get help with Bramble, report a wallet problem, or find the right documentation.</p>
        </section>
        <div className="support-cards">
          <section>
            <h2>Report a problem</h2>
            <p>
              Tell us what happened, which network you used, and how to reproduce the issue. Keep
              wallet secrets out of your report.
            </p>
            <Button asChild>
              <a href="#form">Open a report</a>
            </Button>
          </section>
          <section>
            <h2>Read the docs</h2>
            <p>Install, set up and everyday use, written out step by step.</p>
            <Button asChild className="button-ink">
              <a href="/docs/">Go to documentation</a>
            </Button>
          </section>
        </div>
        <section className="support-faq" aria-labelledby="questions-title">
          <h2 id="questions-title">Common questions</h2>
          <div>
            {questions.map(([title, answer]) => (
              <article key={title}>
                <h3>{title}</h3>
                <p>{answer}</p>
              </article>
            ))}
          </div>
        </section>
        <section aria-labelledby="ask-title" className="support-compose" id="form">
          <h2 id="ask-title">Still stuck? Send us the details</h2>
          <p>
            Include the network, account type, and the step where you became stuck. Continue on
            GitHub to review and submit your request; a GitHub account and repository access may be
            required. Remove any addresses or transaction details you do not want to share.
          </p>
          <p>
            <strong>Never share your seed phrase with anyone, including support.</strong> Keep
            private keys, passwords, viewing keys, and raw signatures out of requests too.
          </p>
          <form onSubmit={submitQuestion}>
            <label htmlFor="support-question">What happened?</label>
            <textarea
              id="support-question"
              maxLength={2_000}
              onChange={(event) => setQuestion(event.currentTarget.value)}
              placeholder="Describe the problem and the steps you took…"
              required
              rows={5}
              value={question}
            />
            <div className="form-footer">
              <span>{question.length.toLocaleString()} / 2,000</span>
              <Button disabled={question.trim().length === 0} type="submit">
                Continue on GitHub
              </Button>
            </div>
          </form>
        </section>
        <aside className="secret-warning">
          <h2>Reporting a security issue?</h2>
          <p>
            Use the{" "}
            <a className="text-link" href={`${REPOSITORY_URL}/security/policy`}>
              private security reporting route
            </a>{" "}
            for vulnerabilities or sensitive findings.
          </p>
        </aside>
      </main>
    </SiteShell>
  );
};
