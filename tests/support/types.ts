import type { Page } from '@playwright/test';
import type { ExecutionMode, ReviewAcknowledgement } from '../../src/shared/contracts';

export type Scenario = 'A' | 'B' | 'C' | 'D' | 'DE';
export type Role = 'MEMBER' | 'OWNER';
export interface LocalD1State {
  receiptCount: number;
  ruleCount: number;
  transitionCount: number;
  evaluationCount: number;
  activeRulesVersion: number;
}
export interface LocalD1Controls {
  patchOrder(orderId: string, changes: Partial<{
    amountVnd: number; deliveredAt: number | null; orderVersion: number; tracking: string;
    reasonGroup: string; itemCondition: string; riskFlags: string[];
  }>): Promise<void>;
  patchEvidence(caseId: string, evidenceId: string, changes: Partial<{
    tracking: string; orderVersion: number; reviewStatus: 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
  }>): Promise<void>;
  seedForeignCase(): Promise<string>;
  configureAgent(mode: 'ok' | 'missing-key' | 'provider-error' | 'timeout' | 'tool-budget' | 'round-budget' | 'refusal' | 'invalid-args' | 'unauthorized-tool'): void;
  failNextReceiptInsert(): Promise<() => Promise<void>>;
  dropNextCommittedResponse(): void;
  restartStore(): Promise<void>;
  resetStore(): Promise<void>;
  setIdentityTrust(enabled: boolean): void;
  readReviewAcknowledgement(key: string): Promise<ReviewAcknowledgement>;
  /** Pause only the next injected TEST agent, after the backend captures its snapshot. */
  holdNextEvaluation(): { entered: Promise<void>; release(): void };
  /** Fixture-only change to proof tracking plus proof/aggregate evidence versions. */
  invalidateProof(caseId: string, evidenceId: string): Promise<void>;
  inspect(caseId: string): Promise<LocalD1State>;
}
export interface PreparedScenario {
  /** A non-secret identifier for the isolated synthetic fixture/reset run. */
  fixtureRunId: string;
  /** Read from the actual server-side test configuration before any intake. */
  executionMode: ExecutionMode;
  /** Real session headers from trusted test setup; never fabricated identity headers. */
  headers: Record<Role, Record<string, string>>;
  /** In-process controls available only on the disposable local D1 adapter. */
  localD1?: LocalD1Controls;
}
export interface RuntimeAdapter {
  /** Reset only the designated synthetic test shop using Nhân's implementation. */
  prepare(input: { scenario: Scenario; baseURL: string; uiBundleRoot?: string }): Promise<PreparedScenario>;
  cleanup?(input: { fixtureRunId: string; baseURL: string }): Promise<void>;
}
/** Reserved for the UI lane once routes/selectors exist. No mock implementation. */
export interface UiScenarioDriver {
  run(input: { id: string; page: Page; baseURL: string }): Promise<void>;
}
