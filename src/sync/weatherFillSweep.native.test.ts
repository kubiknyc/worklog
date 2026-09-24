/**
 * Control-flow test against a mocked `all()` — the query itself is one
 * static, hand-verified SQL string (weather_source='none', not locked,
 * project has a pin); what needs proving here is the sweep's behavior around
 * whatever rows it gets back: calls `fillWeather` per row, in order, and
 * never throws regardless of what either dependency does.
 */
import { runWeatherFillSweep } from './weatherFillSweep.native';
import { all } from '../db/rows.native';
import { fillWeather } from '../data/weatherFill';
import type { Db } from '../db/rows.native';

jest.mock('../db/rows.native', () => ({ all: jest.fn() }));
jest.mock('../data/weatherFill', () => ({ fillWeather: jest.fn() }));

const mockAll = all as jest.MockedFunction<typeof all>;
const mockFillWeather = fillWeather as jest.MockedFunction<typeof fillWeather>;
const FAKE_DB = {} as Db;

beforeEach(() => {
  mockAll.mockReset();
  mockFillWeather.mockReset();
  mockFillWeather.mockResolvedValue({ status: 'ok' });
});

describe('runWeatherFillSweep', () => {
  it('does nothing when no reports are due', async () => {
    mockAll.mockResolvedValue([]);
    await runWeatherFillSweep(FAKE_DB);
    expect(mockFillWeather).not.toHaveBeenCalled();
  });

  it('calls fillWeather once per due report, in order', async () => {
    mockAll.mockResolvedValue([
      { report_id: 'r1', project_id: 'p1', report_date: '2026-08-27' },
      { report_id: 'r2', project_id: 'p2', report_date: '2026-08-26' },
    ]);

    await runWeatherFillSweep(FAKE_DB);

    expect(mockFillWeather).toHaveBeenNthCalledWith(1, 'p1', '2026-08-27');
    expect(mockFillWeather).toHaveBeenNthCalledWith(2, 'p2', '2026-08-26');
    expect(mockFillWeather).toHaveBeenCalledTimes(2);
  });

  it('never throws when the read itself fails', async () => {
    mockAll.mockRejectedValue(new Error('db closed'));
    await expect(runWeatherFillSweep(FAKE_DB)).resolves.toBeUndefined();
    expect(mockFillWeather).not.toHaveBeenCalled();
  });

  it('a rejected fillWeather for one row does not stop the rest', async () => {
    mockAll.mockResolvedValue([
      { report_id: 'r1', project_id: 'p1', report_date: '2026-08-27' },
      { report_id: 'r2', project_id: 'p2', report_date: '2026-08-26' },
    ]);
    mockFillWeather.mockRejectedValueOnce(new Error('unexpected throw'));

    await expect(runWeatherFillSweep(FAKE_DB)).resolves.toBeUndefined();

    expect(mockFillWeather).toHaveBeenCalledTimes(2);
    expect(mockFillWeather).toHaveBeenNthCalledWith(2, 'p2', '2026-08-26');
  });
});
