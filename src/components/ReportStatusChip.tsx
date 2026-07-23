/**
 * Small status pill — a colored dot + label tinted by the fixed status color.
 * Used in the report detail header and anywhere a single status needs a label.
 *
 * Ported from PunchLog's StatusChip with ItemStatus remapped onto WorkLog's
 * report lifecycle (`ReportStatus` in src/theme/tokens.ts). The dot + text
 * label pairing is deliberate: status is never conveyed by color alone.
 */
import { StyleSheet, Text, View } from 'react-native';

import { useTheme, type ReportStatus } from '../theme';

/**
 * Canonical report-status display labels. `amended` is the derived display
 * state (a locked report with >=1 amendment — see src/theme/tokens.ts).
 */
export const REPORT_STATUS_LABELS: Readonly<Record<ReportStatus, string>> = {
  draft: 'Draft',
  submitted: 'Submitted',
  locked: 'Locked',
  amended: 'Amended',
} as const;

type Props = {
  readonly status: ReportStatus;
  readonly size?: 'sm' | 'md';
};

export function ReportStatusChip({ status, size = 'md' }: Props) {
  const { reportStatus: statusColors, fonts } = useTheme();
  const color = statusColors[status];
  const small = size === 'sm';

  return (
    <View
      style={[
        styles.chip,
        small ? styles.chipSm : styles.chipMd,
        { backgroundColor: `${color}22` },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text
        style={[small ? styles.labelSm : styles.labelMd, { color, fontFamily: fonts.ui.semibold }]}
      >
        {REPORT_STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: 999 },
  chipSm: { paddingHorizontal: 8, paddingVertical: 3, gap: 5 },
  chipMd: { paddingHorizontal: 10, paddingVertical: 5, gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  labelSm: { fontSize: 11, letterSpacing: 0.2 },
  labelMd: { fontSize: 12.5, letterSpacing: 0.2 },
});
