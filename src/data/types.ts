/**
 * Repository seam types (M1). `Repository` is the only data surface screens
 * may import (doc 02 §C) — M2+ extends this interface with write methods as
 * the report-editing flows land.
 */
export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
}

export interface DailyReportRow {
  readonly id: string;
  readonly project_id: string;
  readonly report_date: string; // YYYY-MM-DD
  readonly status: 'draft' | 'submitted' | 'locked';
}

export interface Repository {
  listProjects(): Promise<readonly ProjectRow[]>;
  getReportByDate(projectId: string, reportDate: string): Promise<DailyReportRow | null>;
}
