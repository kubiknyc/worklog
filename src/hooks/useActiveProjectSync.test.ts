/**
 * useActiveProjectSync: bridges ActiveProjectProvider's activeProjectId to
 * Repository.setActiveProject. A non-null id writes through; a null id
 * (signed out, or not yet resolved) writes nothing; a rejection is swallowed
 * — sync bookkeeping must never break navigation.
 */
import { renderHook } from '@testing-library/react-native';

import { useRepository } from '../data/RepositoryProvider';
import { useActiveProject } from '../project/ActiveProjectProvider';
import { useActiveProjectSync } from './useActiveProjectSync';

jest.mock('../project/ActiveProjectProvider', () => ({ useActiveProject: jest.fn() }));
jest.mock('../data/RepositoryProvider', () => ({ useRepository: jest.fn() }));

const mockUseActiveProject = useActiveProject as jest.Mock;
const mockUseRepository = useRepository as jest.Mock;

function activeProject(activeProjectId: string | null) {
  return { activeProjectId, ready: true, setActiveProject: jest.fn() };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('useActiveProjectSync', () => {
  test('writes through on a non-null activeProjectId', async () => {
    const setActiveProject = jest.fn().mockResolvedValue(undefined);
    mockUseActiveProject.mockReturnValue(activeProject('p1'));
    mockUseRepository.mockReturnValue({ setActiveProject });

    renderHook(() => useActiveProjectSync());
    await Promise.resolve();

    expect(setActiveProject).toHaveBeenCalledWith('p1');
  });

  test('does not write when activeProjectId is null', async () => {
    const setActiveProject = jest.fn().mockResolvedValue(undefined);
    mockUseActiveProject.mockReturnValue(activeProject(null));
    mockUseRepository.mockReturnValue({ setActiveProject });

    renderHook(() => useActiveProjectSync());
    await Promise.resolve();

    expect(setActiveProject).not.toHaveBeenCalled();
  });

  test('writes again when the id changes', async () => {
    const setActiveProject = jest.fn().mockResolvedValue(undefined);
    mockUseRepository.mockReturnValue({ setActiveProject });
    mockUseActiveProject.mockReturnValue(activeProject('p1'));

    const { rerender } = renderHook(() => useActiveProjectSync());
    await Promise.resolve();
    expect(setActiveProject).toHaveBeenCalledWith('p1');

    mockUseActiveProject.mockReturnValue(activeProject('p2'));
    rerender(undefined);
    await Promise.resolve();
    expect(setActiveProject).toHaveBeenCalledWith('p2');
  });

  test('swallows a rejection without throwing', async () => {
    const setActiveProject = jest.fn().mockRejectedValue(new Error('boom'));
    mockUseRepository.mockReturnValue({ setActiveProject });
    mockUseActiveProject.mockReturnValue(activeProject('p1'));

    expect(() => renderHook(() => useActiveProjectSync())).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
