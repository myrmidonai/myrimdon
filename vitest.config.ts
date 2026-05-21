import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',           // required for better-sqlite3 (native module)
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8' },
  },
});
