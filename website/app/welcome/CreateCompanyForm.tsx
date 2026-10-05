"use client";

/**
 * "Run your own company?" on the /welcome done card, shown only to a reader
 * who declined the parked company. Optional: the password is already saved,
 * and ignoring this leaves the account exactly as it was.
 *
 * Calls `create_own_company` with the page's access token and a name the
 * reader types. Failure copy comes from lib/createOwnCompany, which reads only
 * the error's `code` — server text is never rendered. Errors stay inline: the
 * page-level "expired" card would replace the success card with password-reset
 * advice, which is wrong once the password is saved.
 */
import { useRef, useState } from "react";

import {
  classifyCreateCompanyFailure,
  cleanCompanyName,
  COMPANY_NAME_MAX,
  CREATE_COMPANY_MESSAGES,
  readErrorCode,
} from "@/lib/createOwnCompany";

export function CreateCompanyForm({ accessToken }: { readonly accessToken: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);
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
        setCreated(true);
        return;
      }
      const outcome = classifyCreateCompanyFailure(response.status, await readErrorCode(response));
      setError(CREATE_COMPANY_MESSAGES[outcome]);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  if (created) {
    return (
      <p role="status" style={{ marginTop: 12 }}>
        Your company is set up. Sign in to the WorkLog app — then create your first project and
        invite your team.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ marginTop: 24, textAlign: "left" }}>
      <p>Run your own company? Set it up here.</p>

      {error ? <div className="form-notice err">{error}</div> : null}

      <div className="field">
        <label htmlFor="companyName">Company name</label>
        <input
          id="companyName"
          name="companyName"
          type="text"
          autoComplete="organization"
          maxLength={COMPANY_NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
        />
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
        {saving ? "Setting up…" : "Set up my company"}
      </button>
    </form>
  );
}
