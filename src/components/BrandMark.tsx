/**
 * WorkLog brand mark — a field-notebook daily-report page, built from plain
 * React Native primitives + Ionicons (no react-native-svg dependency).
 *
 * Design: a white ruled page on slate ink, with a bold accent date-stamp
 * block in the top-left corner (the report's date) and one green check row
 * (report filed — the lifecycle's terminal state). This is a new WorkLog
 * design, not a port of PunchLog's clipboard mark — it borrows PunchLog's
 * construction technique only (RN primitives + Ionicons, 120-unit design
 * box, fixed internal palette so the mark reads identically across themes;
 * see PL/src/components/BrandMark.tsx).
 *
 * The internal palette is FIXED — logos shouldn't re-tint with the active
 * theme — so the accent below is WorkLog's blueprint accent read as a
 * literal (src/theme/tokens.ts PALETTES.blueprint.accent), not via useTheme.
 *
 *   <BrandMark size={64} />        // page on the current background
 *   <BrandMark size={64} chip />   // page on the accent app-icon field
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

const INK = '#0F172A'; // slate ink
const PAPER = '#FFFFFF';
const GREEN = '#16A34A'; // report filed
const ACCENT = '#4FC3F7'; // WorkLog blueprint accent (PALETTES.blueprint.accent), fixed literal
const LINE = '#CBD2DA';
const LINE_FAINT = '#E2E5EA';

type BrandMarkProps = {
  /** Height of the square logo box in px. Default 64. */
  readonly size?: number;
  /** Draw the accent rounded-square field behind the mark (app-icon look). */
  readonly chip?: boolean;
};

export function BrandMark({ size = 64, chip = false }: BrandMarkProps) {
  // Everything scales off a 120-unit design box (matches the exported icons).
  const u = size / 120;
  const onChip = chip;

  const ruledLine = (top: number, width: number, color: string) => (
    <View
      style={{
        position: 'absolute',
        left: 21 * u,
        top: top * u,
        width: width * u,
        height: 4 * u,
        borderRadius: 2 * u,
        backgroundColor: color,
      }}
    />
  );

  const mark = (
    <View style={{ width: size, height: size }} testID={chip ? undefined : 'brand-mark'}>
      {/* notebook page */}
      <View
        style={{
          position: 'absolute',
          left: 15 * u,
          top: 11 * u,
          width: 90 * u,
          height: 98 * u,
          borderRadius: 10 * u,
          borderWidth: onChip ? 0 : 6 * u,
          borderColor: INK,
          backgroundColor: PAPER,
        }}
      />
      {/* accent date-stamp block, top-left corner */}
      <View
        style={{
          position: 'absolute',
          left: 21 * u,
          top: 17 * u,
          width: 34 * u,
          height: 22 * u,
          borderRadius: 5 * u,
          backgroundColor: onChip ? INK : ACCENT,
        }}
      />
      {/* ruled lines beneath the date stamp */}
      {ruledLine(50, 78, LINE)}
      {ruledLine(62, 78, LINE)}
      {ruledLine(74, 60, LINE_FAINT)}
      {/* report-filed check row */}
      <View
        style={{
          position: 'absolute',
          left: 21 * u,
          top: 86 * u,
          width: 15 * u,
          height: 15 * u,
          borderRadius: 7.5 * u,
          backgroundColor: GREEN,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="checkmark" size={11 * u} color={PAPER} />
      </View>
    </View>
  );

  if (!chip) return mark;

  return (
    <View
      testID="brand-mark"
      style={[styles.chip, { width: size * 1.34, height: size * 1.34, borderRadius: size * 0.3 }]}
    >
      {mark}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
