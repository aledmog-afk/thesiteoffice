import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rolldownOptions: {
      // Two pages: the app, and the method page built from METHOD.md (served at /method).
      input: { main: 'index.html', method: 'method.html' },
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
});
