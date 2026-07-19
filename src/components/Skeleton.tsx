/**
 * Lightweight loading placeholders with a gentle animated-opacity shimmer
 * (static under the OS "reduce motion" setting).
 * `ListSkeleton` mimics a stack of list rows; `CardSkeleton` a hero card.
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useTheme } from '../theme';

function useShimmer(): Animated.Value {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.6); // readable static placeholder, no pulsing
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);
  return opacity;
}

interface BlockProps {
  readonly width: DimensionValue;
  readonly height: number;
  readonly opacity: Animated.Value;
  readonly radius?: number;
}

function Block({ width, height, opacity, radius = 8 }: BlockProps) {
  const { colors } = useTheme();
  return (
    <Animated.View
      style={{ width, height, borderRadius: radius, backgroundColor: colors.surface2, opacity }}
    />
  );
}

function RowSkeleton({ opacity }: { readonly opacity: Animated.Value }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Block width={4} height={48} opacity={opacity} radius={2} />
      <View style={styles.rowBody}>
        <Block width="35%" height={11} opacity={opacity} />
        <Block width="80%" height={14} opacity={opacity} />
        <Block width="55%" height={11} opacity={opacity} />
      </View>
      <Block width={34} height={34} opacity={opacity} radius={10} />
    </View>
  );
}

export function ListSkeleton({ count = 6 }: { readonly count?: number }) {
  const opacity = useShimmer();
  return (
    <View style={styles.list} accessible accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, index) => (
        <RowSkeleton key={`skel-${index}`} opacity={opacity} />
      ))}
    </View>
  );
}

export function CardSkeleton() {
  const opacity = useShimmer();
  const { colors } = useTheme();
  return (
    <View style={styles.cards} accessible accessibilityLabel="Loading">
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Block width="40%" height={12} opacity={opacity} />
        <Block width="60%" height={34} opacity={opacity} />
        <Block width="100%" height={10} opacity={opacity} radius={5} />
      </View>
      <View style={styles.grid}>
        {Array.from({ length: 4 }, (_, index) => (
          <View
            key={`skel-${index}`}
            style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Block width="50%" height={28} opacity={opacity} />
            <Block width="70%" height={11} opacity={opacity} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function DetailSkeleton() {
  const opacity = useShimmer();
  const { colors } = useTheme();
  return (
    <View style={styles.detail} accessible accessibilityLabel="Loading">
      <View
        style={[
          styles.detailPhoto,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Block width={28} height={28} opacity={opacity} radius={8} />
      </View>
      <View style={styles.detailRow}>
        <Block width={110} height={26} opacity={opacity} radius={999} />
        <Block width={90} height={14} opacity={opacity} />
      </View>
      <Block width="85%" height={24} opacity={opacity} />
      <Block width="100%" height={14} opacity={opacity} />
      <Block width="70%" height={14} opacity={opacity} />
      <View
        style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Block width="45%" height={12} opacity={opacity} />
        <Block width="65%" height={16} opacity={opacity} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingRight: 12,
    overflow: 'hidden',
  },
  rowBody: { flex: 1, gap: 7, paddingVertical: 14 },
  cards: { gap: 12 },
  card: { borderWidth: 1, borderRadius: 18, padding: 20, gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '47.5%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  detail: { padding: 16, gap: 14 },
  detailPhoto: {
    height: 150,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 10, marginTop: 4 },
});
