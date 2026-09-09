"use client";

/**
 * Post-confirmation landing page — the signup confirm link's redirect target.
 * GoTrue reports problems (expired/used links) in the URL FRAGMENT as
 * `#error_description=...`, which never reaches the server — so this page is
 * a client component that reads window.location.hash on mount.
 *
 * Under invite-style registration no password is collected at sign-up, so this
 * page is ALSO where a registrant chooses their credential: the confirm
 * link's fragment carries `access_token`/`refresh_token`, and the token is
 * spent on a single `PUT /auth/v1/user` to set the password. Until that
 * happens the account only has the server's discarded random password, which
 * nobody — including whoever submitted the registration — can use.
 *
 * Ported from PunchLog's website (PLW/app/welcome/page.tsx), rebranded, with
 * one structural adaptation: PunchLog's copy links to /forgot-password,
 * /register, and /download — none of which exist on this site (out of
 * repo scope; WorkLog's registration, sign-in, and "Forgot password?" all
 * live in the native app, see docs/superpowers/specs/2026-08-07-punchlog-
 * auth-parity-design.md). Every registrant who reaches this page came from
 * the app's confirm/recovery flow, so the recovery copy below points back at
 * the app instead of at website routes that would 404.
 *
 * A register confirm link (tagged `flow=register`) has one extra step: once
 * the token is spent, this page calls the `claim_pending_company` RPC to turn
 * the parked registration into a real company before asking for a password.
 * The same step is being added to PunchLog's copy of this page — keep the
 * two in step in behaviour.
 */
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
  type PasswordStrength,
} from "@/lib/passwordStrength";
import {
  classifySaveFailure,
  hasHashError,
  readAccessToken,
  readLinkType,
  readRegisterFlow,
  readTokenHash,
  readVerifyType,
  type VerifyType,
  type WelcomeLinkType,
} from "@/lib/welcomeLink";

const GENERIC_ERROR = "Something went wrong. Please try again.";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  /** A token_hash link, waiting on a tap before it is spent — see the module
   *  comment for why this can never auto-fire. */
  | { readonly kind: "confirm"; readonly tokenHash: string; readonly verifyType: VerifyType }
  /** Register flow only: the token is already spent and the company is being
   *  claimed. A failure here must NOT send the reader back to the confirm tap
   *  — that token is gone — so this phase holds on to the access token and
   *  offers a retry of the claim alone. */
  | { readonly kind: "claim"; readonly accessToken: string }
  | { readonly kind: "setPassword"; readonly accessToken: string }
  | { readonly kind: "done" }
  /** Confirmed, but no token to set a password with (already-used link, or a
   *  legacy confirm link from before invite-style registration). */
  | { readonly kind: "confirmed" };

/** Copy for the confirm tap, keyed by what GoTrue's `type` says the link is
 *  for. `magiclink` and `email` both land on the same generic "confirm your
 *  email" copy — neither promises a company or an invite. */
function confirmCopy(verifyType: VerifyType): { heading: string; button: string } {
  if (verifyType === "invite")
    return { heading: "You're invited to WorkLog", button: "Accept invite" };
  if (verifyType === "recovery") return { heading: "Reset your password", button: "Continue" };
  return { heading: "Confirm your email", button: "Confirm email" };
}

/**
 * `POST /auth/v1/verify` failure -> outcome, same shape as classifySaveFailure
 * but not the same rules: GoTrue answers an already-spent or malformed
 * token_hash with 400 as often as 401/403, so 400 is expired here too (it is
 * NOT expired in classifySaveFailure, which is about a rejected password).
 */
function classifyVerifyFailure(status: number): "expired" | "rateLimited" | "failed" {
  if (status === 400 || status === 401 || status === 403) return "expired";
  if (status === 429) return "rateLimited";
  return "failed";
}

export default function WelcomePage() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  // Standalone rather than carried on Phase: the fragment is read once and
  // never changes, but the success copy is chosen in `done`, which is set much
  // later. Threading it through every phase variant would buy nothing.
  const [linkType, setLinkType] = useState<WelcomeLinkType>("other");
  // Read once, here, from the same fragment read as linkType. The tag is not
  // needed until after the confirm tap, and the fragment is cleared the moment
  // the token is spent — re-reading window.location.hash then would find
  // nothing.
  const [isRegisterFlow, setIsRegisterFlow] = useState(false);

  useEffect(() => {
    setLinkType(readLinkType(window.location.hash));
    setIsRegisterFlow(readRegisterFlow(window.location.hash));
    if (hasHashError(window.location.hash)) {
      setPhase({ kind: "error" });
      return;
    }
    const accessToken = readAccessToken(window.location.hash);
    if (accessToken) {
      // NB: the fragment is deliberately left in place until the password is
      // saved. Stripping it here would mean a reload (or a restored tab)
      // silently destroys the token, forcing the user to request a fresh link
      // for no reason. Fragments are not sent to servers and are stripped from
      // Referer, so leaving it for the life of the page is the lesser risk.
      // It is cleared on success.
      setPhase({ kind: "setPassword", accessToken });
      return;
    }
    // New shape: a hashed one-time token, exchanged only on a button tap
    // (never here, never elsewhere in this effect) so a mail scanner's GET of
    // the emailed link cannot burn it before the recipient sees the page.
    const tokenHash = readTokenHash(window.location.hash);
    if (tokenHash) {
      const verifyType = readVerifyType(window.location.hash);
      if (verifyType) {
        setPhase({ kind: "confirm", tokenHash, verifyType });
        return;
      }
      setPhase({ kind: "error" });
      return;
    }
    setPhase({ kind: "confirmed" });
  }, []);

  // The strength check is async (zxcvbn's dictionaries load as a lazy chunk),
  // so a slow early keystroke could resolve after a later one. Only the newest
  // request is allowed to write state.
  const strengthSeq = useRef(0);
  const savingRef = useRef(false);
  const onPasswordChange = useCallback((value: string) => {
    setPassword(value);
    const seq = ++strengthSeq.current;
    if (value.length === 0) {
      setStrength(null);
      return;
    }
    // .catch is required, not decorative: the strength check lazily fetches a
    // chunk, and an unhandled rejection here would fire on every keystroke.
    // Losing the meter is fine — submit re-checks and is the real gate.
    void checkPasswordStrength(value)
      .then((result) => {
        if (seq === strengthSeq.current) setStrength(result);
      })
      .catch(() => {
        if (seq === strengthSeq.current) setStrength(null);
      });
  }, []);

  /**
   * Turn the parked registration into a real company. Register flow only, and
   * only after the confirm tap has spent the token — never on mount.
   *
   * Does not manage `saving`/`savingRef` itself: both callers already hold
   * them, and claiming them a second time here would deadlock the call.
   *
   * The RPC is idempotent, so retrying after a timeout that actually
   * succeeded is harmless. On failure the reader stays in the `claim` phase
   * with a retry — the one-time confirm token is already spent, so sending
   * them back to the confirm tap, or to a fresh link, would be worse than a
   * second try.
   */
  const claimPendingCompany = async (accessToken: string) => {
    setFormError(null);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      setFormError(GENERIC_ERROR);
      return;
    }

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_pending_company`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (response.ok) {
        setPhase({ kind: "setPassword", accessToken });
        return;
      }
      // Never render the response body — the same phishing guard as
      // everywhere else on this page.
      if (response.status === 401 || response.status === 403) {
        setExpired(true);
        return;
      }
      setFormError(
        response.status === 429
          ? "Too many attempts — wait a minute and try again."
          : GENERIC_ERROR,
      );
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    }
  };

  /** The claim card's "Try again". Retries the RPC with the token already in
   *  hand — never a second verify. */
  const onClaimRetry = async () => {
    if (savingRef.current || phase.kind !== "claim") return;
    savingRef.current = true;
    setSaving(true);
    try {
      await claimPendingCompany(phase.accessToken);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  // Fires ONLY from the button's onClick below — never on mount, never in an
  // effect. A corporate mail scanner GETs every link in the email; if this
  // ran on load it would spend the one-time token before the recipient ever
  // saw the page.
  const onConfirmTap = async () => {
    if (savingRef.current || phase.kind !== "confirm") return;
    setFormError(null);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      setFormError(GENERIC_ERROR);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ type: phase.verifyType, token_hash: phase.tokenHash }),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { access_token?: string };
        // Spent — drop it from the address bar the same way the setPassword
        // success path does.
        window.history.replaceState(null, "", window.location.pathname);
        if (!body.access_token) {
          setPhase({ kind: "confirmed" });
          return;
        }
        if (!isRegisterFlow) {
          setPhase({ kind: "setPassword", accessToken: body.access_token });
          return;
        }
        // A register link: show the claim card, then create the company. On
        // success claimPendingCompany moves on to setPassword; on failure the
        // reader stays on the claim card with a retry.
        setPhase({ kind: "claim", accessToken: body.access_token });
        await claimPendingCompany(body.access_token);
        return;
      }
      // Never render the response body — same phishing guard as
      // hasHashError/error_description above.
      const outcome = classifyVerifyFailure(response.status);
      if (outcome === "expired") {
        setExpired(true);
        return;
      }
      if (outcome === "rateLimited") {
        setFormError("Too many attempts — wait a minute and try again.");
        return;
      }
      setFormError(GENERIC_ERROR);
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Ref, not the `saving` state: state updates are not synchronous, so two
    // same-tick submits both read the stale `false` and both PUT — spending
    // the single-use token twice. The app screen guards the same way.
    if (savingRef.current || phase.kind !== "setPassword") return;
    setFormError(null);

    // Read config BEFORE claiming any guard, so this early return cannot
    // leave the form disabled forever with an error that invites a retry the
    // user is unable to make.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      setFormError(GENERIC_ERROR);
      return;
    }

    // Claimed before the first await, so two fast submits cannot both pass and
    // both PUT (the second would spend an already-consumed token and report a
    // spurious failure over a successful save). Released in the finally below,
    // on every path including a throw.
    savingRef.current = true;
    setSaving(true);
    try {
      // Re-check rather than trusting `strength`: it is filled in
      // asynchronously, so on submit it can still be null (typed and
      // submitted before the first check resolved) or stale from an
      // earlier value.
      //
      // Its own try: the strength check lazily fetches the zxcvbn chunk, which
      // can fail on its own (offline, or a stale build id after a redeploy —
      // realistic for a link opened days after the email). Letting that fall
      // into the outer catch would report "couldn't reach the server" for a
      // failure that has nothing to do with the save, and there is no
      // meaningful retry, so route the user to a fresh link instead.
      let current: PasswordStrength;
      try {
        current = await checkPasswordStrength(password);
      } catch {
        setFormError(
          "Couldn't check your password just now. Reload the page and try again.",
        );
        return;
      }
      setStrength(current);
      if (!current.isAcceptable) {
        setFormError(
          `Choose a stronger password — at least ${MIN_PASSWORD_LENGTH} characters and not easily guessed.`,
        );
        return;
      }
      if (password !== confirm) {
        setFormError("Passwords don't match.");
        return;
      }

      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${phase.accessToken}`,
        },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        // Only now is it safe to drop the token from the address bar — it has
        // been spent and the password is saved.
        window.history.replaceState(null, "", window.location.pathname);
        setPhase({ kind: "done" });
        return;
      }
      // Distinguish the failures: reporting everything as "expired" sends a
      // user with a rejected password, or a transient 5xx, down the wrong
      // recovery path. Classified in lib/welcomeLink so it can be tested.
      const body = (await response.json().catch(() => ({}))) as { msg?: string };
      const outcome = classifySaveFailure(response.status, body.msg);
      switch (outcome.kind) {
        case "expired":
          setExpired(true);
          return;
        case "rejected":
          setFormError(outcome.message ?? "That password was rejected. Try a different one.");
          return;
        case "rateLimited":
          setFormError("Too many attempts — wait a minute and try again.");
          return;
        case "failed":
          setFormError(GENERIC_ERROR);
          return;
      }
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  return (
    <>
      <div className="wrap">
        <header className="site-header">
          <Link href="/" className="brand">
            <Image src="/brand-mark.svg" alt="" width={34} height={34} />
            <span>WorkLog</span>
          </Link>
        </header>
      </div>
      <main className="form-page">
        <div className="form-card">
          {phase.kind === "error" ? (
            <div className="success-card">
              <div className="glyph" aria-hidden="true">
                ⏰
              </div>
              <h1>That link didn&apos;t work</h1>
              <p style={{ marginTop: 12 }}>
                Links expire after a while. Open the WorkLog app and try again — if you already
                confirmed this address, use &quot;Forgot password?&quot; on the sign-in screen to
                send yourself a new link. Otherwise, register again from the app to get a fresh
                one.
              </p>
            </div>
          ) : null}

          {/* A spent one-shot token cannot be retried, and the account is
              already CONFIRMED at this point — so re-registering would not
              resend a link either. The app's "Forgot password?" action is the
              only path to a fresh credential from here. */}
          {expired ? (
            <div className="success-card">
              <div className="glyph" aria-hidden="true">
                ⏰
              </div>
              <h1>That link has expired</h1>
              <p style={{ marginTop: 12 }}>
                Confirmation links can only be used once. Open the WorkLog app and use
                &quot;Forgot password?&quot; on the sign-in screen to send yourself a new one.
              </p>
            </div>
          ) : null}

          {phase.kind === "confirm" && !expired ? (
            <div>
              <h1>{confirmCopy(phase.verifyType).heading}</h1>
              <p style={{ marginTop: 12 }}>
                Tap the button to continue. This link only works once.
              </p>

              {formError ? <div className="form-notice err">{formError}</div> : null}

              <button
                className="btn btn-primary btn-block"
                type="button"
                onClick={() => void onConfirmTap()}
                disabled={saving}
                style={{ marginTop: 20 }}
              >
                {saving ? "Working…" : confirmCopy(phase.verifyType).button}
              </button>
            </div>
          ) : null}

          {phase.kind === "claim" && !expired ? (
            <div>
              <h1>Setting up your company</h1>
              <p style={{ marginTop: 12 }}>
                {saving
                  ? "One moment — we're finishing your company setup."
                  : "Your email is confirmed, but we couldn't finish setting up your company. Try again."}
              </p>

              {formError ? <div className="form-notice err">{formError}</div> : null}

              <button
                className="btn btn-primary btn-block"
                type="button"
                onClick={() => void onClaimRetry()}
                disabled={saving}
                style={{ marginTop: 20 }}
              >
                {saving ? "Working…" : "Try again"}
              </button>
            </div>
          ) : null}

          {phase.kind === "setPassword" && !expired ? (
            <form onSubmit={onSubmit} noValidate>
              <h1>Choose your password</h1>
              <p style={{ marginTop: 12 }}>
                Your email is verified. Pick a password to finish setting up your account — you
                will use it to sign in on the WorkLog app.
              </p>

              {formError ? <div className="form-notice err">{formError}</div> : null}

              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  disabled={saving}
                />
                {strength ? (
                  <p className="fine-print" aria-live="polite">
                    Strength: {strength.label}
                    {strength.suggestion ? ` — ${strength.suggestion}` : ""}
                  </p>
                ) : null}
              </div>

              <div className="field">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  disabled={saving}
                />
              </div>

              <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Set password"}
              </button>
            </form>
          ) : null}

          {phase.kind === "done" ? (
            <div className="success-card">
              <div className="glyph" aria-hidden="true">
                🎉
              </div>
              <h1>You&apos;re all set</h1>
              {linkType === "signup" ? (
                <p>
                  Your password is saved and your company is ready. Open the WorkLog app on your
                  phone and sign in — then create your first project and invite your team.
                </p>
              ) : (
                <p>
                  Your password is saved. Open the WorkLog app on your phone and sign in — your
                  projects will be waiting.
                </p>
              )}
            </div>
          ) : null}

          {phase.kind === "confirmed" ? (
            <div className="success-card">
              <div className="glyph" aria-hidden="true">
                🎉
              </div>
              <h1>You&apos;re confirmed</h1>
              {linkType === "signup" ? (
                <p>
                  Your email is verified and your company is ready. Open the WorkLog app on your
                  phone and sign in. If you haven&apos;t chosen a password yet, use &quot;Forgot
                  password?&quot; on the sign-in screen to set one.
                </p>
              ) : (
                <p>
                  Your email is verified. Open the WorkLog app on your phone and sign in. If you
                  haven&apos;t chosen a password yet, use &quot;Forgot password?&quot; on the
                  sign-in screen to set one.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </main>

      <footer className="site-footer">
        <span>WorkLog</span>
        <nav className="footer-links" aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
        <span>Built for the people who build.</span>
      </footer>
    </>
  );
}
