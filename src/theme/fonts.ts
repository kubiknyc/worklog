/**
 * Font loading map + family-name constants.
 *
 * Archivo  → UI (weights 400–900)
 * JetBrains Mono → item codes / mono labels
 * Spectral → serif display moments (wordmark, hero %, item title, empty state)
 *
 * The string keys here are the family names referenced via `fontFamily` in
 * styles once `useFonts(FONT_MAP)` reports loaded. Every family listed loads
 * at splash and gates first render — only ship families that are actually used.
 */
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Spectral_400Regular,
  Spectral_600SemiBold,
  Spectral_700Bold,
} from '@expo-google-fonts/spectral';

/** Passed directly to `useFonts` from `expo-font`. */
export const FONT_MAP = {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  Spectral_400Regular,
  Spectral_600SemiBold,
  Spectral_700Bold,
} as const;

/** Named font families for use in `fontFamily` style props. */
export const FONTS = {
  ui: {
    regular: 'Archivo_400Regular',
    medium: 'Archivo_500Medium',
    semibold: 'Archivo_600SemiBold',
    bold: 'Archivo_700Bold',
    extrabold: 'Archivo_800ExtraBold',
    black: 'Archivo_900Black',
  },
  mono: {
    regular: 'JetBrainsMono_400Regular',
    medium: 'JetBrainsMono_500Medium',
    bold: 'JetBrainsMono_700Bold',
  },
  serif: {
    regular: 'Spectral_400Regular',
    semibold: 'Spectral_600SemiBold',
    bold: 'Spectral_700Bold',
  },
} as const;
