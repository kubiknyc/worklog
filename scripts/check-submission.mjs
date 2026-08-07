/**
 * Store-submission gate. `npm run submit:ios` / `submit:android` run this
 * before ever touching `eas submit` (see CLAUDE.md's "never raw eas submit"
 * rule) — spec A4.
 *
 * Reads the three legal constants straight out of src/lib/legal.ts by regex
 * rather than importing the module: this is a plain Node script (no ts-node /
 * babel loader wired up for scripts/), and the constants are simple string /
 * boolean literals, so a regex read avoids adding a TS loader just for this.
 *
 * Fails unless:
 *   1. LEGAL_PAGES_PUBLISHED === true, AND
 *   2. both TERMS_URL and PRIVACY_URL resolve (following redirects) to a
 *      final HTTP 200.
 *
 * A 3xx that lands on anything other than 200 fails — fetch() follows
 * redirects by default and reports the FINAL response's status, so this falls
 * out of using fetch() rather than needing separate redirect-tracking logic.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const LEGAL_FILE = path.resolve(HERE, '../src/lib/legal.ts');

function readLegalConstants() {
  const source = fs.readFileSync(LEGAL_FILE, 'utf8');

  const termsMatch = source.match(/export const TERMS_URL\s*=\s*'([^']*)'/);
  const privacyMatch = source.match(/export const PRIVACY_URL\s*=\s*'([^']*)'/);
  const publishedMatch = source.match(/export const LEGAL_PAGES_PUBLISHED\s*=\s*(true|false)/);

  if (!termsMatch || !privacyMatch || !publishedMatch) {
    throw new Error(
      `check-submission: couldn't find one of TERMS_URL / PRIVACY_URL / ` +
        `LEGAL_PAGES_PUBLISHED as a literal in ${LEGAL_FILE}`,
    );
  }

  return {
    termsUrl: termsMatch[1],
    privacyUrl: privacyMatch[1],
    legalPagesPublished: publishedMatch[1] === 'true',
  };
}

/** Resolves true only if the URL's final response (after redirects) is 200. */
async function isLive(targetUrl) {
  try {
    const response = await fetch(targetUrl, { method: 'GET', redirect: 'follow' });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function main() {
  const { termsUrl, privacyUrl, legalPagesPublished } = readLegalConstants();

  if (!legalPagesPublished) {
    console.error(
      'check-submission: LEGAL_PAGES_PUBLISHED is false in src/lib/legal.ts — ' +
        'flip it to true only after both legal URLs are live.',
    );
    process.exit(1);
  }

  const [termsLive, privacyLive] = await Promise.all([isLive(termsUrl), isLive(privacyUrl)]);

  if (!termsLive) {
    console.error(`check-submission: TERMS_URL did not resolve to HTTP 200 — ${termsUrl}`);
    process.exit(1);
  }
  if (!privacyLive) {
    console.error(`check-submission: PRIVACY_URL did not resolve to HTTP 200 — ${privacyUrl}`);
    process.exit(1);
  }

  console.log('check-submission: legal pages gate passed — both URLs are live.');
}

void main();
