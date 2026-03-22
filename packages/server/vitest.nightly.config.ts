import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/tests/cards/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@meccg/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
