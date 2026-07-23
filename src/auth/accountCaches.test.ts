/**
 * clearAccountCaches must sweep EVERY user-scoped prefix — the account blob
 * (profile PII + memberships) AND the M8a active-project choice. A surviving
 * activeProject key would leak user A's project selection into user B's
 * session on a shared device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  accountKey,
  activeProjectKey,
  clearAccountCaches,
  pruneAccountForCache,
} from './accountCaches';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('key builders are user-scoped', () => {
  expect(accountKey('u1')).toBe('account:u1');
  expect(activeProjectKey('u1')).toBe('activeProject:u1');
});

test('sweeps account and activeProject keys for every user, leaves others', async () => {
  await AsyncStorage.multiSet([
    [accountKey('u1'), '{"profile":null,"memberships":[]}'],
    [accountKey('u2-stale'), '{}'],
    [activeProjectKey('u1'), 'p-a'],
    [activeProjectKey('u2-stale'), 'p-b'],
    ['theme', 'editorial'], // device-scoped, must survive
  ]);

  await clearAccountCaches();

  expect(await AsyncStorage.getItem(accountKey('u1'))).toBeNull();
  expect(await AsyncStorage.getItem(accountKey('u2-stale'))).toBeNull();
  expect(await AsyncStorage.getItem(activeProjectKey('u1'))).toBeNull();
  expect(await AsyncStorage.getItem(activeProjectKey('u2-stale'))).toBeNull();
  expect(await AsyncStorage.getItem('theme')).toBe('editorial');
});

test('is best-effort: a storage failure resolves without throwing', async () => {
  const spy = jest
    .spyOn(AsyncStorage, 'getAllKeys')
    .mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(clearAccountCaches()).resolves.toBeUndefined();
  spy.mockRestore();
});

describe('pruneAccountForCache', () => {
  test('strips email and phone from the profile, keeps everything else', () => {
    const pruned = pruneAccountForCache({
      profile: { id: 'u1', full_name: 'User One', email: 'u1@example.com', phone: '555-0100' },
      memberships: [{ project_id: 'p1', role: 'super' }],
    });
    expect(pruned.profile).toEqual({ id: 'u1', full_name: 'User One' });
    expect(pruned.profile).not.toHaveProperty('email');
    expect(pruned.profile).not.toHaveProperty('phone');
    expect(pruned.memberships).toEqual([{ project_id: 'p1', role: 'super' }]);
  });

  test('passes a null profile through unchanged', () => {
    const pruned = pruneAccountForCache({ profile: null, memberships: [] });
    expect(pruned).toEqual({ profile: null, memberships: [] });
  });

  test('does not mutate the input account', () => {
    const account = {
      profile: { id: 'u1', email: 'u1@example.com', phone: null },
    };
    pruneAccountForCache(account);
    expect(account.profile).toEqual({ id: 'u1', email: 'u1@example.com', phone: null });
  });
});
