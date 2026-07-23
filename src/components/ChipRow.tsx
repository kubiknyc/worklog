/**
 * ChipRow — a wrapping row of {@link Chip}s for single- or multi-select over a
 * fixed option list. The two modes are modelled as an explicit discriminated
 * union on `multi` so a caller cannot mix single-select props (`value`) with
 * multi-select props (`values`): the wrong pairing fails typecheck.
 *
 * Chips wrap (flexWrap) with an ≥8 px gap between adjacent hit areas
 * (PRD §9 AC-T2), and numbers/labels never truncate under dynamic type (AC-A2).
 */
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';
import { Chip } from './Chip';

export type ChipOption = {
  readonly value: string;
  readonly label: string;
};

type SingleSelectProps = {
  readonly options: readonly ChipOption[];
  readonly multi?: false;
  /** Selected value, or null when nothing is chosen. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly disabled?: boolean;
};

type MultiSelectProps = {
  readonly options: readonly ChipOption[];
  readonly multi: true;
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly disabled?: boolean;
};

type Props = SingleSelectProps | MultiSelectProps;

export function ChipRow(props: Props) {
  const { spacing } = useTheme();

  return (
    <View style={[styles.row, { gap: spacing.sm }]}>
      {props.options.map((option) => {
        if (props.multi) {
          const selected = props.values.includes(option.value);
          return (
            <Chip
              key={option.value}
              label={option.label}
              selected={selected}
              disabled={props.disabled}
              onPress={() =>
                props.onChange(
                  selected
                    ? props.values.filter((v) => v !== option.value)
                    : [...props.values, option.value],
                )
              }
            />
          );
        }

        const selected = props.value === option.value;
        return (
          <Chip
            key={option.value}
            label={option.label}
            selected={selected}
            disabled={props.disabled}
            // Tapping the selected chip clears it (single-select toggle).
            onPress={() => props.onChange(selected ? null : option.value)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
