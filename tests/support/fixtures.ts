import { test as base } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApiClient, validateOrigin } from './api';
import type { PreparedScenario, RuntimeAdapter, Scenario } from './types';
import type { CaseQueueResponse } from '../../src/shared/contracts';

export const test = base.extend<{
  scenario: Scenario;
  runtime: PreparedScenario & { member: ApiClient; owner: ApiClient };
}>({
  scenario: ['A', { option: true }],
  runtime: async ({ scenario }, provide, testInfo) => {
    const blocked: (reason: string) => never = reason => {
      testInfo.annotations.push({ type: 'blocked', description: reason });
      throw new Error(`NOT RUN: ${reason}`);
    };
    if (process.env.RETURNOPS_TEST_ALLOW_MUTATIONS !== '1') blocked('Mutation opt-in is required before preparing fixtures.');
    let baseURL: string;
    try { baseURL = validateOrigin(process.env.RETURNOPS_TEST_BASE_URL ?? '', process.env.RETURNOPS_TEST_ALLOW_REMOTE === '1'); }
    catch { blocked('Invalid test target or missing remote opt-in.'); }
    const adapterPath = process.env.RETURNOPS_TEST_ADAPTER;
    if (!adapterPath) blocked('Real seed/reset/identity adapter is not connected.');
    let adapter: RuntimeAdapter;
    let prepared: PreparedScenario;
    try {
      const importedAdapter = await import(pathToFileURL(resolve(adapterPath)).href);
      adapter = importedAdapter.default as RuntimeAdapter;
      if (typeof adapter?.prepare !== 'function') throw new Error('Invalid adapter');
      prepared = await adapter.prepare({ scenario, baseURL, uiBundleRoot: testInfo.project.name === 'ui-local' ? resolve('artifacts/ui-bundle') : undefined });
    } catch { blocked('Runtime adapter setup failed; inspect the adapter locally without publishing session values.'); }
    const allowRemote = process.env.RETURNOPS_TEST_ALLOW_REMOTE === '1';
    try {
      if (!prepared?.fixtureRunId || !prepared.headers?.MEMBER || !prepared.headers?.OWNER) blocked('Adapter must return fixtureRunId and both role sessions.');
      if (prepared.executionMode !== (process.env.RETURNOPS_TEST_EXECUTION_MODE ?? 'TEST')) blocked('Server execution mode differs from the requested mode.');
      await testInfo.attach('fixture-run', { body: JSON.stringify({ fixtureRunId: prepared.fixtureRunId, scenario, executionMode: prepared.executionMode }), contentType: 'application/json' });
      const member = new ApiClient(baseURL, prepared.headers.MEMBER, allowRemote);
      const owner = new ApiClient(baseURL, prepared.headers.OWNER, allowRemote);
      await provide({ ...prepared, member, owner });
      if (prepared.localD1 && testInfo.status === 'passed') {
        const queue = await owner.call<CaseQueueResponse>('GET', '/api/cases?limit=50', 200);
        for (const item of queue.items) {
          const c = await owner.detail(item.id);
          await testInfo.attach('terminal-case', { contentType: 'application/json', body: JSON.stringify({
            caseId: c.id, caseVersion: c.caseVersion, evidenceVersion: c.evidenceVersion,
            activeRulesVersion: c.activeRulesVersion, status: c.status, decision: c.decision,
            operation: c.evaluation, receipt: c.receipt, flags: c.flags
          }) });
        }
      }
    } finally {
      if (prepared?.fixtureRunId) await adapter.cleanup?.({ fixtureRunId: prepared.fixtureRunId, baseURL });
    }
  }
});

export { expect } from '@playwright/test';
