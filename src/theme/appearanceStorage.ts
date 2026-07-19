/**
 * Device-scoped persistence for the appearance selection (theme + density).
 *
 * Deliberately NOT user-scoped and NOT swept by clearAccountCaches: a theme
 * is cosmetic, not account data (BUILD_PLAN M8 item 4b), so it survives user
 * switches on a shared device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  DENSITIES,
  PALETTES,
  type DensityName,
  type ThemeName,
} from './tokens';

const APPEARANCE_KEY = 'appearance:v1';

export interface Appearance {
  readonly theme: ThemeName;
  readonly density: DensityName;
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && value in PALETTES;
}

function isDensityName(value: unknown): value is DensityName {
  return typeof value === 'string' && value in DENSITIES;
}

/**
 * Read the persisted appearance. Unknown fields fall back to the defaults and
 * unreadable storage reads as "nothing persisted" — a corrupt value must never
 * take the app down over cosmetics.
 */
export async function loadAppearance(): Promise<Appearance | null> {
  try {
    const raw = await AsyncStorage.getItem(APPEARANCE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const { theme, density } = parsed as { theme?: unknown; density?: unknown };
    return {
      theme: isThemeName(theme) ? theme : DEFAULT_THEME,
      density: isDensityName(density) ? density : DEFAULT_DENSITY,
    };
  } catch {
    return null;
  }
}

/** Fire-and-forget write; a failed persist only costs the next launch's theme. */
export function saveAppearance(appearance: Appearance): void {
  AsyncStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)).catch(() => {});
}
