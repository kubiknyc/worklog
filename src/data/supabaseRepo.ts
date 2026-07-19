/**
 * Supabase implementation of Repository (M1, online read path — used by the
 * web build and as the native fallback when the device database can't open).
 *
 * Role/company scoping is enforced server-side by RLS: these queries simply
 * return fewer rows for a sub than a super, so the client never filters by
 * role itself.
 */
import { supabase } from '../supabase/client';
import type { DailyReportRow, ProjectRow, Repository } from './types';

function fail(context: string, error: { readonly message: string }): never {
  // Raw PostgREST messages can leak schema detail — keep them out of the UI,
  // but log them so production failures stay diagnosable.
  console.warn(`[supabaseRepo] ${context} failed:`, error);
  throw new Error('Unable to load data. Please try again.');
}

class SupabaseRepository implements Repository {
  async listProjects(): Promise<readonly ProjectRow[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, address')
      .order('name', { ascending: true });
    if (error) fail('listProjects', error);
    return (data ?? []) as ProjectRow[];
  }

  async getReportByDate(projectId: string, reportDate: string): Promise<DailyReportRow | null> {
    const { data, error } = await supabase
      .from('daily_reports')
      .select('id, project_id, report_date, status')
      .eq('project_id', projectId)
      .eq('report_date', reportDate)
      .maybeSingle();
    if (error) fail('getReportByDate', error);
    return data as DailyReportRow | null;
  }
}

export const supabaseRepository: Repository = new SupabaseRepository();
