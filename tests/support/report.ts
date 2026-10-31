import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readCatalog, requiredVariants } from './catalog';

type Status = 'PASS' | 'FAIL' | 'NOT RUN';
type Observation = {
  id: string | null;
  title: string;
  project: string;
  variant: string;
  result: Status;
  durationMs: number;
  blocker?: string;
  relatedMatrixIds: string[];
  evidence: { name: string; path: string }[];
};

// Only archive the fields needed for QA. New response fields, provider messages,
// headers, traces and error-context attachments must not enter the evidence bundle.
function pick(value: unknown, keys: string[]): Record<string, string | number | boolean | null> {
  const selected: Record<string, string | number | boolean | null> = {};
  if (!value || typeof value !== 'object') return selected;
  for (const key of keys) {
    const item: unknown = (value as Record<string, unknown>)[key];
    if (item === null || typeof item === 'number' || typeof item === 'string' || typeof item === 'boolean') selected[key] = item;
  }
  return selected;
}

function safeAttachment(a: TestResult['attachments'][number]) {
  if (!['fixture-run', 'terminal-case', 'consistency-check', 'storage-retry-probe', 'proof-reference-probe', 'ui-observation', 'policy-agent-probe', 'full-route-observation', 'e-learning-eligibility'].includes(a.name)) return;
  if (a.contentType !== 'application/json' || !a.body) throw new Error('Expected an in-memory JSON attachment.');
  const data: unknown = JSON.parse(a.body.toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid QA evidence object.');
  if (a.name === 'fixture-run') return pick(data, ['fixtureRunId', 'scenario', 'executionMode']);
  if (a.name === 'storage-retry-probe') return pick(data, ['phase', 'caseId', 'caseVersion', 'receiptId', 'receiptCount', 'ruleCount', 'transitionCount', 'evaluationCount', 'activeRulesVersion', 'auditEventCount', 'evidenceCount', 'requestStatus', 'errorCode', 'suggestionCount', 'queueSize']);
  if (a.name === 'proof-reference-probe') return pick(data, ['controlRequests', 'referenceRequests', 'submittedReferences', 'observationScope']);
  if (a.name === 'ui-observation') return pick(data, ['caseId', 'caseStatus', 'receiptId', 'sourceCaseId', 'receiptCount', 'ruleCount', 'transitionCount', 'evaluationCount', 'activeRulesVersion', 'decisionText', 'provenanceText', 'completionText', 'screen', 'loadingObserved', 'errorStatus', 'recoveryStatus', 'recovered']);
  if (a.name === 'policy-agent-probe') return pick(data, ['phase', 'caseId', 'caseVersion', 'evidenceVersion', 'activeRulesVersion', 'status', 'decision', 'operationId', 'operationStatus', 'errorCode', 'receiptCount', 'ruleCount', 'transitionCount', 'evaluationCount']);
  if (a.name === 'full-route-observation') return pick(data, ['caseId', 'operationId', 'executionMode', 'receiptId', 'sourceCaseId', 'status']);
  if (a.name === 'e-learning-eligibility') return pick(data, ['caseId', 'orderId', 'amountVnd', 'reasonGroup', 'itemCondition', 'status', 'suggestionId']);
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

function hasRuntimeEvidence(records: { name: string; data: Record<string, unknown> }[]) {
  const statuses = ['NEW', 'WAITING_EVIDENCE', 'NEEDS_OWNER_REVIEW', 'COMPLETED', 'TECHNICAL_ERROR'];
  const fixture = records.some(({ name, data }) => name === 'fixture-run'
    && typeof data.fixtureRunId === 'string' && data.fixtureRunId.length > 0
    && ['A', 'B', 'C', 'D', 'DE'].includes(String(data.scenario))
    && ['TEST', 'REPLAY', 'LIVE'].includes(String(data.executionMode)));
  const terminal = records.some(({ name, data }) => name === 'terminal-case'
    && typeof data.caseId === 'string' && data.caseId.length > 0
    && Number.isInteger(data.caseVersion) && Number(data.caseVersion) > 0
    && Number.isInteger(data.evidenceVersion) && Number(data.evidenceVersion) >= 0
    && Number.isInteger(data.activeRulesVersion) && Number(data.activeRulesVersion) > 0
    && statuses.includes(String(data.status)));
  const ui = records.some(({ name, data }) => name === 'ui-observation' && (
    typeof data.caseId === 'string' && data.caseId.length > 0
      && statuses.includes(String(data.caseStatus)) && 'receiptId' in data
    || ['queue', 'learning', 'case-detail', 'owner-review'].includes(String(data.screen))
      && data.loadingObserved === true && data.errorStatus === 503 && data.recoveryStatus === 200 && data.recovered === true
  ));
  return fixture && (terminal || ui);
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
      variant: annotations.find(a => a.type === 'matrix-variant')?.description ?? 'default',
      relatedMatrixIds: annotations.filter(a => a.type === 'related-matrix-id').map(a => a.description ?? ''),
      result: skipped ? 'NOT RUN' : result.status === 'passed' ? 'PASS' : 'FAIL',
      blocker: blocked?.description ?? annotations.find(a => a.type === 'blocker')?.description
    };
    try {
      const records: { name: string; data: Record<string, unknown> }[] = [];
      for (const [index, attachment] of result.attachments.entries()) {
        const safe = safeAttachment(attachment);
        if (!safe) continue;
        records.push({ name: attachment.name, data: safe });
        const path = join(this.archive, `evidence-${this.observations.length + 1}-${index + 1}.json`);
        writeFileSync(path, JSON.stringify(safe, null, 2) + '\n', { flag: 'wx' });
        observation.evidence.push({ name: attachment.name, path });
      }
      if (observation.result === 'PASS' && ['api', 'ui-local'].includes(project)
        && (id || observation.relatedMatrixIds.length) && !hasRuntimeEvidence(records)) {
        throw new Error('A fixture record and a complete runtime outcome are required.');
      }
    } catch {
      // The run must be retried rather than recording a PASS without its evidence.
      this.evidenceError = true;
      observation.blocker = 'Required fixture/outcome evidence is missing, incomplete or could not be archived.';
      if (observation.result === 'PASS') observation.result = 'NOT RUN';
    }
    this.observations.push(observation);
  }

  async onEnd(run: FullResult): Promise<void | { status: FullResult['status'] }> {
    if (this.discoveryOnly) return;
    const matrix = readCatalog().map(c => {
      const coverage = Object.fromEntries(['api', 'ui-local', 'e2e', 'inventory'].map(layer => {
        const entries = this.observations.filter(o => o.id === c.id && o.project === layer);
        const required = requiredVariants(layer, c.id);
        const passed = required.filter(variant => {
          const matching = entries.filter(entry => entry.variant === variant);
          return matching.length > 0 && matching.every(entry => entry.result === 'PASS');
        });
        return [layer, { requiredVariants: required, executedVariants: [...new Set(entries.map(entry => entry.variant))], missingVariants: required.filter(variant => !passed.includes(variant)) }];
      }));
      return { id: c.id, coverage,
        layers: Object.fromEntries(['api', 'ui-local', 'e2e', 'inventory'].map(layer => {
        const entries = this.observations.filter(o => o.id === c.id && o.project === layer);
        const plan = coverage[layer];
        const status = entries.some(o => o.result === 'FAIL') ? 'FAIL'
          : plan.requiredVariants.length && !plan.missingVariants.length
            && entries.every(o => o.result === 'PASS' && plan.requiredVariants.includes(o.variant)) ? 'PASS' : 'NOT RUN';
        return [layer, status];
        }))
      };
    });
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
