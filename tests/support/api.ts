import { randomUUID } from 'node:crypto';
import type { CaseDetail, EvaluateAcknowledgement, EvaluateRequest, IntakeAcknowledgement, IntakeRequest } from '../../src/shared/contracts';

export function validateOrigin(value: string, allowRemote = false): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Test target must be an HTTP(S) origin without credentials/path/query.');
  if (!allowRemote && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote test target requires explicit opt-in.');
  return url.origin;
}

export class ApiClient {
  readonly origin: string;
  constructor(baseURL: string, private readonly headers: Record<string, string>, allowRemote = false) {
    this.origin = validateOrigin(baseURL, allowRemote);
    for (const name of Object.keys(headers)) {
      if (['origin', 'host', 'content-type', 'idempotency-key'].includes(name.toLowerCase()) || name.toLowerCase().startsWith('oai-authenticated-user-')) throw new Error('Adapter must not override request contract or forge identity headers.');
    }
  }

  async call<T>(method: 'GET' | 'POST', path: string, expected: number, body?: unknown, key?: string): Promise<T> {
    return (await this.request<T>(method, path, [expected], body, key)).body;
  }

  async request<T>(method: 'GET' | 'POST', path: string, expected: readonly number[], body?: unknown, key?: string): Promise<{ status: number; body: T }> {
    const url = new URL(path, this.origin);
    if (!path.startsWith('/api/') || !url.pathname.startsWith('/api/') || url.origin !== this.origin) throw new Error('API path must stay on the configured test origin.');
    let response: Response;
    try {
      response = await fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { ...this.headers, ...(method === 'POST' ? { Origin: this.origin, 'Content-Type': 'application/json', 'Idempotency-Key': key ?? randomUUID() } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch { throw new Error(`Test request failed (${method} ${url.pathname}); no session headers were logged.`); }
    if (!expected.includes(response.status)) throw new Error(`${method} ${url.pathname}: expected HTTP ${expected.join('/')}, got ${response.status}.`);
    try { return { status: response.status, body: await response.json() as T }; }
    catch { throw new Error(`${method} ${url.pathname}: response was not JSON.`); }
  }

  detail(id: string) { return this.call<CaseDetail>('GET', `/api/cases/${encodeURIComponent(id)}`, 200); }
  intake(orderId: string, claim: string, key: string = randomUUID()) {
    return this.call<IntakeAcknowledgement>('POST', '/api/cases', 201, { orderId, claim } satisfies IntakeRequest, key);
  }
  async evaluate(id: string) {
    const c = await this.detail(id);
    return this.call<EvaluateAcknowledgement>('POST', `/api/cases/${encodeURIComponent(id)}/evaluate`, 202,
      { expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion } satisfies EvaluateRequest);
  }
}

export async function waitForEvaluation(api: Pick<ApiClient, 'detail'>, caseId: string, operationId: string, timeoutMs = 35_000, intervalMs = 500): Promise<CaseDetail> {
  const deadline = Date.now() + timeoutMs;
  do {
    const detail = await api.detail(caseId);
    const op = detail.evaluation;
    if (op?.id === operationId) {
      if (op.status === 'FAILED') throw new Error(`Evaluation ${operationId} failed: ${op.error?.code ?? 'UNKNOWN'}`);
      if (op.status === 'COMPLETED') return detail;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  throw new Error(`Evaluation ${operationId} did not reach its own terminal result within the polling budget.`);
}
