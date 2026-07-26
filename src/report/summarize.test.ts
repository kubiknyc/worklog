import type { WeatherRow } from '../data/types';
import { summarizeSection, summarizeWeather, summarizeCrewWork } from './summarize';

describe('summarizeSection — tri-state', () => {
  test('untouched section reads "Tap to add" / empty', () => {
    expect(summarizeSection('crew', { rows: [] }, false)).toEqual({
      text: 'Tap to add',
      state: 'empty',
    });
  });

  test('deliberately empty (isComplete) reads "None today" / none', () => {
    expect(summarizeSection('safety', { rows: [] }, true)).toEqual({
      text: 'None today',
      state: 'none',
    });
  });

  test('malformed payload never throws — treated as empty', () => {
    expect(summarizeSection('crew', null, false).state).toBe('empty');
    expect(summarizeSection('deliveries', 42, false).state).toBe('empty');
    expect(summarizeSection('rfis', { entries: 'nope' }, false).state).toBe('empty');
  });
});

describe('summarizeSection — filled descriptions', () => {
  test('crew sums headcount across trades and pluralizes', () => {
    const payload = {
      rows: [
        { id: '1', trade: 'Electrical', headcount: 4, hours: 8, is_carried_forward: false },
        { id: '2', trade: 'Plumbing', headcount: 2, hours: 8, is_carried_forward: false },
      ],
    };
    expect(summarizeSection('crew', payload, false)).toEqual({
      text: '2 trades · 6 on site',
      state: 'filled',
    });
  });

  test('crew singular trade', () => {
    const payload = {
      rows: [{ id: '1', trade: 'Tile', headcount: 1, hours: 8, is_carried_forward: false }],
    };
    expect(summarizeSection('crew', payload, false).text).toBe('1 trade · 1 on site');
  });

  test('safety appends incident count when any row is an incident', () => {
    const payload = {
      rows: [
        { id: '1', obs_type: 'observation', description: null, is_incident: false },
        { id: '2', obs_type: 'recordable', description: 'cut', is_incident: true },
      ],
    };
    expect(summarizeSection('safety', payload, false).text).toBe('2 observations · 1 incident');
  });

  test('equipment counts only on-site items', () => {
    const payload = {
      rows: [
        { id: '1', name: 'Lift', status: 'active', on_site: true },
        { id: '2', name: 'Crane', status: 'idle', on_site: false },
      ],
    };
    expect(summarizeSection('equipment', payload, false).text).toBe('1 item on site');
  });

  test('deliveries uses the irregular plural', () => {
    const payload = {
      entries: [{ id: '1', supplier: 'A', material: 'rebar', quantity: 2, unit: 'loads' }],
    };
    expect(summarizeSection('deliveries', payload, false).text).toBe('1 delivery');
    const two = {
      entries: [
        ...payload.entries,
        { id: '2', supplier: 'B', material: 'block', quantity: 1, unit: 'pallets' },
      ],
    };
    expect(summarizeSection('deliveries', two, false).text).toBe('2 deliveries');
  });

  test('inspections flag failures', () => {
    const payload = {
      entries: [
        { id: '1', agency: 'DOB', inspector: null, result: 'passed', note: null },
        { id: '2', agency: 'FDNY', inspector: null, result: 'failed', note: null },
      ],
    };
    expect(summarizeSection('inspections', payload, false).text).toBe('2 inspections · 1 failed');
  });

  test('delays flag ongoing', () => {
    const payload = {
      rows: [
        {
          id: '1',
          cause: 'weather',
          responsible_party: null,
          duration_hours: null,
          is_ongoing: true,
          note: null,
        },
      ],
    };
    expect(summarizeSection('delays', payload, false).text).toBe('1 delay · 1 ongoing');
  });

  test('general notes previews and truncates long text', () => {
    const short = summarizeSection('general_notes', { text: 'Poured slab on grid C.' }, false);
    expect(short).toEqual({ text: 'Poured slab on grid C.', state: 'filled' });

    const long = 'A'.repeat(80);
    const preview = summarizeSection('general_notes', { text: long }, false);
    expect(preview.state).toBe('filled');
    expect(preview.text.endsWith('…')).toBe(true);
    expect(preview.text.length).toBeLessThanOrEqual(49);
  });

  test('blank notes with isComplete read as none', () => {
    expect(summarizeSection('general_notes', { text: '   ' }, true).state).toBe('none');
  });
});

describe('summarizeWeather', () => {
  const base: WeatherRow = {
    report_id: 'r1',
    weather_source: 'none',
    auto_condition: null,
    auto_temp_f: null,
    override_condition: null,
    override_temp_f: null,
  };

  test('null row reads empty with the offline hint', () => {
    expect(summarizeWeather(null)).toEqual({ text: 'Will fill when online', state: 'empty' });
  });

  test('override wins over auto snapshot', () => {
    const row: WeatherRow = {
      ...base,
      auto_condition: 'Cloudy',
      auto_temp_f: 60,
      override_condition: 'Rain',
      override_temp_f: 55.4,
    };
    expect(summarizeWeather(row)).toEqual({ text: 'Rain · 55°F', state: 'filled' });
  });

  test('auto snapshot used when no override', () => {
    const row: WeatherRow = { ...base, auto_condition: 'Clear', auto_temp_f: 72 };
    expect(summarizeWeather(row)).toEqual({ text: 'Clear · 72°F', state: 'filled' });
  });

  test('condition alone counts as filled', () => {
    const row: WeatherRow = { ...base, auto_condition: 'Windy' };
    expect(summarizeWeather(row)).toEqual({ text: 'Windy', state: 'filled' });
  });
});

describe('summarizeCrewWork', () => {
  const crew = {
    rows: [
      { id: '1', trade: 'Electrical', headcount: 4, hours: 8, is_carried_forward: false },
      { id: '2', trade: 'Plumbing', headcount: 2, hours: 8, is_carried_forward: false },
    ],
  };
  test('composes trades, headcount, and logged work', () => {
    const work = { rows: [{ id: 'w1', trade: 'Electrical', area: 'L3', note: 'pulled feeders' }] };
    expect(summarizeCrewWork(crew, work, false)).toEqual({
      text: '2 trades · 6 on site · 1 logged',
      state: 'filled',
    });
  });
  test('omits logged when no work rows', () => {
    expect(summarizeCrewWork(crew, { rows: [] }, false).text).toBe('2 trades · 6 on site');
  });
  test('empty + complete reads None today', () => {
    expect(summarizeCrewWork({ rows: [] }, { rows: [] }, true)).toEqual({
      text: 'None today',
      state: 'none',
    });
  });
  test('empty + not complete reads Tap to add', () => {
    expect(summarizeCrewWork({ rows: [] }, { rows: [] }, false).state).toBe('empty');
  });
});
