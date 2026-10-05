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
 * the token is spent, this page turns the parked registration into a real
 * company before asking for a password. The same step shipped in PunchLog's
 * copy of this page (kubiknyc/PunchLog#158) — keep the two in step in
 * behaviour.
 *
 * That step now asks first. A register link also carries the parked company
 * name (`&company=...`), and the page shows it back to the reader before
 * anything is created: "Yes, set it up" calls `claim_pending_company` with the
 * name from the link, "No, that's not my company" calls
 * `discard_pending_company`, which clears the marker and mints nothing. Nobody
 * ends up administrating a company they never agreed to. Older mails still in
 * flight carry `flow=register` with no name. The server refuses the
 * zero-argument claim for those (pending_company_name_required,
 * jobsight-backend 20260909000301), so no claim is sent: the page says there
 * is nothing to set up from that link and goes on to the password.
 *
 * Any reader from a register link who reaches the done card without a
 * company — declined, skipped after a failed claim, out-of-date link, or a
 * nameless link — is offered an optional "Run your own company?" form, which
 * calls `create_own_company` with a name they type themselves
 * (CreateCompanyForm); the server clears any leftover parked marker. For a
 * declined reader it is the only way forward: the marker is gone, and
 * registering again only sends an account-exists email. (An account whose
 * marker is still unspent would be re-parked and mailed a fresh consent link
 * by worklog-register-company, but the form is quicker.)
 *
 * The access token is held on the done card only while that form is live,
 * and dropped the moment it ends: created, expired, not confirmed, already
 * affiliated, or "Not now". Every other reader's done card holds no token.
 *
 * The confirm-time DB trigger that used to mint the company is retired
 * (20260909000301), so only a successful claim creates one. The app's
 * "Forgot password?" recovery link, a legacy `#access_token` fragment and a
 * skipped claim all reach the password without one, and the copy on those
 * paths must not promise a company.
 */
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
  type PasswordStrength,
} from "@/lib/passwordStrength";
import { readErrorCode } from "@/lib/createOwnCompany";
import {
  classifySaveFailure,
  hasHashError,
  isClaimNameMismatch,
  readAccessToken,
  readLinkType,
  readRegisterCompany,
  readRegisterFlow,
  readTokenHash,
  readVerifyType,
  type VerifyType,
  type WelcomeLinkType,
} from "@/lib/welcomeLink";

import { CreateCompanyForm } from "./CreateCompanyForm";

const GENERIC_ERROR = "Something went wrong. Please try again.";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  /** A token_hash link, waiting on a tap before it is spent — see the module
   *  comment for why this can never auto-fire. */
  | { readonly kind: "confirm"; readonly tokenHash: string; readonly verifyType: VerifyType }
  /* A failure in `claim` must NOT send the reader back to the confirm tap —
     that token is gone — so the phase holds on to the access token and offers
     a retry of the claim alone. */
  /** Register flow only: the token is spent and the reader is being asked
   *  whether the company named in the link is really theirs. Nothing has been
   *  created yet — both answers below are one tap away. */
  | { readonly kind: "consent"; readonly accessToken: string; readonly company: string }
  /** Register flow only: the token is already spent and the company is being
   *  claimed. `expectedName` is the name the reader approved on the consent
   *  card, sent so the server can refuse a claim whose link has gone stale. */
  | {
      readonly kind: "claim";
      readonly accessToken: string;
      readonly expectedName: string;
    }
  /** A register link with no company name (an older mail). Nothing is sent:
   *  the card only offers the password step. */
  | { readonly kind: "noName"; readonly accessToken: string }
  | { readonly kind: "setPassword"; readonly accessToken: string }
  /** `accessToken` is non-null only while the optional create form is live
   *  (a register-flow reader with no company); it is nulled when that form
   *  ends, so no ended outcome keeps a live token around. */
  | { readonly kind: "done"; readonly accessToken: string | null }
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
  // Read from the same one fragment read, for the same reason as the tag.
  const [pendingCompany, setPendingCompany] = useState<string | null>(null);
  // The claim was refused because the link names a company that is no longer
  // parked. Retrying cannot fix that, so it gets its own copy and no retry.
  const [claimStale, setClaimStale] = useState(false);
  // The reader said the company wasn't theirs. Changes what the password card
  // tells them; the done card's create form is gated on the register flow.
  const [declinedCompany, setDeclinedCompany] = useState(false);
  // Only a successful claim creates a company, so only this earns the "your
  // company is ready" copy. Every other path (skipped, declined, out of date,
  // a nameless link, a recovery link) has no company to promise.
  const [claimedCompany, setClaimedCompany] = useState(false);
  // What the create form ended with (created, refused, or "Not now"); shown in
  // its place once the token is dropped.
  const [createEnded, setCreateEnded] = useState<string | null>(null);

  /** The create form is over: drop the token and close the form. */
  const endCreateCompany = (message: string) => {
    setCreateEnded(message);
    setPhase({ kind: "done", accessToken: null });
  };

  useEffect(() => {
    setLinkType(readLinkType(window.location.hash));
    setIsRegisterFlow(readRegisterFlow(window.location.hash));
    setPendingCompany(readRegisterCompany(window.location.hash));
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
   *
   * `expectedName` is the name the reader approved. Sending it lets the
   * server refuse the claim (400 + 22023) when the link no longer matches
   * what is parked, rather than handing someone a company they were never
   * shown. Always a name: the zero-argument claim is refused server-side.
   */
  const claimPendingCompany = async (accessToken: string, expectedName: string) => {
    setFormError(null);
    setClaimStale(false);

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
        body: JSON.stringify({ expected_name: expectedName }),
      });
      if (response.ok) {
        setClaimedCompany(true);
        setPhase({ kind: "setPassword", accessToken });
        return;
      }
      // Never render the response body — the same phishing guard as
      // everywhere else on this page.
      if (response.status === 401 || response.status === 403) {
        setExpired(true);
        return;
      }
      // The name in the link is not what is parked any more: 400 + 22023 and
      // nothing else. A second attempt sends the same name and gets the same
      // answer, so this is not a retry case — say so plainly and leave the
      // password door open. Any other 400 is a generic failure with a retry.
      // Only the body's `code` is read, never its message.
      if (isClaimNameMismatch(response.status, await readErrorCode(response))) {
        setClaimStale(true);
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
      await claimPendingCompany(phase.accessToken, phase.expectedName);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  /** "Yes, set it up" on the consent card. Sends the name the reader was
   *  actually shown, then hands off to the existing claim card for progress,
   *  retry and skip. Tap-driven only, like everything else here. */
  const onAcceptCompany = async () => {
    if (savingRef.current || phase.kind !== "consent") return;
    const { accessToken, company } = phase;
    savingRef.current = true;
    setSaving(true);
    setPhase({ kind: "claim", accessToken, expectedName: company });
    try {
      await claimPendingCompany(accessToken, company);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  /** "No, that's not my company". Clears the parked marker — this mints
   *  nothing — and goes on to the password, which the reader still needs
   *  either way. On failure they stay on the consent card; both buttons are
   *  still live, so tapping again is the retry. */
  const onDeclineCompany = async () => {
    if (savingRef.current || phase.kind !== "consent") return;
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
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/discard_pending_company`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${phase.accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (response.ok) {
        setDeclinedCompany(true);
        setPhase({ kind: "setPassword", accessToken: phase.accessToken });
        return;
      }
      // Never render the response body.
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
        // A register link naming a company: ask before creating anything.
        // Nothing fires here — the consent card is only rendered.
        if (pendingCompany) {
          setPhase({ kind: "consent", accessToken: body.access_token, company: pendingCompany });
          return;
        }
        // An older register link with no name: there is nothing to claim and
        // the server refuses the zero-argument claim, so nothing is sent.
        setPhase({ kind: "noName", accessToken: body.access_token });
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
        // Keep the token only for the create form (register flow, no company);
        // every other reader's done card holds none.
        setPhase({
          kind: "done",
          accessToken: isRegisterFlow && !claimedCompany ? phase.accessToken : null,
        });
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

          {/* Consent, before anything is created. The company name is React
              text, never markup — it arrives in a fragment anyone can craft. */}
          {phase.kind === "consent" && !expired ? (
            <div>
              <h1>Set up {phase.company} as your company?</h1>
              <p style={{ marginTop: 12 }}>You&apos;ll be its administrator.</p>

              {formError ? <div className="form-notice err">{formError}</div> : null}

              <button
                className="btn btn-primary btn-block"
                type="button"
                onClick={() => void onAcceptCompany()}
                disabled={saving}
                style={{ marginTop: 20 }}
              >
                {saving ? "Working…" : "Yes, set it up"}
              </button>

              <button
                className="btn btn-ghost btn-block"
                type="button"
                onClick={() => void onDeclineCompany()}
                disabled={saving}
                style={{ marginTop: 12 }}
              >
                No, that&apos;s not my company
              </button>

              {/* Same escape hatch as the claim card: a discard that keeps
                  failing must not trap someone short of a password. */}
              {formError ? (
                <button
                  className="btn btn-ghost btn-block"
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setDeclinedCompany(true);
                    setPhase({ kind: "setPassword", accessToken: phase.accessToken });
                  }}
                  disabled={saving}
                  style={{ marginTop: 12 }}
                >
                  Skip for now and choose your password
                </button>
              ) : null}
            </div>
          ) : null}

          {phase.kind === "claim" && !expired ? (
            <div>
              <h1>Setting up your company</h1>
              <p style={{ marginTop: 12 }}>
                {claimStale
                  ? "This link is out of date, so there's nothing to set up from it. Skip this step and choose your password — you can set up your company after."
                  : formError
                    ? "Your email is confirmed, but setting up your company didn't finish."
                    : "One moment — we're finishing your company setup."}
              </p>

              {formError ? <div className="form-notice err">{formError}</div> : null}

              {/* No retry when the link is out of date: a second attempt sends
                  the same name and gets the same refusal. */}
              {claimStale ? null : (
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  onClick={() => void onClaimRetry()}
                  disabled={saving}
                  style={{ marginTop: 20 }}
                >
                  {saving ? "Working…" : "Try again"}
                </button>
              )}

              {/* The claim RPC can fail for reasons "Try again" can't fix (a
                  name mismatch, a stuck 5xx...) — without an escape hatch
                  that's a dead end. Skipping creates no company (the
                  confirm-time trigger is retired), so claimedCompany stays
                  false and the done card promises none. */}
              {formError || claimStale ? (
                <button
                  className="btn btn-ghost btn-block"
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setPhase({ kind: "setPassword", accessToken: phase.accessToken });
                  }}
                  disabled={saving}
                  style={{ marginTop: 12 }}
                >
                  Skip for now and choose your password
                </button>
              ) : null}
            </div>
          ) : null}

          {phase.kind === "noName" && !expired ? (
            <div>
              <h1>One more step</h1>
              <p style={{ marginTop: 12 }}>
                Your email is verified. There&apos;s nothing to set up from this link — choose your
                password to continue.
              </p>

              <button
                className="btn btn-primary btn-block"
                type="button"
                onClick={() => setPhase({ kind: "setPassword", accessToken: phase.accessToken })}
                style={{ marginTop: 20 }}
              >
                Choose your password
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
              {declinedCompany ? (
                <p style={{ marginTop: 12 }}>
                  We haven&apos;t set up a company for you. If you run your own, you can set it up
                  after you choose your password.
                </p>
              ) : null}

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
              {linkType === "signup" && claimedCompany ? (
                <p>
                  Your password is saved and your company is ready. Open the WorkLog app on your
                  phone and sign in — then create your first project and invite your team.
                </p>
              ) : (
                <p>
                  {/* Someone from a register link with no company (skipped,
                      declined, out of date, or a nameless link) has no
                      projects waiting — only an invitee or a reset does. */}
                  {isRegisterFlow || linkType === "signup"
                    ? "Your password is saved. Open the WorkLog app on your phone and sign in."
                    : "Your password is saved. Open the WorkLog app on your phone and sign in — your projects will be waiting."}
                </p>
              )}
              {/* A register-flow reader with no company: declined, skipped,
                  out of date, or a nameless link. Optional. The token is set
                  only for them (see the setPassword success branch). */}
              {phase.accessToken !== null ? (
                <CreateCompanyForm accessToken={phase.accessToken} onEnded={endCreateCompany} />
              ) : null}
              {createEnded ? (
                <p role="status" style={{ marginTop: 12 }}>
                  {createEnded}
                </p>
              ) : null}
            </div>
          ) : null}

          {phase.kind === "confirmed" ? (
            <div className="success-card">
              <div className="glyph" aria-hidden="true">
                🎉
              </div>
              <h1>You&apos;re confirmed</h1>
              {/* No claim ran on this path, so nothing here can say a company
                  is ready — the same copy serves every reader. */}
              <p>
                Your email is verified. Open the WorkLog app on your phone and sign in. If you
                haven&apos;t chosen a password yet, use &quot;Forgot password?&quot; on the sign-in
                screen to set one.
              </p>
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
