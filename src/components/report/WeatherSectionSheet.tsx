/**
 * WeatherSectionSheet — read-only auto snapshot + always-available manual
 * override (PRD weather Must). Override writes WeatherOverrideContent; the
 * auto fetch (M9) never overwrites it.
 */
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { WeatherRow } from '../../data/types';
import type { WeatherOverrideContent } from '../../sync/types';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { Stepper } from '../Stepper';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { WEATHER_CONDITIONS } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

const MIN_F = -30;
const MAX_F = 130;
const DEFAULT_F = 60;

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initialWeather: WeatherRow | null;
  readonly onClose: () => void;
};

export function WeatherSectionSheet({ visible, reportId, initialWeather, onClose }: Props) {
  const { colors, fonts } = useTheme();
  const initial: WeatherOverrideContent = {
    condition: initialWeather?.override_condition ?? null,
    tempF: initialWeather?.override_temp_f ?? null,
  };
  const { draft, setDraft, flush } = useSectionDraft<WeatherOverrideContent>(
    reportId,
    'weather',
    initial,
  );

  const autoCondition = initialWeather?.auto_condition ?? null;
  const autoTemp = initialWeather?.auto_temp_f ?? null;
  const autoText =
    autoCondition || typeof autoTemp === 'number'
      ? [autoCondition, typeof autoTemp === 'number' ? `${Math.round(autoTemp)}°F` : null]
          .filter(Boolean)
          .join(' · ')
      : 'Will fill when online'; // matches summarizeWeather's row copy (summarize.ts)

  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  return (
    <SectionSheetScaffold
      visible={visible}
      title="Weather"
      testID="sheet-weather"
      onClose={close}
      footer={<PrimaryButton testID="sheet-weather-done" label="Done" onPress={close} />}
    >
      <View style={[styles.auto, { borderColor: colors.border, backgroundColor: colors.surface2 }]}>
        <Text style={[styles.autoLabel, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
          Auto-fetched
        </Text>
        <Text style={[styles.autoText, { color: colors.text, fontFamily: fonts.ui.semibold }]}>
          {autoText}
        </Text>
      </View>

      <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
        Condition (manual override)
      </Text>
      <ChipRow
        options={WEATHER_CONDITIONS}
        value={draft.condition}
        onChange={(condition) => setDraft({ ...draft, condition })}
      />

      <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
        Temperature
      </Text>
      <Stepper
        value={draft.tempF ?? DEFAULT_F}
        onChange={(tempF) => setDraft({ ...draft, tempF })}
        min={MIN_F}
        max={MAX_F}
        unitLabel="°F"
        accessibilityLabel="Temperature"
      />

      <Text style={[styles.hint, { color: colors.faint, fontFamily: fonts.ui.regular }]}>
        A manual override is never overwritten by the automatic fetch.
      </Text>
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  auto: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
  autoLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  autoText: { fontSize: 16 },
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  hint: { fontSize: 13, marginTop: 4 },
});
