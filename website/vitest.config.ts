import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    // No lib/ tests exist yet in this task — task 2 (welcome page) adds the
    // ported GoTrue-fragment/zxcvbn suites. Passing green with zero test
    // files keeps `npm run test` usable as a per-task gate before then.
    passWithNoTests: true,
  },
});
