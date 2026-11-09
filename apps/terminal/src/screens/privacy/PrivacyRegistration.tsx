import { Check, KeyRound, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

/** One-time registration explanation and explicit wallet hand-off. */
export const PrivacyRegistration = ({
  active,
  busy,
  onActivate,
  poolAddress,
}: {
  readonly active: boolean;
  readonly busy: boolean;
  readonly onActivate: () => void;
  readonly poolAddress: string;
}): ReactNode => (
  <div className="privacy-registration">
    <div className={active ? "registration-mark active" : "registration-mark"}>
      {active ? <Check /> : <ShieldCheck />}
    </div>
    <div className="registration-copy">
      <span>{active ? "Setup complete" : "One-time setup"}</span>
      <h3>{active ? "Private balances are active" : "Activate private balances"}</h3>
      <p>
        {active
          ? "This account can discover, shield, transfer, and withdraw private balances."
          : "Register this account with the production privacy pool before shielding your first asset."}
      </p>
    </div>
    <dl>
      <div>
        <dt>Transaction</dt>
        <dd>Public, one time</dd>
      </div>
      <div>
        <dt>Published</dt>
        <dd>Viewing-key commitment</dd>
      </div>
      <div>
        <dt>Never shared</dt>
        <dd>Viewing key or private notes</dd>
      </div>
      <div>
        <dt>Pool</dt>
        <dd>
          <code>{poolAddress}</code>
        </dd>
      </div>
    </dl>
    <div className="registration-boundary">
      <KeyRound />
      <p>Bramble derives the commitment, shows the final review, and signs only after approval.</p>
    </div>
    {active ? null : (
      <button className="privacy-primary" disabled={busy} onClick={onActivate} type="button">
        {busy ? "Waiting for wallet…" : "Review activation in wallet"}
      </button>
    )}
  </div>
);
