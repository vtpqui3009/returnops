import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCatalog } from './catalog';

type Result = 'PASS' | 'FAIL' | 'NOT RUN';
export default class MatrixReporter implements Reporter {
  private config!: FullConfig;
  private projects: string[] = [];
  private observations: { id: string | null; project: string; result: Result; durationMs: number; blocker?: string; evidence: { name: string; path?: string }[] }[] = [];
  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    this.projects = suite.suites.map(s => s.title);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const id = test.annotations.find(a => a.type === 'matrix-id')?.description ?? null;
    const blocked = test.annotations.some(a => a.type === 'blocked');
    this.observations.push({ id, project: test.parent.project()?.name ?? 'unknown', result: blocked || result.status === 'skipped' ? 'NOT RUN' : result.status === 'passed' ? 'PASS' : 'FAIL', durationMs: result.duration, blocker: test.annotations.find(a => a.type === 'blocked' || a.type === 'blocker')?.description, evidence: result.attachments.map(a => ({ name: a.name, path: a.path })) });
  }
  onEnd(result: FullResult) {
    const directory = join(this.config.rootDir, 'artifacts', this.projects.join('-') || 'discovery');
    mkdirSync(directory, { recursive: true });
    const matrix = readCatalog().map(c => ({
      id: c.id,
      // Layer results are not full UI/API/D1/deployment acceptance.
      layers: Object.fromEntries(['api', 'e2e', 'inventory'].map(layer => {
        const entries = this.observations.filter(o => o.id === c.id && o.project === layer);
        return [layer, entries.some(o => o.result === 'FAIL') ? 'FAIL' : entries.some(o => o.result === 'PASS') ? 'PASS' : 'NOT RUN'];
      }))
    }));
    writeFileSync(join(directory, 'summary.json'), JSON.stringify({
      createdAt: new Date().toISOString(), metadata: this.config.metadata,
      selectedProjects: this.projects, runnerStatus: result.status,
      notice: 'Harness PASS validates test infrastructure only. A layer PASS is not complete matrix acceptance. No raw sessions or response bodies are included.',
      harness: this.observations.filter(o => o.project === 'harness'),
      executions: this.observations.filter(o => o.project !== 'harness'), matrix
    }, null, 2) + '\n');
  }
}
