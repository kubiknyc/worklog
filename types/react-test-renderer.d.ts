/**
 * `react-test-renderer` ships no type declarations of its own (and there is
 * no `@types/react-test-renderer` install here, nor a version compatible
 * with React 19). PunchLog's tree happens to resolve the bare import cleanly
 * only because several other test files import it first and prime tsc's
 * per-directory module-resolution cache with a looser (JS-permissive)
 * resolution that this repo, with a single importer
 * (`src/theme/ThemeProvider.test.tsx`), does not get "for free" — matching
 * that fragile ordering isn't worth relying on. Declaring just the named
 * exports this repo actually imports (`act`, `create`, `ReactTestRenderer`)
 * keeps the shim minimal and specific to real usage.
 */
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestRenderer {
    toJSON(): unknown;
    toTree(): unknown;
    unmount(nextElement?: ReactElement): void;
    update(nextElement: ReactElement): void;
    getInstance(): unknown;
    readonly root: unknown;
  }

  export function create(element: ReactElement, options?: unknown): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): Promise<void>;
}
