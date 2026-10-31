import { test, expect } from '@playwright/test';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import MatrixReporter from '../support/report';

test('TEST: preserve redacted evidence across runs and distinguish setup blockers from product failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'returnops-report-'));
  const config = { rootDir: root, argv: [], metadata: { commit: 'synthetic' } } as unknown as FullConfig;
  const suite = { suites: [{ title: 'api' }] } as Suite;
  const testCase = { annotations: [{ type: 'matrix-id', description: 'A-01' }], parent: { project: () => ({ name: 'api' }) } } as TestCase;
  const results = join(root, 'artifacts');
  const latest = join(results, 'api', 'summary.json');
  const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
  try {
    const first = new MatrixReporter();
    first.onBegin(config, suite);
    first.onTestEnd(testCase, {
      status: 'passed', duration: 10, annotations: [], attachments: [{
        name: 'terminal-case', contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ caseId: 'demo-a', operation: { id: 'op-A', error: { message: 'PRIVATE_MARKER' } }, headers: { Cookie: 'PRIVATE_MARKER' } }))
      }, {
        name: 'consistency-check', contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ variant: 'concurrent', ruleCount: 1, Cookie: 'PRIVATE_MARKER' }))
      }, { name: 'trace', contentType: 'application/zip', path: '/private/path' }]
    } as unknown as TestResult);
    await first.onEnd({ status: 'passed' } as FullResult);
    const summary = read(latest);
    const archived = join(results, 'runs', summary.runId, 'summary.json');
    const readEvidence = (file: string) => read(resolve(dirname(file), read(file).executions[0].evidence[0].path));
    expect(summary.executions[0].evidence).toHaveLength(2);
    expect(read(resolve(dirname(latest), summary.executions[0].evidence[1].path))).toEqual({ variant: 'concurrent', ruleCount: 1 });
    expect(readEvidence(latest)).toEqual({ caseId: 'demo-a', operation: { id: 'op-A' }, receipt: null, flags: [] });
    expect(read(archived).matrix.find((row: { id: string }) => row.id === 'A-01').layers).toMatchObject({ api: 'PASS', e2e: 'NOT RUN' });

    const blocked = new MatrixReporter();
    blocked.onBegin(config, suite);
    blocked.onTestEnd(testCase, {
      status: 'failed', duration: 0, annotations: [{ type: 'blocked', description: 'No session' }], attachments: []
    } as unknown as TestResult);
    await blocked.onEnd({ status: 'failed' } as FullResult);
    expect(read(latest).runId).not.toBe(summary.runId);
    expect(read(latest).runnerStatus).toBe('failed');
    expect(read(latest).executions[0]).toMatchObject({ result: 'NOT RUN', blocker: 'No session' });
    expect(readEvidence(archived)).toEqual({ caseId: 'demo-a', operation: { id: 'op-A' }, receipt: null, flags: [] });
    const latestRunId = read(latest).runId;
    const discovery = new MatrixReporter();
    discovery.onBegin({ ...config, argv: ['--list'] }, suite);
    await discovery.onEnd({ status: 'passed' } as FullResult);
    expect(read(latest).runId).toBe(latestRunId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
