/**
 * TextField — a controlled labelled text input for section-input sheets. Single
 * line by default; `multiline` grows to fit sentence-shaped fields (work notes,
 * general notes). Colors/height/radius come from theme tokens.
 *
 * The `accessory` slot is the reserved mount point for the M8 voice mic — it
 * renders to the right of the input. Per PRD §9 AC-A3 this is ALWAYS a normal
 * text field with full keyboard parity: the accessory only augments it, it
 * never replaces typing. When no accessory is passed the field is a plain
 * input, so this component works unchanged before voice ships.
 */
import { type ReactNode } from 'react';
import {
  type KeyboardTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { useTheme } from '../theme';

type Props = {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
  readonly keyboardType?: KeyboardTypeOptions;
  /** Right-side slot — reserved mount point for the M8 voice mic (AC-A3). */
  readonly accessory?: ReactNode;
};

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  autoCapitalize = 'sentences',
  keyboardType,
  accessory,
}: Props) {
  const { colors, fonts, radii, sizes } = useTheme();

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
        {label}
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          style={[
            styles.input,
            {
              borderColor: colors.border,
              borderRadius: radii.input,
              backgroundColor: colors.surface2,
              color: colors.text,
              fontFamily: fonts.ui.regular,
            },
            multiline ? styles.multiline : { height: sizes.inputHeight },
          ]}
        />
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  multiline: { minHeight: 96, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'top' },
  accessory: { alignSelf: 'stretch', justifyContent: 'center' },
});
