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
  type WelcomeLinkType,
} from "@/lib/welcomeLink";

const GENERIC_ERROR = "Something went wrong. Please try again.";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "setPassword"; readonly accessToken: string }
  | { readonly kind: "done" }
  /** Confirmed, but no token to set a password with (already-used link, or a
   *  legacy confirm link from before invite-style registration). */
  | { readonly kind: "confirmed" };

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

  useEffect(() => {
    setLinkType(readLinkType(window.location.hash));
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
