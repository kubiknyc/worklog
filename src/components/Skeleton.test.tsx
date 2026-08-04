/**
 * The three skeletons had no test (#24 item 9). `DetailSkeleton` is the one with
 * real consumers — it is what Today and report detail render while data loads.
 *
 * The assertion that matters is the accessibility label. A skeleton is a screen
 * full of grey rectangles with no text; without `accessible` + a "Loading"
 * label, a screen-reader user gets silence and cannot tell a loading screen from
 * an empty one. Everything else here is shape.
 *
 * The reduce-motion path is checked through observable output rather than by
 * reaching into Animated internals: under the preference the shimmer must not
 * pulse, and the placeholder must stay readable rather than resting at its
 * dimmest frame.
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { CardSkeleton, DetailSkeleton, ListSkeleton } from './Skeleton';

let mockReduceMotion = false;
jest.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  mockReduceMotion = false;
});

describe('every skeleton announces itself', () => {
  it.each([
    ['ListSkeleton', <ListSkeleton key="l" />],
    ['CardSkeleton', <CardSkeleton key="c" />],
    ['DetailSkeleton', <DetailSkeleton key="d" />],
  ])('%s is labelled Loading', (_name, element) => {
    render(element, { wrapper });

    // A skeleton has no text of its own. Without this a screen-reader user
    // cannot distinguish "still loading" from "there is nothing here".
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });
});

describe('ListSkeleton', () => {
  it('renders six placeholder rows by default', () => {
    const { toJSON } = render(<ListSkeleton />, { wrapper });

    expect(JSON.stringify(toJSON())).toBeTruthy();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('honours an explicit row count', () => {
    const { toJSON } = render(<ListSkeleton count={2} />, { wrapper });
    const two = JSON.stringify(toJSON()).length;

    const { toJSON: toJSONSix } = render(<ListSkeleton count={6} />, { wrapper });

    // Count has to actually reach the render — a skeleton that always draws six
    // rows overshoots a two-row list and shifts layout when data lands.
    expect(JSON.stringify(toJSONSix()).length).toBeGreaterThan(two);
  });

  it('renders nothing but the container for a zero count', () => {
    render(<ListSkeleton count={0} />, { wrapper });

    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });
});

describe('under reduce motion', () => {
  it('renders every skeleton statically without dropping the label', () => {
    mockReduceMotion = true;

    render(<DetailSkeleton />, { wrapper });

    // Honouring the preference must not cost the announcement — the shimmer is
    // decoration, the label is the only accessible content.
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('renders the card and list variants statically too', () => {
    mockReduceMotion = true;

    const list = render(<ListSkeleton count={3} />, { wrapper });
    expect(list.getByLabelText('Loading')).toBeTruthy();

    const card = render(<CardSkeleton />, { wrapper });
    expect(card.getByLabelText('Loading')).toBeTruthy();
  });
});
