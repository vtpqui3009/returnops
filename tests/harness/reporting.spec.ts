import { test, expect } from '@playwright/test';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import MatrixReporter from '../support/report';

function fixtureAttachment() {
  return { name: 'fixture-run', contentType: 'application/json', body: Buffer.from(JSON.stringify({ fixtureRunId: 'synthetic-run', scenario: 'A', executionMode: 'TEST' })) };
}

function outcomeAttachment() {
  return { name: 'terminal-case', contentType: 'application/json', body: Buffer.from(JSON.stringify({
    caseId: 'demo-a', caseVersion: 2, evidenceVersion: 0, activeRulesVersion: 1, status: 'WAITING_EVIDENCE'
  })) };
}

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
        body: Buffer.from(JSON.stringify({ caseId: 'demo-a', caseVersion: 2, evidenceVersion: 0, activeRulesVersion: 1, status: 'WAITING_EVIDENCE', operation: { id: 'op-A', error: { message: 'PRIVATE_MARKER' } }, headers: { Cookie: 'PRIVATE_MARKER' } }))
      }, {
        name: 'consistency-check', contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ variant: 'concurrent', ruleCount: 1, Cookie: 'PRIVATE_MARKER' }))
      }, fixtureAttachment(), { name: 'trace', contentType: 'application/zip', path: '/private/path' }]
    } as unknown as TestResult);
    await first.onEnd({ status: 'passed' } as FullResult);
    const summary = read(latest);
    const archived = join(results, 'runs', summary.runId, 'summary.json');
    const readEvidence = (file: string) => read(resolve(dirname(file), read(file).executions[0].evidence[0].path));
    expect(summary.executions[0].evidence).toHaveLength(3);
    expect(read(resolve(dirname(latest), summary.executions[0].evidence[1].path))).toEqual({ variant: 'concurrent', ruleCount: 1 });
    const expected = { caseId: 'demo-a', caseVersion: 2, evidenceVersion: 0, activeRulesVersion: 1, status: 'WAITING_EVIDENCE', operation: { id: 'op-A' }, receipt: null, flags: [] };
    expect(readEvidence(latest)).toEqual(expected);
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
    expect(readEvidence(archived)).toEqual(expected);
    const latestRunId = read(latest).runId;
    const discovery = new MatrixReporter();
    discovery.onBegin({ ...config, argv: ['--list'] }, suite);
    await discovery.onEnd({ status: 'passed' } as FullResult);
    expect(read(latest).runId).toBe(latestRunId);
    const partial = new MatrixReporter();
    partial.onBegin(config, suite);
    partial.onTestEnd({ ...testCase, annotations: [{ type: 'related-matrix-id', description: 'AUTH-N03' }] } as TestCase, {
      status: 'passed', duration: 1, annotations: [], attachments: [fixtureAttachment(), outcomeAttachment()]
    } as unknown as TestResult);
    await partial.onEnd({ status: 'passed' } as FullResult);
    expect(read(latest).executions[0]).toMatchObject({ id: null, relatedMatrixIds: ['AUTH-N03'], result: 'PASS' });
    expect(read(latest).matrix.find((row: { id: string }) => row.id === 'AUTH-N03').layers.api).toBe('NOT RUN');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TEST: missing or incomplete runtime evidence cannot grant PASS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'returnops-evidence-'));
  const config = { rootDir: root, argv: [], metadata: {} } as unknown as FullConfig;
  const suite = { suites: [{ title: 'api' }] } as Suite;
  const productCase = { title: 'A-01', annotations: [{ type: 'matrix-id', description: 'A-01' }], parent: { project: () => ({ name: 'api' }) } } as TestCase;
  try {
    for (const attachments of [[], [fixtureAttachment()], [outcomeAttachment()], [fixtureAttachment(), {
      name: 'terminal-case', contentType: 'application/json', body: Buffer.from('{"caseId":"incomplete"}')
    }]]) {
      const reporter = new MatrixReporter();
      reporter.onBegin(config, suite);
      reporter.onTestEnd(productCase, { status: 'passed', duration: 1, annotations: [], attachments } as unknown as TestResult);
      expect(await reporter.onEnd({ status: 'passed' } as FullResult)).toEqual({ status: 'failed' });
      const summary = JSON.parse(readFileSync(join(root, 'artifacts/api/summary.json'), 'utf8'));
      expect(summary.executions[0].result).toBe('NOT RUN');
      expect(summary.matrix.find((row: { id: string }) => row.id === 'A-01').layers.api).toBe('NOT RUN');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('TEST: filtered or mislabelled variants cannot complete a matrix requirement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'returnops-variants-'));
  const config = { rootDir: root, argv: ['--grep', 'concurrent'], metadata: {} } as unknown as FullConfig;
  const suite = { suites: [{ title: 'api' }] } as Suite;
  try {
    for (const [variants, expected] of [
      [['concurrent'], 'NOT RUN'],
      [['concurrent', 'accept-first', 'reject-first'], 'PASS'],
      [['concurrent', 'concurrent', 'reject-first'], 'NOT RUN'],
      [['concurrent', 'accept-first', 'reject-first', 'unknown'], 'NOT RUN']
    ] as const) {
      const reporter = new MatrixReporter();
      reporter.onBegin(config, suite);
      for (const variant of variants) {
        const productCase = { title: variant, annotations: [
          { type: 'matrix-id', description: 'R-N05' }, { type: 'matrix-variant', description: variant }
        ], parent: { project: () => ({ name: 'api' }) } } as TestCase;
        reporter.onTestEnd(productCase, { status: 'passed', duration: 1, annotations: [], attachments: [fixtureAttachment(), outcomeAttachment()] } as unknown as TestResult);
      }
      await reporter.onEnd({ status: 'passed' } as FullResult);
      const summary = JSON.parse(readFileSync(join(root, 'artifacts/api/summary.json'), 'utf8'));
      const row = summary.matrix.find((row: { id: string }) => row.id === 'R-N05');
      expect(row.layers.api).toBe(expected);
      expect(row.coverage.api.requiredVariants).toEqual(['concurrent', 'accept-first', 'reject-first']);
    }
    const partial = new MatrixReporter();
    partial.onBegin(config, suite);
    partial.onTestEnd({ title: 'Fixture reset only', annotations: [{ type: 'matrix-id', description: 'DATA-N01' }], parent: { project: () => ({ name: 'api' }) } } as TestCase,
      { status: 'passed', duration: 1, annotations: [], attachments: [fixtureAttachment(), outcomeAttachment()] } as unknown as TestResult);
    await partial.onEnd({ status: 'passed' } as FullResult);
    const summary = JSON.parse(readFileSync(join(root, 'artifacts/api/summary.json'), 'utf8'));
    expect(summary.matrix.find((row: { id: string }) => row.id === 'DATA-N01').layers.api).toBe('NOT RUN');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
