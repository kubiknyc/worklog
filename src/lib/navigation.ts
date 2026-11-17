import { router, type Href } from 'expo-router';

/**
 * Go back, or `replace` to `fallback` when there is no history. On web a
 * screen opened directly by URL has an empty stack, so a bare `router.back()`
 * is a silent no-op and the user dead-ends.
 */
export function goBackOr(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
