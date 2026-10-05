"use client";

/**
 * "Run your own company?" on the /welcome done card, for a reader from a
 * register link who has no company yet (see the gate in page.tsx). Optional:
 * the password is already saved, and "Not now" leaves the account as it was.
 *
 * Calls `create_own_company` with the page's access token and a name the
 * reader types. Failure copy comes from lib/createOwnCompany, which reads only
 * the error's `code` — server text is never rendered.
 *
 * Every outcome a retry cannot fix (created, expired, notConfirmed,
 * alreadyAffiliated, or "Not now") goes through `onEnded`: the page drops its
 * access token and replaces this form with the message, so no submit button
 * stays live. Only invalidName, rateLimited and failed keep the form here.
 * Errors never reach the page-level "expired" card, which would replace the
 * success card with password-reset advice — wrong once the password is saved.
 */
import { useRef, useState } from "react";

import {
  classifyCreateCompanyFailure,
  cleanCompanyName,
  CREATE_COMPANY_DECLINED,
  CREATE_COMPANY_DONE,
  CREATE_COMPANY_MESSAGES,
  endsCreateCompany,
  readErrorCode,
} from "@/lib/createOwnCompany";

export function CreateCompanyForm({
  accessToken,
  onEnded,
}: {
  readonly accessToken: string;
  /** Drop the token and show `message` in place of the form. */
  readonly onEnded: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Same double-submit guard as the password form: state is not synchronous,
  // so two same-tick taps would both read `saving === false`.
  const savingRef = useRef(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    setError(null);

    const companyName = cleanCompanyName(name);
    if (!companyName) {
      setError(CREATE_COMPANY_MESSAGES.invalidName);
      return;
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      setError(CREATE_COMPANY_MESSAGES.failed);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_own_company`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ company_name: companyName }),
      });
      if (response.ok) {
        onEnded(CREATE_COMPANY_DONE);
        return;
      }
      const outcome = classifyCreateCompanyFailure(response.status, await readErrorCode(response));
      if (endsCreateCompany(outcome)) {
        onEnded(CREATE_COMPANY_MESSAGES[outcome]);
        return;
      }
      setError(CREATE_COMPANY_MESSAGES[outcome]);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate style={{ marginTop: 24, textAlign: "left" }}>
      <p>Run your own company? Set it up here.</p>

      {error ? (
        <div className="form-notice err" role="alert">
          {error}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="companyName">Company name</label>
        <input
          id="companyName"
          name="companyName"
          type="text"
          autoComplete="organization"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
        />
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
        {saving ? "Setting up…" : "Set up my company"}
      </button>

      <button
        className="btn btn-ghost btn-block"
        type="button"
        onClick={() => onEnded(CREATE_COMPANY_DECLINED)}
        disabled={saving}
        style={{ marginTop: 12 }}
      >
        Not now
      </button>
    </form>
  );
}
