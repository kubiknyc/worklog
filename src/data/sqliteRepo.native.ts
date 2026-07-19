/**
 * SQLite implementation of Repository (M1, native, offline read path).
 *
 * `Db` is the minimal query surface this repo needs (getAllAsync/getFirstAsync)
 * — a `Pick` off expo-sqlite's `SQLiteDatabase`, satisfied both by the real
 * device database and by a lightweight test fake (see sqliteRepo.native.test.ts).
 * This module never opens or migrates the database itself; platformRepo.native.ts
 * does that via openDb() and passes the open handle in.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { DailyReportRow, ProjectRow, Repository } from './types';

export type Db = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync'>;

export function createSqliteRepo(db: Db): Repository {
  return {
    async listProjects(): Promise<readonly ProjectRow[]> {
      return db.getAllAsync<ProjectRow>('SELECT id, name, address FROM projects ORDER BY name');
    },

    async getReportByDate(projectId: string, reportDate: string): Promise<DailyReportRow | null> {
      return db.getFirstAsync<DailyReportRow>(
        `SELECT id, project_id, report_date, status FROM daily_reports
         WHERE project_id = ? AND report_date = ?`,
        [projectId, reportDate],
      );
    },
  };
}
