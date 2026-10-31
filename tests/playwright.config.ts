import { defineConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: './artifacts/results',
  reporter: [['list'], ['./support/report.ts']],
  metadata: { commit, dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), baseline: '92430915e529ae12f0a7ed5c4b2842d771498e86' },
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'harness', testMatch: 'harness/**/*.spec.ts' },
    { name: 'api', testMatch: 'api/**/*.spec.ts', timeout: 180_000 },
    { name: 'ui-local', testMatch: 'ui-local/**/*.spec.ts', timeout: 90_000, use: { browserName: 'chromium', launchOptions: { timeout: 30_000 } } },
    { name: 'inventory', testMatch: 'inventory/**/*.spec.ts' },
    { name: 'e2e', testMatch: 'e2e/**/*.spec.ts', use: { browserName: 'chromium', channel: 'chrome' } }
  ]
});
