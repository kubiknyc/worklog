/**
 * Staggered entrance for a list of children — each child fades in and rises a
 * few px, offset by `step` ms from the previous one. One orchestrated page-load
 * reveal reads as more considered than scattered micro-interactions.
 *
 * Uses the native driver (opacity + translateY only) so it stays off the JS
 * thread, and honors the OS "reduce motion" setting by rendering statically.
 */
import { Children, useEffect, useRef } from 'react';
import { Animated, type ViewStyle } from 'react-native';

import { useReducedMotion } from '../hooks/useReducedMotion';

type Props = {
  readonly children: React.ReactNode;
  /** Delay between successive children, ms. */
  readonly step?: number;
  /** Delay before the first child animates, ms. */
  readonly initialDelay?: number;
  /** Distance each child travels upward as it fades in, px. */
  readonly travel?: number;
  readonly style?: ViewStyle;
};

const DURATION = 320;

export function Stagger({ children, step = 60, initialDelay = 0, travel = 8, style }: Props) {
  const items = Children.toArray(children);
  const reduceMotion = useReducedMotion();
  // Grow (never shrink) the animated-value array to match the current child
  // count. Sizing it once at mount crashes when a conditional child appears on a
  // later render (e.g. a dashboard banner flipping 0 → >0 on refresh):
  // `progress[index]` would be undefined and `.interpolate()` throws.
  // Topping up here is idempotent and preserves in-flight values.
  const progressRef = useRef<Animated.Value[]>([]);
  while (progressRef.current.length < items.length) {
    progressRef.current.push(new Animated.Value(reduceMotion ? 1 : 0));
  }
  const progress = progressRef.current;

  useEffect(() => {
    if (reduceMotion) {
      progress.forEach((value) => value.setValue(1));
      return;
    }
    const animations = progress.map((value, index) =>
      Animated.timing(value, {
        toValue: 1,
        duration: DURATION,
        delay: initialDelay + index * step,
        useNativeDriver: true,
      }),
    );
    Animated.parallel(animations).start();
    // Re-running only when the child count changes keeps the reveal a one-shot.
  }, [progress, reduceMotion, step, initialDelay, items.length]);

  return (
    <>
      {items.map((child, index) => {
        // Prefer the child's own key (Children.toArray assigns stable ones) so a
        // varying child count can't reattach an Animated.View to the wrong section.
        const key = (child as { key?: React.Key | null }).key ?? index;
        return (
          <Animated.View
            key={key}
            style={[
              style,
              {
                opacity: progress[index],
                transform: [
                  {
                    translateY: progress[index].interpolate({
                      inputRange: [0, 1],
                      outputRange: [travel, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {child}
          </Animated.View>
        );
      })}
    </>
  );
}
