/**
 * goBackOr: goes back when history exists; otherwise replaces to the fallback
 * (direct-URL web load has no history, so `router.back()` alone does nothing).
 */
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => mockCanGoBack(),
  },
}));

// eslint-disable-next-line import/first
import { goBackOr } from './navigation';

describe('goBackOr', () => {
  beforeEach(() => jest.clearAllMocks());

  it('goes back when history exists', () => {
    mockCanGoBack.mockReturnValue(true);
    goBackOr('/(tabs)');
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('replaces to the fallback when there is no history', () => {
    mockCanGoBack.mockReturnValue(false);
    goBackOr('/(tabs)');
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
