import { DOMAIN_COLUMNS } from '../db/schema';
import {
  ROTATION_MIN_INTERVAL_MS,
  ACTIVE_SWEEP_MIN_INTERVAL_MS,
  IN_CHUNK_SIZE,
  PROFILE_PULL_COLUMNS,
  MEMBER_PULL_COLUMNS,
  PREFS_PULL_COLUMNS,
  PROJECT_PULL_COLUMNS,
  REPORT_PULL_COLUMNS,
  WEATHER_PULL_COLUMNS,
  SECTION_PULL_COLUMNS,
  PHOTO_PULL_COLUMNS,
  AMENDMENT_PULL_COLUMNS,
  AMENDMENT_CHANGES_PULL_COLUMNS,
  chunk,
  planPullRun,
  diffMembership,
  type RotationState,
} from './pullCore';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

describe('tuning constants', () => {
  it('pins the documented values', () => {
    expect(ROTATION_MIN_INTERVAL_MS).toBe(300_000);
    expect(ACTIVE_SWEEP_MIN_INTERVAL_MS).toBe(21_600_000);
    expect(IN_CHUNK_SIZE).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Column manifests
// ---------------------------------------------------------------------------

describe('PROFILE_PULL_COLUMNS', () => {
  it('excludes expo_push_token (grant revoked) and never uses "*"', () => {
    expect(PROFILE_PULL_COLUMNS).not.toMatch(/expo_push_token/);
    expect(PROFILE_PULL_COLUMNS).not.toContain('*');
  });

  it('is the hand-pinned manifest, not derived from DOMAIN_COLUMNS.profiles', () => {
    // profiles carries expo_push_token server-side; the pull manifest must diverge.
    expect(PROFILE_PULL_COLUMNS).not.toBe(DOMAIN_COLUMNS.profiles.join(', '));
  });
});

describe('derived manifests', () => {
  it('MEMBER_PULL_COLUMNS derives from DOMAIN_COLUMNS.project_members', () => {
    expect(MEMBER_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.project_members.join(', '));
  });

  it('PREFS_PULL_COLUMNS derives from DOMAIN_COLUMNS.report_member_prefs', () => {
    expect(PREFS_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.report_member_prefs.join(', '));
  });

  it('PROJECT_PULL_COLUMNS derives from DOMAIN_COLUMNS.projects', () => {
    expect(PROJECT_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.projects.join(', '));
  });

  it('REPORT_PULL_COLUMNS derives from DOMAIN_COLUMNS.daily_reports', () => {
    expect(REPORT_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.daily_reports.join(', '));
  });

  it('WEATHER_PULL_COLUMNS derives from DOMAIN_COLUMNS.report_weather', () => {
    expect(WEATHER_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.report_weather.join(', '));
  });

  it('SECTION_PULL_COLUMNS derives from DOMAIN_COLUMNS.report_sections and contains updated_by', () => {
    expect(SECTION_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.report_sections.join(', '));
    expect(SECTION_PULL_COLUMNS.split(', ')).toContain('updated_by');
  });

  it('PHOTO_PULL_COLUMNS derives from DOMAIN_COLUMNS.report_photos and contains project_id', () => {
    expect(PHOTO_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.report_photos.join(', '));
    expect(PHOTO_PULL_COLUMNS.split(', ')).toContain('project_id');
  });

  it('AMENDMENT_PULL_COLUMNS derives from DOMAIN_COLUMNS.report_amendments', () => {
    expect(AMENDMENT_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.report_amendments.join(', '));
  });

  it('AMENDMENT_CHANGES_PULL_COLUMNS derives from DOMAIN_COLUMNS.report_amendment_changes', () => {
    expect(AMENDMENT_CHANGES_PULL_COLUMNS).toBe(DOMAIN_COLUMNS.report_amendment_changes.join(', '));
  });
});

// ---------------------------------------------------------------------------
// chunk
// ---------------------------------------------------------------------------

describe('chunk', () => {
  it('returns an empty array for empty input', () => {
    expect(chunk([], 200)).toEqual([]);
  });

  it('splits an exact multiple of size into even chunks', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('leaves a shorter final chunk for a remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

// ---------------------------------------------------------------------------
// planPullRun
// ---------------------------------------------------------------------------

const NOW = '2026-07-31T12:00:00.000Z';

function minutesBefore(nowIso: string, minutes: number): string {
  return new Date(Date.parse(nowIso) - minutes * 60_000).toISOString();
}

function hoursBefore(nowIso: string, hours: number): string {
  return new Date(Date.parse(nowIso) - hours * 3_600_000).toISOString();
}

const NO_ROTATION: RotationState = { lastProjectId: null, lastAt: null };

describe('planPullRun — activeProjectId passthrough', () => {
  it('echoes the input active project id unchanged', () => {
    const plan = planPullRun({
      activeProjectId: 'p-active',
      memberProjectIds: ['p-active'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.activeProjectId).toBe('p-active');
  });
});

describe('planPullRun — rotation interval gate', () => {
  it('picks a candidate when lastAt is null (never rotated)', () => {
    const plan = planPullRun({
      activeProjectId: 'p-active',
      memberProjectIds: ['p-active', 'p-b'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.rotationPick).toBe('p-b');
  });

  it('picks a candidate when the interval has elapsed', () => {
    const plan = planPullRun({
      activeProjectId: 'p-active',
      memberProjectIds: ['p-active', 'p-b'],
      rotation: { lastProjectId: 'p-b', lastAt: minutesBefore(NOW, 10) },
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.rotationPick).not.toBeNull();
  });

  it('withholds a pick when the interval has not elapsed', () => {
    const rotation: RotationState = { lastProjectId: 'p-b', lastAt: minutesBefore(NOW, 1) };
    const plan = planPullRun({
      activeProjectId: 'p-active',
      memberProjectIds: ['p-active', 'p-b', 'p-c'],
      rotation,
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.rotationPick).toBeNull();
    expect(plan.nextRotationState).toEqual(rotation);
  });

  it('treats an unparseable lastAt as null (picks anyway)', () => {
    const plan = planPullRun({
      activeProjectId: 'p-active',
      memberProjectIds: ['p-active', 'p-b'],
      rotation: { lastProjectId: 'p-b', lastAt: 'not-a-date' },
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.rotationPick).toBe('p-b');
  });

  it('advances nextRotationState only when a pick is made', () => {
    const plan = planPullRun({
      activeProjectId: 'p-active',
      memberProjectIds: ['p-active', 'p-b'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.nextRotationState).toEqual({ lastProjectId: 'p-b', lastAt: NOW });
  });
});

describe('planPullRun — rotation candidates', () => {
  it('excludes the active project from rotation candidates', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a', 'p-b'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.rotationPick).toBe('p-b');
    expect(plan.rotationPick).not.toBe('p-a');
  });

  it('picks the next member in sorted order and wraps around', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a', 'p-b', 'p-c'],
      rotation: { lastProjectId: 'p-c', lastAt: null },
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    // sorted non-active candidates: [p-b, p-c]; after p-c wraps to p-b
    expect(plan.rotationPick).toBe('p-b');
  });

  it('picks the first sorted candidate when lastProjectId is unknown/evicted', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a', 'p-c', 'p-b'],
      rotation: { lastProjectId: 'p-evicted', lastAt: null },
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.rotationPick).toBe('p-b');
  });

  it('returns null when the only member project is the active one', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: {},
      nowIso: NOW,
    });
    expect(plan.rotationPick).toBeNull();
    expect(plan.nextRotationState).toEqual(NO_ROTATION);
  });
});

describe('planPullRun — sweepProjects', () => {
  it('unions sweep-due members with the rotation pick, deduped', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a', 'p-b'],
      rotation: NO_ROTATION, // rotationPick will be p-b
      sweepDueProjectIds: ['p-b'], // already the rotation pick
      sweepLastByProject: { 'p-a': hoursBefore(NOW, 1) }, // keep active out of the sweep here
      nowIso: NOW,
    });
    expect(plan.rotationPick).toBe('p-b');
    expect(plan.sweepProjects).toEqual(['p-b']);
  });

  it('drops sweep-due ids that are not members', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: ['p-not-a-member'],
      sweepLastByProject: { 'p-a': hoursBefore(NOW, 1) }, // keep active out of the sweep here
      nowIso: NOW,
    });
    expect(plan.sweepProjects).toEqual([]);
  });

  it('adds the active project when its sweep stamp is null (never swept)', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: { 'p-a': null },
      nowIso: NOW,
    });
    expect(plan.sweepProjects).toEqual(['p-a']);
  });

  it('adds the active project when its sweep stamp is older than the staleness window', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: { 'p-a': hoursBefore(NOW, 7) },
      nowIso: NOW,
    });
    expect(plan.sweepProjects).toEqual(['p-a']);
  });

  it('omits the active project when its sweep stamp is fresh', () => {
    const plan = planPullRun({
      activeProjectId: 'p-a',
      memberProjectIds: ['p-a'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: { 'p-a': hoursBefore(NOW, 1) },
      nowIso: NOW,
    });
    expect(plan.sweepProjects).toEqual([]);
  });

  it('omits the active project from the sweep when it is not a member', () => {
    const plan = planPullRun({
      activeProjectId: 'p-not-a-member',
      memberProjectIds: [],
      rotation: NO_ROTATION,
      sweepDueProjectIds: [],
      sweepLastByProject: { 'p-not-a-member': null },
      nowIso: NOW,
    });
    expect(plan.sweepProjects).toEqual([]);
  });

  it('never includes a non-member project across any of the three sweep sources', () => {
    const plan = planPullRun({
      activeProjectId: 'p-active',
      memberProjectIds: ['p-active', 'p-b'],
      rotation: NO_ROTATION,
      sweepDueProjectIds: ['p-b', 'p-intruder'],
      sweepLastByProject: { 'p-active': null },
      nowIso: NOW,
    });
    const members = new Set(['p-active', 'p-b']);
    for (const id of plan.sweepProjects) {
      expect(members.has(id)).toBe(true);
    }
    expect(plan.sweepProjects).not.toContain('p-intruder');
  });
});

// ---------------------------------------------------------------------------
// diffMembership
// ---------------------------------------------------------------------------

describe('diffMembership', () => {
  it('returns projects present before but absent after', () => {
    expect(diffMembership(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });

  it('returns empty when the before set was empty (first-sync safety)', () => {
    expect(diffMembership([], ['a', 'b'])).toEqual([]);
  });

  it('returns empty when membership is unchanged', () => {
    expect(diffMembership(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});
