/**
 * User-facing copy must not name internal milestones (#20).
 *
 * Four shipped tabs rendered "History — M2", "Photos — M2", "Settings — M2" and
 * "Camera — M5" to site crews, who have no idea what an M2 is. Placeholder
 * screens are the easy place for this to happen: the label is written for the
 * developer building the shell and then never revisited.
 *
 * This checks rendered STRING LITERALS only — comments and identifiers may
 * reference milestones freely, and routinely do (the work plan is organised
 * around them).
 */
import * as fs from 'fs';
import * as path from 'path';

const SCAN_ROOTS = ['src', 'app'];
const SOURCE_RE = /\.tsx$/;
const TEST_RE = /\.test\.tsx?$/;

/**
 * `— M2`, `- M5`, `(M3)`, `M4:` and friends, inside a rendered string.
 *
 * No leading `\b` before the dash class: an em dash is not a word character, so
 * `\b—` demands a boundary that never exists after a space. The first version
 * of this had it and matched NOTHING — including all four strings that actually
 * shipped. The detector self-test below is what caught that.
 *
 * The trailing `\b` after `M\d` keeps "M25 bolt" (a real fastener size) out.
 */
const MILESTONE_RE = /[—–-]\s*M\d\b|\(M\d\)|\bM\d\s*[:—–-]/;

/**
 * JSX text nodes and quoted string literals — the things a user can read.
 * Deliberately excludes comments, so `// ships in M5` stays legal.
 */
function userFacingStrings(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

  const out: string[] = [];
  // `>text<` JSX children
  for (const m of withoutComments.matchAll(/>([^<>{}\n]{2,})</g)) out.push(m[1]);
  // 'quoted' / "quoted" literals
  for (const m of withoutComments.matchAll(/'([^'\n]{2,})'|"([^"\n]{2,})"/g)) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SOURCE_RE.test(entry.name) && !TEST_RE.test(entry.name) ? [full] : [];
  });
}

describe('user-facing copy', () => {
  const files = SCAN_ROOTS.flatMap((r) => walk(path.join(process.cwd(), r)));

  it('finds component files to check', () => {
    // Anti-vacuity: an empty walk must fail rather than pass over nothing.
    expect(files.length).toBeGreaterThan(20);
  });

  it('never shows an internal milestone name to the user', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const text of userFacingStrings(fs.readFileSync(file, 'utf8'))) {
        if (MILESTONE_RE.test(text)) {
          offenders.push(`${path.relative(process.cwd(), file)}: ${text.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the detector actually recognises the strings that shipped', () => {
    // Without this the suite above proves only "nothing matched", which is what
    // a broken matcher produces too.
    for (const shipped of ['History — M2', 'Camera — M5', 'Photos — M2', 'Settings — M2']) {
      expect(MILESTONE_RE.test(shipped)).toBe(true);
    }
    for (const legitimate of ['Daily report', 'M25 bolt', 'Section M', 'Form M-1 filed']) {
      expect(MILESTONE_RE.test(legitimate)).toBe(false);
    }
  });
});
