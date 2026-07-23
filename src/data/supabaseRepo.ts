/**
 * Supabase implementation of Repository (online path — used by the web build and
 * as the native fallback when the device database can't open).
 *
 * Role/company scoping is enforced server-side by RLS: reads simply return fewer
 * rows for a sub than a super. Writes go through the SECURITY DEFINER RPCs
 * (create_report / update_section) which re-check authorization internally — the
 * client never holds direct INSERT/UPDATE on report tables.
 */
import { uuidv4 } from '../lib/uuid';
import { supabase } from '../supabase/client';
import type {
  DailyReportRow,
  Json,
  MemberRow,
  ProjectRow,
  ReportSectionRow,
  Repository,
  SectionKind,
  WeatherRow,
} from './types';

function fail(context: string, error: { readonly message: string }): never {
  // Raw PostgREST messages can leak schema detail — keep them out of the UI,
  // but log them so production failures stay diagnosable.
  console.warn(`[supabaseRepo] ${context} failed:`, error);
  throw new Error('Unable to load data. Please try again.');
}

const PROJECT_COLUMNS = 'id, name, address, timezone, lat, lng';

class SupabaseRepository implements Repository {
  async listProjects(): Promise<readonly ProjectRow[]> {
    const { data, error } = await supabase
      .from('projects')
      .select(PROJECT_COLUMNS)
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

  async getProject(projectId: string): Promise<ProjectRow | null> {
    const { data, error } = await supabase
      .from('projects')
      .select(PROJECT_COLUMNS)
      .eq('id', projectId)
      .maybeSingle();
    if (error) fail('getProject', error);
    return data as ProjectRow | null;
  }

  async getReport(reportId: string): Promise<DailyReportRow | null> {
    const { data, error } = await supabase
      .from('daily_reports')
      .select('id, project_id, report_date, status')
      .eq('id', reportId)
      .maybeSingle();
    if (error) fail('getReport', error);
    return data as DailyReportRow | null;
  }

  async listSections(reportId: string): Promise<readonly ReportSectionRow[]> {
    const { data, error } = await supabase
      .from('report_sections')
      .select('report_id, section, payload, is_complete, updated_at')
      .eq('report_id', reportId)
      .order('section', { ascending: true });
    if (error) fail('listSections', error);
    return (data ?? []) as unknown as ReportSectionRow[];
  }

  async getWeather(reportId: string): Promise<WeatherRow | null> {
    const { data, error } = await supabase
      .from('report_weather')
      .select(
        'report_id, weather_source, auto_condition, auto_temp_f, override_condition, override_temp_f',
      )
      .eq('report_id', reportId)
      .maybeSingle();
    if (error) fail('getWeather', error);
    return data as WeatherRow | null;
  }

  async listMembers(projectId: string): Promise<readonly MemberRow[]> {
    // Identity + role via the project_members → profiles FK embed; the optional
    // PM/super display title is a second RLS-scoped read (report_member_prefs
    // has no FK to project_members to embed across), merged by user_id.
    const { data, error } = await supabase
      .from('project_members')
      .select('user_id, role, profiles!inner(full_name, email)')
      .eq('project_id', projectId);
    if (error) fail('listMembers', error);

    const { data: prefs, error: prefsError } = await supabase
      .from('report_member_prefs')
      .select('user_id, title')
      .eq('project_id', projectId);
    if (prefsError) fail('listMembers(prefs)', prefsError);

    const titleByUser = new Map<string, string | null>(
      (prefs ?? []).map((p) => [p.user_id, p.title]),
    );

    type MemberJoin = {
      user_id: string;
      role: 'super' | 'sub';
      profiles: { full_name: string; email: string | null } | null;
    };
    const members = ((data ?? []) as unknown as MemberJoin[]).map<MemberRow>((m) => ({
      user_id: m.user_id,
      full_name: m.profiles?.full_name ?? '',
      email: m.profiles?.email ?? null,
      role: m.role,
      title: titleByUser.get(m.user_id) ?? null,
    }));
    members.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return members;
  }

  async createReport(projectId: string, reportDate: string): Promise<DailyReportRow> {
    // Get-or-create is server-side and idempotent on p_client_id: the RPC returns
    // this id on success, or the winner's id on a same-day natural-key collision.
    const { data, error } = await supabase.rpc('create_report', {
      p_project_id: projectId,
      p_report_date: reportDate,
      p_client_id: uuidv4(),
    });
    if (error) fail('createReport', error);
    const reportId = data?.[0]?.report_id;
    if (!reportId) fail('createReport', { message: 'create_report returned no report id' });
    const report = await this.getReport(reportId);
    if (!report) fail('createReport', { message: 'created report not found' });
    return report;
  }

  async updateSection(
    reportId: string,
    section: SectionKind,
    content: Json,
    isComplete: boolean,
  ): Promise<void> {
    const { error } = await supabase.rpc('update_section', {
      p_report_id: reportId,
      p_section: section,
      // The generated RPC arg type uses supabase-js's own `Json` (mutable
      // arrays); our seam's `Json` is structurally the same but readonly, so a
      // cast bridges the two nominal Json types without loosening the seam.
      p_payload: content as never,
      p_is_complete: isComplete,
    });
    if (error) fail('updateSection', error);
  }
}

export const supabaseRepository: Repository = new SupabaseRepository();
