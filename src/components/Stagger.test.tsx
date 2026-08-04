/**
 * `Stagger` had no test (#24 item 9) and no consumer (#22's audit).
 *
 * Its own header documents a crash it has already had: sizing the animated-value
 * array once at mount throws the moment a conditional child appears on a later
 * render, because `progress[index]` is undefined and `.interpolate()` is called
 * on it. The fix is a top-up loop. That regression is the one test here that
 * would have caught a real defect, so it is the one that matters.
 *
 * The reduce-motion path matters for a different reason: an entrance animation
 * is exactly the kind of motion that triggers vestibular symptoms, so honouring
 * the OS preference is an accessibility obligation, not a nicety.
 */
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Stagger } from './Stagger';

let mockReduceMotion = false;
jest.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

beforeEach(() => {
  mockReduceMotion = false;
});

function Items({ count }: { readonly count: number }) {
  return (
    <Stagger>
      {Array.from({ length: count }, (_, i) => (
        <Text key={`row-${i}`}>{`row ${i}`}</Text>
      ))}
    </Stagger>
  );
}

describe('Stagger', () => {
  it('renders every child', () => {
    render(<Items count={3} />);

    // A reveal that drops a child is worse than no reveal: the content is
    // simply missing, and nothing about a fade says so.
    for (let i = 0; i < 3; i += 1) expect(screen.getByText(`row ${i}`)).toBeTruthy();
  });

  it('renders nothing for no children', () => {
    const { toJSON } = render(<Stagger>{null}</Stagger>);

    expect(toJSON()).toBeNull();
  });

  it('survives a child count that grows on a later render', () => {
    const { rerender } = render(<Items count={1} />);

    // THE documented crash: a dashboard banner flipping 0 → >0 on refresh used
    // to throw here, because the animated-value array was sized once at mount
    // and `progress[index].interpolate()` ran on undefined.
    expect(() => rerender(<Items count={4} />)).not.toThrow();
    expect(screen.getByText('row 3')).toBeTruthy();
  });

  it('survives a child count that shrinks', () => {
    const { rerender } = render(<Items count={4} />);

    // The array only ever grows, so the extra values are simply unused —
    // shrinking must not index past the children either.
    expect(() => rerender(<Items count={2} />)).not.toThrow();
    expect(screen.queryByText('row 3')).toBeNull();
  });

  it('still renders every child under reduce motion', () => {
    mockReduceMotion = true;
    render(<Items count={3} />);

    // Honouring the preference means rendering statically, never rendering
    // less: an entrance animation is a common vestibular trigger, and the
    // content it reveals is the whole screen.
    for (let i = 0; i < 3; i += 1) expect(screen.getByText(`row ${i}`)).toBeTruthy();
  });

  it('accepts custom timing and travel without dropping children', () => {
    render(
      <Stagger step={0} initialDelay={0} travel={0} style={{ marginTop: 4 }}>
        <Text>only</Text>
      </Stagger>,
    );

    expect(screen.getByText('only')).toBeTruthy();
  });

  it('renders children that carry no key of their own', () => {
    // Children.toArray assigns stable keys, but a raw children list still has
    // to fall back to the index path.
    render(
      <Stagger>
        <Text>alpha</Text>
        <Text>beta</Text>
      </Stagger>,
    );

    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
  });
});
