import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readCatalog } from './catalog';

type Status = 'PASS' | 'FAIL' | 'NOT RUN';
type Observation = {
  id: string | null;
  title: string;
  project: string;
  result: Status;
  durationMs: number;
  blocker?: string;
  relatedMatrixIds: string[];
  evidence: { name: string; path: string }[];
};

// Only archive the fields needed for QA. New response fields, provider messages,
// headers, traces and error-context attachments must not enter the evidence bundle.
function pick(value: unknown, keys: string[]): Record<string, string | number | null> {
  const selected: Record<string, string | number | null> = {};
  if (!value || typeof value !== 'object') return selected;
  for (const key of keys) {
    const item: unknown = (value as Record<string, unknown>)[key];
    if (item === null || typeof item === 'number' || typeof item === 'string') selected[key] = item;
  }
  return selected;
}

function safeAttachment(a: TestResult['attachments'][number]) {
  if (!['fixture-run', 'terminal-case', 'consistency-check', 'storage-retry-probe', 'proof-reference-probe', 'ui-observation', 'policy-agent-probe'].includes(a.name)) return;
  if (a.contentType !== 'application/json' || !a.body) throw new Error('Expected an in-memory JSON attachment.');
  const data: unknown = JSON.parse(a.body.toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid QA evidence object.');
  if (a.name === 'fixture-run') return pick(data, ['fixtureRunId', 'scenario', 'executionMode']);
  if (a.name === 'storage-retry-probe') return pick(data, ['phase', 'caseId', 'caseVersion', 'receiptId', 'receiptCount', 'ruleCount', 'transitionCount', 'evaluationCount', 'activeRulesVersion', 'auditEventCount', 'evidenceCount', 'requestStatus', 'errorCode', 'suggestionCount', 'queueSize']);
  if (a.name === 'proof-reference-probe') return pick(data, ['controlRequests', 'referenceRequests', 'submittedReferences', 'observationScope']);
  if (a.name === 'ui-observation') return pick(data, ['caseId', 'caseStatus', 'receiptId', 'sourceCaseId', 'receiptCount', 'ruleCount', 'transitionCount', 'evaluationCount', 'activeRulesVersion']);
  if (a.name === 'policy-agent-probe') return pick(data, ['phase', 'caseId', 'caseVersion', 'evidenceVersion', 'activeRulesVersion', 'status', 'decision', 'operationId', 'operationStatus', 'errorCode', 'receiptCount', 'ruleCount', 'transitionCount', 'evaluationCount']);
  if (a.name === 'consistency-check') return pick(data, [
    'variant', 'caseId', 'proofId', 'suggestionId', 'errorCode', 'initialEvidenceVersion',
    'finalEvidenceVersion', 'initialProofVersion', 'finalProofVersion', 'reviewStatus',
    'operationId', 'failedOperationStatus', 'caseStatus', 'acceptStatus', 'rejectStatus', 'suggestionStatus',
    'suggestionVersion', 'ruleId', 'initialRulesVersion', 'replayStatus',
    'terminalAcceptStatus', 'terminalRejectStatus', 'receiptCount', 'ruleCount',
    'transitionCount', 'evaluationCount', 'activeRulesVersion', 'terminalAcceptCode', 'terminalRejectCode'
  ]);
  const c = data as Record<string, unknown>;
  const op = c.operation as Record<string, unknown> | null;
  return {
    ...pick(c, ['caseId', 'caseVersion', 'evidenceVersion', 'activeRulesVersion', 'status', 'decision']),
    operation: op == null ? null : {
      ...pick(op, ['id', 'status', 'executionMode', 'model', 'providerResponseId']),
      errorCode: pick(op.error, ['code']).code,
      result: op.result == null ? undefined : pick(op.result, ['status', 'decision'])
    },
    receipt: c.receipt == null ? null : pick(c.receipt, ['id', 'mode', 'completionMode', 'agentRunId', 'appliedRuleId', 'appliedRuleVersion', 'sourceCaseId']),
    flags: Array.isArray(c.flags) ? c.flags.filter(x => typeof x === 'string') : []
  };
}

export default class MatrixReporter implements Reporter {
  private config!: FullConfig;
  private metadata!: FullConfig['metadata'];
  private projects: string[] = [];
  private observations: Observation[] = [];
  private readonly runId = randomUUID();
  private archive!: string;
  private evidenceError = false;
  private discoveryOnly = false;

  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    this.metadata = { ...config.metadata };
    this.discoveryOnly = config.argv.includes('--list');
    if (this.discoveryOnly) return;
    this.projects = suite.suites.map(s => s.title);
    const backend = process.env.RETURNOPS_BACKEND_ROOT;
    const adapter = process.env.RETURNOPS_TEST_ADAPTER;
    if (this.projects.some(p => ['api', 'ui-local'].includes(p)) && backend && adapter && resolve(adapter) === join(config.rootDir, 'adapters', 'pr8-local.mjs')) {
      this.metadata.runtimeScope = 'Local API dispatcher, Miniflare D1, synthetic ingress, TEST agent';
      try {
        const git = (args: string[]) => execFileSync('git', ['-C', backend, ...args], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        this.metadata.backendCommit = git(['rev-parse', '--verify', 'HEAD']);
        this.metadata.backendDirty = Boolean(git(['status', '--porcelain']));
      } catch {
        this.metadata.backendProvenance = 'unavailable';
        this.evidenceError = true;
      }
    }
    if (this.projects.includes('ui-local')) {
      const ui = JSON.parse(readFileSync(join(config.rootDir, 'artifacts', 'ui-bundle', 'source.json'), 'utf8'));
      this.metadata.uiCommit = ui.uiCommit;
      this.metadata.runtimeScope = ui.scope;
    }
    this.archive = join(config.rootDir, 'artifacts', 'runs', this.runId);
    mkdirSync(this.archive, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const annotations = [...test.annotations, ...result.annotations];
    const id = annotations.find(a => a.type === 'matrix-id')?.description ?? null;
    const project = test.parent.project()?.name ?? 'unknown';
    const blocked = annotations.find(a => a.type === 'blocked');
    const skipped = blocked || result.status === 'skipped' || result.status === 'interrupted';
    const observation: Observation = {
      id, title: test.title, project, durationMs: result.duration, evidence: [],
      relatedMatrixIds: annotations.filter(a => a.type === 'related-matrix-id').map(a => a.description ?? ''),
      result: skipped ? 'NOT RUN' : result.status === 'passed' ? 'PASS' : 'FAIL',
      blocker: blocked?.description ?? annotations.find(a => a.type === 'blocker')?.description
    };
    try {
      for (const [index, attachment] of result.attachments.entries()) {
        const safe = safeAttachment(attachment);
        if (!safe) continue;
        const path = join(this.archive, `evidence-${this.observations.length + 1}-${index + 1}.json`);
        writeFileSync(path, JSON.stringify(safe, null, 2) + '\n', { flag: 'wx' });
        observation.evidence.push({ name: attachment.name, path });
      }
    } catch {
      // The run must be retried rather than recording a PASS without its evidence.
      this.evidenceError = true;
      observation.blocker = 'Could not archive the expected QA evidence.';
      if (observation.result === 'PASS') observation.result = 'NOT RUN';
    }
    this.observations.push(observation);
  }

  async onEnd(run: FullResult): Promise<void | { status: FullResult['status'] }> {
    if (this.discoveryOnly) return;
    const matrix = readCatalog().map(c => ({
      id: c.id,
      layers: Object.fromEntries(['api', 'ui-local', 'e2e', 'inventory'].map(layer => {
        const entries = this.observations.filter(o => o.id === c.id && o.project === layer);
        const status = entries.some(o => o.result === 'FAIL') ? 'FAIL'
          : entries.length && entries.every(o => o.result === 'PASS') ? 'PASS' : 'NOT RUN';
        return [layer, status];
      }))
    }));
    const summary = (directory: string) => {
      const records = this.observations.map(o => ({
        ...o, evidence: o.evidence.map(e => ({ name: e.name, path: relative(directory, e.path).replaceAll('\\', '/') }))
      }));
      return JSON.stringify({
        runId: this.runId, createdAt: new Date().toISOString(), metadata: this.metadata,
        selectedProjects: this.projects, runnerStatus: this.evidenceError ? 'failed' : run.status,
        harness: records.filter(o => o.project === 'harness'),
        executions: records.filter(o => o.project !== 'harness'), matrix
      }, null, 2) + '\n';
    };
    try {
      writeFileSync(join(this.archive, 'summary.json'), summary(this.archive), { flag: 'wx' });
      const latest = join(this.config.rootDir, 'artifacts', this.projects.join('-') || 'discovery');
      mkdirSync(latest, { recursive: true });
      const temporary = join(latest, `summary-${this.runId}.tmp`);
      writeFileSync(temporary, summary(latest));
      renameSync(temporary, join(latest, 'summary.json'));
    } catch {
      this.evidenceError = true;
    }
    if (this.evidenceError) {
      console.error('QA evidence could not be saved completely. Inspect the local artifacts directory and rerun.');
      return { status: 'failed' };
    }
  }
}
