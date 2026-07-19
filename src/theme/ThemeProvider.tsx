/**
 * ThemeProvider + useTheme hook.
 *
 * Holds the active theme name and density, hydrated once from the
 * device-scoped appearance storage (M8 item 4b) and written through on every
 * change. Children render immediately with the defaults; `isHydrated` lets
 * the app root hold the splash until the persisted selection has landed, so
 * a returning user never sees a Blueprint flash. Blueprint is the default
 * theme; Comfortable is the default density.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { loadAppearance, saveAppearance } from './appearanceStorage';
import { FONTS } from './fonts';
import {
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  DENSITIES,
  ERROR_COLORS,
  FIXED_COLORS,
  PALETTES,
  PRIORITY_COLORS,
  RADII,
  REPORT_STATUS_COLORS,
  SIZES,
  SPACING,
  type Density,
  type DensityName,
  type Palette,
  type ThemeName,
} from './tokens';

export interface Theme {
  readonly name: ThemeName;
  readonly densityName: DensityName;
  readonly colors: Palette;
  readonly density: Density;
  readonly reportStatus: (typeof REPORT_STATUS_COLORS)[ThemeName];
  readonly priority: (typeof PRIORITY_COLORS)[ThemeName];
  /** Per-theme error text color (WCAG-AA on this theme's surfaces). */
  readonly error: string;
  readonly fixed: typeof FIXED_COLORS;
  readonly radii: typeof RADII;
  readonly sizes: typeof SIZES;
  readonly spacing: typeof SPACING;
  readonly fonts: typeof FONTS;
}

export interface ThemeContextValue {
  readonly theme: Theme;
  /** True once the persisted appearance has been read (or found absent). */
  readonly isHydrated: boolean;
  readonly setThemeName: (name: ThemeName) => void;
  readonly setDensityName: (name: DensityName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function buildTheme(name: ThemeName, densityName: DensityName): Theme {
  return {
    name,
    densityName,
    colors: PALETTES[name],
    density: DENSITIES[densityName],
    reportStatus: REPORT_STATUS_COLORS[name],
    priority: PRIORITY_COLORS[name],
    error: ERROR_COLORS[name],
    fixed: FIXED_COLORS,
    radii: RADII,
    sizes: SIZES,
    spacing: SPACING,
    fonts: FONTS,
  };
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [name, setName] = useState<ThemeName>(DEFAULT_THEME);
  const [densityName, setDensity] = useState<DensityName>(DEFAULT_DENSITY);
  const [isHydrated, setIsHydrated] = useState(false);
  // A manual change while the hydration read is in flight wins over the
  // stale persisted value (same race guard as ActiveProjectProvider).
  const touchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadAppearance().then((stored) => {
      if (cancelled) return;
      if (stored && !touchedRef.current) {
        setName(stored.theme);
        setDensity(stored.density);
      }
      setIsHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Write-through, but only after hydration — persisting the defaults before
  // the read lands would overwrite the stored selection.
  useEffect(() => {
    if (!isHydrated) return;
    saveAppearance({ theme: name, density: densityName });
  }, [isHydrated, name, densityName]);

  const setThemeName = useCallback((next: ThemeName) => {
    touchedRef.current = true;
    setName(next);
  }, []);

  const setDensityName = useCallback((next: DensityName) => {
    touchedRef.current = true;
    setDensity(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: buildTheme(name, densityName),
      isHydrated,
      setThemeName,
      setDensityName,
    }),
    [name, densityName, isHydrated, setThemeName, setDensityName],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return ctx;
}

/** Convenience hook returning just the resolved theme. */
export function useTheme(): Theme {
  return useThemeContext().theme;
}
