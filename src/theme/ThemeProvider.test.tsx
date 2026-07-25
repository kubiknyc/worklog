/**
 * ThemeProvider persistence (M8 item 4b) — hydrates the stored appearance,
 * writes changes through, and never lets an in-flight hydration read clobber
 * a selection the user just made.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ThemeProvider, useThemeContext, type ThemeContextValue } from './ThemeProvider';

const KEY = 'appearance:v1';

let latest: ThemeContextValue | null = null;

function Probe() {
  latest = useThemeContext();
  return null;
}

async function renderProvider(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(async () => {
  latest = null;
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

it('starts with the defaults and flips isHydrated when nothing is persisted', async () => {
  await renderProvider();
  expect(latest?.theme.name).toBe('blueprint');
  expect(latest?.theme.densityName).toBe('comfortable');
  expect(latest?.isHydrated).toBe(true);
});

it('hydrates a persisted selection', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ theme: 'beton', density: 'compact' }));
  await renderProvider();
  expect(latest?.theme.name).toBe('beton');
  expect(latest?.theme.densityName).toBe('compact');
  expect(latest?.isHydrated).toBe(true);
});

it('persists a change so the next mount hydrates it', async () => {
  await renderProvider();
  await act(async () => latest?.setThemeName('editorial'));
  expect(JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}')).toEqual({
    theme: 'editorial',
    density: 'comfortable',
  });
});

it('a change made while hydration is in flight is not clobbered by the stale read', async () => {
  // Deferred getItem: capture the resolver so the hydration read completes
  // only after the user has already picked a theme.
  let resolveRead!: (value: string | null) => void;
  jest
    .spyOn(AsyncStorage, 'getItem')
    .mockImplementation(() => new Promise<string | null>((resolve) => (resolveRead = resolve)));

  await renderProvider();
  expect(latest?.isHydrated).toBe(false);

  await act(async () => latest?.setThemeName('editorial'));
  await act(async () => resolveRead(JSON.stringify({ theme: 'beton', density: 'compact' })));

  expect(latest?.isHydrated).toBe(true);
  expect(latest?.theme.name).toBe('editorial'); // the user's pick wins
});
