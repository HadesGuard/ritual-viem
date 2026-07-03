import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: process.env.RITUAL_LIVE ? [] : ['test/live.integration.test.ts', 'node_modules/**'],
    testTimeout: process.env.RITUAL_LIVE ? 120_000 : 10_000,
  },
})
