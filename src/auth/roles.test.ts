import {
  isCompanyAdmin,
  isProfileComplete,
  isSuperOnAnyProject,
  isValidEmail,
  mergeEffectiveMemberships,
  roleForProject,
  validateCredentials,
  type CompanyMembership,
  type Membership,
} from './roles';

const PROJECT_A = '00000000-0000-4000-8000-0000000000a1';
const PROJECT_B = '00000000-0000-4000-8000-0000000000b1';

const memberships: Membership[] = [
  { project_id: PROJECT_A, role: 'super' },
  { project_id: PROJECT_B, role: 'sub' },
];

describe('roleForProject', () => {
  it('returns the role for a project the user belongs to', () => {
    expect(roleForProject(memberships, PROJECT_A)).toBe('super');
    expect(roleForProject(memberships, PROJECT_B)).toBe('sub');
  });

  it('returns null for a project the user is not a member of', () => {
    expect(roleForProject(memberships, 'unknown-project')).toBeNull();
  });

  it('returns null when there are no memberships', () => {
    expect(roleForProject([], PROJECT_A)).toBeNull();
  });
});

describe('isSuperOnAnyProject', () => {
  it('is true when the user is super on at least one project', () => {
    expect(isSuperOnAnyProject(memberships)).toBe(true);
  });

  it('is false when the user is only a sub', () => {
    expect(isSuperOnAnyProject([{ project_id: PROJECT_B, role: 'sub' }])).toBe(false);
  });

  it('is false with no memberships', () => {
    expect(isSuperOnAnyProject([])).toBe(false);
  });
});

describe('isCompanyAdmin', () => {
  it('is true when the user administers at least one company', () => {
    expect(isCompanyAdmin([{ company_id: 'c1', role: 'admin' }])).toBe(true);
  });

  it('is false for plain members and with no memberships', () => {
    expect(isCompanyAdmin([{ company_id: 'c1', role: 'member' }])).toBe(false);
    expect(isCompanyAdmin([])).toBe(false);
  });
});

describe('mergeEffectiveMemberships', () => {
  const COMPANY = '00000000-0000-4000-8000-00000000c0a1';
  const adminOf: CompanyMembership[] = [{ company_id: COMPANY, role: 'admin' }];
  const projects = [
    { id: PROJECT_A, company_id: COMPANY },
    { id: PROJECT_B, company_id: null },
  ];

  it('synthesizes super for company projects when the admin has no pm rows', () => {
    expect(mergeEffectiveMemberships([], adminOf, projects)).toEqual([
      { project_id: PROJECT_A, role: 'super' },
    ]);
  });

  it('overrides an explicit sub row on a company project (matches server is_super)', () => {
    const pm: Membership[] = [{ project_id: PROJECT_A, role: 'sub' }];
    expect(mergeEffectiveMemberships(pm, adminOf, projects)).toEqual([
      { project_id: PROJECT_A, role: 'super' },
    ]);
  });

  it('grants nothing to a plain company member', () => {
    const memberOf: CompanyMembership[] = [{ company_id: COMPANY, role: 'member' }];
    const pm: Membership[] = [{ project_id: PROJECT_B, role: 'sub' }];
    expect(mergeEffectiveMemberships(pm, memberOf, projects)).toEqual(pm);
  });

  it('leaves projects without a company untouched', () => {
    const pm: Membership[] = [{ project_id: PROJECT_B, role: 'sub' }];
    expect(mergeEffectiveMemberships(pm, adminOf, projects)).toEqual([
      { project_id: PROJECT_B, role: 'sub' },
      { project_id: PROJECT_A, role: 'super' },
    ]);
  });

  it('returns pm rows as-is when the user administers no company', () => {
    const pm: Membership[] = [{ project_id: PROJECT_A, role: 'sub' }];
    expect(mergeEffectiveMemberships(pm, [], projects)).toEqual(pm);
  });
});

describe('isProfileComplete', () => {
  it('is false for a null profile', () => {
    expect(isProfileComplete(null)).toBe(false);
  });

  it('is false when full_name is empty or whitespace', () => {
    expect(isProfileComplete({ full_name: '' })).toBe(false);
    expect(isProfileComplete({ full_name: '   ' })).toBe(false);
  });

  it('is true when full_name is set', () => {
    expect(isProfileComplete({ full_name: 'Sam Keystone' })).toBe(true);
  });
});

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('super@keystonebuild.com')).toBe(true);
    expect(isValidEmail('  cruz@keystonebuild.com  ')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false);
    expect(isValidEmail('@no-local.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('validateCredentials', () => {
  it('returns null for valid credentials', () => {
    expect(validateCredentials('super@keystonebuild.com', 'punchlist123')).toBeNull();
  });

  it('flags an invalid email', () => {
    const result = validateCredentials('bad', 'punchlist123');
    expect(result?.field).toBe('email');
  });

  it('flags a too-short password', () => {
    const result = validateCredentials('super@keystonebuild.com', '123');
    expect(result?.field).toBe('password');
  });
});
