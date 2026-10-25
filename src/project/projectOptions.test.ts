import { buildProjectOptions, UNSYNCED_PROJECT_NAME } from './projectOptions';

const m = (project_id: string, role: 'super' | 'sub' = 'super') => ({ project_id, role });

describe('buildProjectOptions', () => {
  it('lists every membership, sorted by name, marking the active one', () => {
    const projects = new Map([
      ['p2', { name: 'Interiors', address: '244 5th Avenue' }],
      ['p1', { name: 'hunt residence', address: '15 E 93rd St' }],
    ]);
    const out = buildProjectOptions([m('p2'), m('p1', 'sub')], projects, 'p2');
    expect(out).toEqual([
      { id: 'p1', name: 'hunt residence', address: '15 E 93rd St', role: 'sub', active: false },
      { id: 'p2', name: 'Interiors', address: '244 5th Avenue', role: 'super', active: true },
    ]);
  });

  it('keeps a membership whose project row has not synced, under a placeholder', () => {
    const out = buildProjectOptions([m('p9')], new Map([['p9', null]]), null);
    expect(out).toEqual([
      { id: 'p9', name: UNSYNCED_PROJECT_NAME, address: null, role: 'super', active: false },
    ]);
  });

  it('dedupes memberships and breaks name ties by id so order is stable', () => {
    const projects = new Map([
      ['b', { name: 'Hunt Residence' }],
      ['a', { name: 'Hunt residence' }],
    ]);
    const out = buildProjectOptions([m('b'), m('a'), m('b')], projects, null);
    expect(out.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('treats a blank name or address as missing', () => {
    const out = buildProjectOptions([m('p')], new Map([['p', { name: '  ', address: ' ' }]]), 'p');
    expect(out[0]).toMatchObject({ name: UNSYNCED_PROJECT_NAME, address: null, active: true });
  });

  it('returns an empty list with no memberships', () => {
    expect(buildProjectOptions([], new Map(), null)).toEqual([]);
  });
});
