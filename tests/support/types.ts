import type { Page } from '@playwright/test';
import type { ExecutionMode } from '../../src/shared/contracts';

export type Scenario = 'A' | 'B' | 'C' | 'D' | 'DE';
export type Role = 'MEMBER' | 'OWNER';
export interface PreparedScenario {
  /** A non-secret identifier for the isolated synthetic fixture/reset run. */
  fixtureRunId: string;
  /** Read from the actual server-side test configuration before any intake. */
  executionMode: ExecutionMode;
  /** Real session headers from trusted test setup; never fabricated identity headers. */
  headers: Record<Role, Record<string, string>>;
}
export interface RuntimeAdapter {
  /** Reset only the designated synthetic test shop using Nhân's implementation. */
  prepare(input: { scenario: Scenario; baseURL: string }): Promise<PreparedScenario>;
  cleanup?(input: { fixtureRunId: string; baseURL: string }): Promise<void>;
}
/** Reserved for the UI lane once routes/selectors exist. No mock implementation. */
export interface UiScenarioDriver {
  run(input: { id: string; page: Page; baseURL: string }): Promise<void>;
}
