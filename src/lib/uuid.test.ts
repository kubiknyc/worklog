// Under jest, expo-crypto's randomUUID is backed by node:crypto (jest.setup.js);
// on device it's the native CSPRNG. The format contract below applies to both.
import { uuidv4 } from './uuid';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv4', () => {
  it('produces canonical v4 UUIDs', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(uuidv4()).toMatch(UUID_V4_RE);
    }
  });

  it('is effectively unique', () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuidv4()));
    expect(set.size).toBe(1000);
  });
});
