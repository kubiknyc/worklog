/**
 * The platform seam, from the provider's side (#24 item 6).
 *
 * `RepositoryProvider` used to branch on `Platform.OS === 'web'` in two places.
 * #22 moved both decisions onto `INITIAL_REPOSITORY` so `platformRepo.web.ts`
 * stops being dead code — but that only moved the risk: nothing asserted the
 * provider actually reads the seam. It could go back to branching on
 * `Platform.OS` tomorrow and every existing test would still pass, because
 * `RepositoryProvider.rekey.test.tsx` mocks the whole module away and never
 * varies this value.
 *
 * So the tests below drive the SAME provider through both platform shapes by
 * varying only what the seam returns. If the branch is ever re-derived from
 * anything but the seam, the web-shaped cases fail.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { RepositoryProvider, useRepository } from './RepositoryProvider';

const webRepo = { __sentinel: 'web' };
const nativeRepo = { __sentinel: 'native' };

// Varied per test. A getter, not a value: the provider reads
// `INITIAL_REPOSITORY` at render time, so the mock has to be re-read too.
let mockInitial: unknown = null;
const mockCreate = jest.fn((_userId: string | null) =>
  Promise.resolve({ repo: nativeRepo, engine: null }),
);

jest.mock('./platformRepo', () => ({
  get INITIAL_REPOSITORY() {
    return mockInitial;
  },
  createPlatformRepository: (userId: string | null) => mockCreate(userId),
}));

// Avoid pulling the real Supabase client (throws without EXPO_PUBLIC_* env).
jest.mock('./supabaseRepo', () => ({ supabaseRepository: { __sentinel: 'fallback' } }));
// HydrationGate reads useTheme; stub it so no ThemeProvider is needed.
jest.mock('../theme', () => ({ useTheme: () => ({ colors: { bg: '#000', muted: '#888' } }) }));

let mockUserId: string | null = null;
jest.mock('../auth', () => ({ useAuth: () => ({ userId: mockUserId }) }));

beforeEach(() => {
  mockCreate.mockClear();
  mockInitial = null;
  mockUserId = null;
});

/** Renders the repository the context actually handed down, not the mock. */
function Probe() {
  const repo = useRepository() as { __sentinel?: string };
  return <Text>{`repo:${repo.__sentinel ?? 'none'}`}</Text>;
}

function Tree({ repository }: { readonly repository?: object }) {
  return (
    <RepositoryProvider repository={repository as never}>
      <Probe />
    </RepositoryProvider>
  );
}

describe('a seam that supplies a first-render repository (web shape)', () => {
  beforeEach(() => {
    mockInitial = webRepo;
  });

  it('renders children on the very first render, with no hydration gate', () => {
    render(<Tree />);

    // Deliberately not awaited. A gate here is not a cosmetic flash: web has no
    // async hydration step to close it, so the spinner would be terminal.
    expect(screen.getByText('repo:web')).toBeTruthy();
  });

  it('never calls the async factory', async () => {
    render(<Tree />);
    await waitFor(() => expect(screen.getByText('repo:web')).toBeTruthy());

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not rebuild when the account changes', async () => {
    mockUserId = 'user-A';
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(screen.getByText('repo:web')).toBeTruthy());

    mockUserId = 'user-B';
    rerender(<Tree />);
    await waitFor(() => expect(screen.getByText('repo:web')).toBeTruthy());

    // Web is online-only and RLS-enforced: there is no local cache to reconcile,
    // so a rebuild would gate the UI behind a step that does nothing.
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('a seam that supplies nothing on first render (native shape)', () => {
  it('gates children until the async build resolves, then hands the repo down', async () => {
    mockUserId = 'user-A';
    render(<Tree />);

    // Gated: the previous user's repository must never be readable during a
    // rebuild, so "no repo yet" has to mean "no children yet".
    expect(screen.queryByText(/^repo:/)).toBeNull();

    await waitFor(() => expect(screen.getByText('repo:native')).toBeTruthy());
    expect(mockCreate).toHaveBeenCalledWith('user-A');
  });
});

describe('an explicit repository override', () => {
  it('wins over the seam and skips the factory entirely', async () => {
    mockInitial = webRepo;
    render(<Tree repository={{ __sentinel: 'override' }} />);

    await waitFor(() => expect(screen.getByText('repo:override')).toBeTruthy());
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('gates nothing even on the native shape', () => {
    mockInitial = null;
    render(<Tree repository={{ __sentinel: 'override' }} />);

    // The override is the point of the prop: a test or an explicit per-platform
    // selection must not be made to wait on a device DB that is never opened.
    expect(screen.getByText('repo:override')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
