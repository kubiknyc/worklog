import { geocodeProject } from './geocodeProject';

const mockInvoke = jest.fn();

jest.mock('../supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('geocodeProject', () => {
  it('calls worklog-geocode with the project id', async () => {
    mockInvoke.mockResolvedValue({
      data: { status: 'geocoded', lat: 40.78, lng: -73.95 },
      error: null,
    });
    await expect(geocodeProject('p1')).resolves.toEqual({ status: 'geocoded' });
    expect(mockInvoke).toHaveBeenCalledWith('worklog-geocode', { body: { project_id: 'p1' } });
  });

  it.each([
    ['already_located'],
    ['no_address'],
    ['not_found'],
    ['throttled'],
    ['fetch_failed'],
  ] as const)('passes through the soft status %s', async (status) => {
    mockInvoke.mockResolvedValue({ data: { status }, error: null });
    await expect(geocodeProject('p1')).resolves.toEqual({ status });
  });

  it('maps a function error to networkError', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('403') });
    await expect(geocodeProject('p1')).resolves.toEqual({ status: 'networkError' });
  });

  it('maps an unknown payload to networkError', async () => {
    mockInvoke.mockResolvedValue({ data: { status: 'weird' }, error: null });
    await expect(geocodeProject('p1')).resolves.toEqual({ status: 'networkError' });
  });

  it('never throws, even if invoke rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('offline'));
    await expect(geocodeProject('p1')).resolves.toEqual({ status: 'networkError' });
  });
});
