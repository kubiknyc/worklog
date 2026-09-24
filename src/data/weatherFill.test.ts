import { fillWeather } from './weatherFill';

const mockInvoke = jest.fn();

jest.mock('../supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

beforeEach(() => {
  mockInvoke.mockClear();
});

describe('fillWeather', () => {
  it('calls the edge function with the project/report_date body', async () => {
    mockInvoke.mockResolvedValue({
      data: { status: 'ok', condition: 'Clear', temp_f: 71 },
      error: null,
    });

    const result = await fillWeather('p1', '2026-08-27');

    expect(mockInvoke).toHaveBeenCalledWith('worklog-weather', {
      body: { project_id: 'p1', report_date: '2026-08-27' },
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it.each([['no_geolocation'], ['manual_override'], ['report_locked'], ['fetch_failed']] as const)(
    'passes through a known soft status %s',
    async (status) => {
      mockInvoke.mockResolvedValue({ data: { status }, error: null });
      expect(await fillWeather('p1', '2026-08-27')).toEqual({ status });
    },
  );

  it('maps a supabase-js error to networkError without throwing', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });
    expect(await fillWeather('p1', '2026-08-27')).toEqual({ status: 'networkError' });
  });

  it('maps a rejected invoke() to networkError without throwing', async () => {
    mockInvoke.mockRejectedValue(new Error('network down'));
    await expect(fillWeather('p1', '2026-08-27')).resolves.toEqual({ status: 'networkError' });
  });

  it('maps an unrecognized/malformed response body to networkError', async () => {
    mockInvoke.mockResolvedValue({ data: { status: 'something_new' }, error: null });
    expect(await fillWeather('p1', '2026-08-27')).toEqual({ status: 'networkError' });

    mockInvoke.mockResolvedValue({ data: null, error: null });
    expect(await fillWeather('p1', '2026-08-27')).toEqual({ status: 'networkError' });
  });
});
