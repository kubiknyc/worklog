import { createSqliteRepo } from './sqliteRepo.native';

type Row = Record<string, unknown>;
function fakeDb(rows: { projects: Row[]; daily_reports: Row[] }) {
  return {
    getAllAsync: async (sql: string): Promise<Row[]> =>
      /FROM projects/i.test(sql) ? rows.projects : [],
    getFirstAsync: async (sql: string, params: readonly unknown[]): Promise<Row | null> => {
      if (!/FROM daily_reports/i.test(sql)) return null;
      const [projectId, reportDate] = params;
      return (
        rows.daily_reports.find((r) => r.project_id === projectId && r.report_date === reportDate) ?? null
      );
    },
  };
}

describe('sqliteRepo', () => {
  it('lists projects', async () => {
    const repo = createSqliteRepo(fakeDb({ projects: [{ id: 'p1', name: 'Site A', address: null }], daily_reports: [] }) as never);
    expect(await repo.listProjects()).toEqual([{ id: 'p1', name: 'Site A', address: null }]);
  });

  it('getReportByDate returns the matching row or null', async () => {
    const report = { id: 'r1', project_id: 'p1', report_date: '2026-07-18', status: 'draft' };
    const repo = createSqliteRepo(fakeDb({ projects: [], daily_reports: [report] }) as never);
    expect(await repo.getReportByDate('p1', '2026-07-18')).toEqual(report);
    expect(await repo.getReportByDate('p1', '2026-07-19')).toBeNull();
  });
});
