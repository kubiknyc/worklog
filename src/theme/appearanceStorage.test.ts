/**
 * appearanceStorage — device-scoped theme/density persistence: round-trip,
 * per-field fallback on unknown names, and junk tolerance (a corrupt value
 * must read as "nothing persisted", never throw).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadAppearance, saveAppearance } from './appearanceStorage';

const KEY = 'appearance:v1';

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('reads null when nothing is persisted', async () => {
  expect(await loadAppearance()).toBeNull();
});

it('round-trips a saved appearance', async () => {
  saveAppearance({ theme: 'editorial', density: 'compact' });
  await Promise.resolve(); // let the fire-and-forget write settle
  expect(await loadAppearance()).toEqual({ theme: 'editorial', density: 'compact' });
});

it('falls back per-field when a persisted name is unknown', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ theme: 'neon', density: 'compact' }));
  expect(await loadAppearance()).toEqual({ theme: 'blueprint', density: 'compact' });

  await AsyncStorage.setItem(KEY, JSON.stringify({ theme: 'beton', density: 42 }));
  expect(await loadAppearance()).toEqual({ theme: 'beton', density: 'comfortable' });
});

it('reads junk as nothing persisted instead of throwing', async () => {
  await AsyncStorage.setItem(KEY, 'not json {');
  expect(await loadAppearance()).toBeNull();

  await AsyncStorage.setItem(KEY, '"a string"');
  expect(await loadAppearance()).toBeNull();
});
