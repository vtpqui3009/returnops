/* Independent HTTP-contract regression fixture; deliberately no TEST adapter import. */
const clone = value => structuredClone(value);

// Deliberately independent of createTestApi: a durable POST acknowledgement may
// outlive dispatch failure. GET is read-only; only an identical POST can recover.
// Models mutations.ts replay/dispatch and case-api.ts SUBMITTED guard at db67152.
function recoveryFixture({ action = 'evaluate', pendingStatus = 'PENDING', dispatchFailures = 1, failPollRead = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  // Lease metadata stays server-side. RUNNING scenarios model a crashed worker
  // whose lease has already expired, so same-key replay may claim it again.
  const leaseUntil = pendingStatus === 'RUNNING' ? now - 1 : null;
  const state = {
    id: 'recovery-case', caseVersion: 3, evidenceVersion: 1, activeRulesVersion: 2,
    order: { id: 'recovery-order', orderVersion: 2, tracking: 'tracking-current', amountVnd: 199000, deliveredAt: now - 100, reasonGroup: 'FIT_ISSUE', itemCondition: 'UNUSED_TAGS_INTACT' },
    status: action === 'review' ? 'WAITING_EVIDENCE' : 'NEEDS_OWNER_REVIEW',
    claim: 'Yêu cầu kiểm tra bằng chứng hiện hành', reasons: [], flags: [], missingEvidence: [],
    decision: null, appliedRuleId: null, appliedRuleVersion: null, sourceCaseId: null,
    pendingEvaluationOperationId: null, evaluation: null, receipt: null, timeline: [],
    evidence: [{ id: 'proof-1', caseId: 'recovery-case', orderId: 'recovery-order', orderVersion: 2, tracking: 'tracking-current', type: 'PACKING', source: 'SELLER', reference: 'Tham chiếu độc lập cho kiểm thử', observedAt: now, evidenceVersion: 1, reviewStatus: action === 'review' ? 'SUBMITTED' : 'VERIFIED', verifiedBy: action === 'review' ? null : 'owner-fixture', verifiedAt: action === 'review' ? null : now, reviewReason: null }],
  };
  const requests = new Map(), posts = [];
  let operationCount = 0, receiptCount = 0, dispatchCount = 0, reads = 0, failures = dispatchFailures, pollReadFailed = false;
  const event = (type, status = null) => state.timeline.push({ id: `event-${state.timeline.length}`, type, actorId: null, occurredAt: now, evaluationStatus: status, executionMode: 'TEST', completionMode: null, details: {} });
  const fault = (status, code) => Response.json({ error: { code, message: 'Independent synthetic contract fault', requestId: 'recovery-fixture' } }, { status });
  async function fetcher(url, init = {}) {
    const path = new URL(url, 'http://fixture.invalid').pathname;
    if (!init.method || init.method === 'GET') {
      reads++;
      if (path === '/api/cases') return Response.json({ items: [{ id: state.id, orderId: state.order.id, status: state.status, caseVersion: state.caseVersion, evidenceVersion: state.evidenceVersion, flags: state.flags, pendingEvaluationOperationId: state.pendingEvaluationOperationId, updatedAt: now }], nextCursor: null, activeRulesVersion: state.activeRulesVersion });
      if (path === '/api/rule-suggestions') return Response.json({ suggestions: [], activeRules: [], activeRulesVersion: state.activeRulesVersion });
      if (path !== `/api/cases/${state.id}`) return fault(404, 'NOT_FOUND');
      // An optional transport fault exposes the retry button quickly in browser
      // QA. It never progresses or completes an evaluation.
      if (failPollRead && operationCount && failures === 0 && !pollReadFailed && !state.receipt) { pollReadFailed = true; return fault(503, 'READ_UNAVAILABLE'); }
      return Response.json(clone(state));
    }
    const key = new Headers(init.headers).get('Idempotency-Key');
    const body = JSON.parse(init.body), scope = `${path}:${key}`;
    posts.push({ path, key, body: clone(body) });
    let saved = requests.get(scope);
    if (saved && JSON.stringify(saved.body) !== JSON.stringify(body)) return fault(409, 'IDEMPOTENCY_CONFLICT');
    if (!saved) {
      if (body.expectedCaseVersion !== state.caseVersion) return fault(409, 'STALE_VERSION');
      if (path.endsWith('/evidence')) {
        const e = { ...clone(body), id: `proof-${state.evidence.length + 1}`, caseId: state.id, evidenceVersion: 1, reviewStatus: 'SUBMITTED', verifiedBy: null, verifiedAt: null, reviewReason: null };
        state.evidence.push(e); state.caseVersion++; state.evidenceVersion++; event('evidence.submitted');
        saved = { body, acknowledgement: { evidenceId: e.id, evidenceVersion: 1 }, operationId: null };
      } else {
        const review = path.match(/\/evidence\/([^/]+)\/review$/);
        if (review) {
          const proof = state.evidence.find(e => e.id === review[1]);
          if (!proof || proof.reviewStatus !== 'SUBMITTED' || proof.evidenceVersion !== body.expectedEvidenceVersion) return fault(409, 'STALE_VERSION');
          proof.reviewStatus = body.reviewStatus; proof.evidenceVersion++; proof.verifiedBy = 'owner-fixture'; proof.verifiedAt = now; state.evidenceVersion++; event('evidence.reviewed');
        } else if (!path.endsWith('/evaluate') || body.expectedActiveRulesVersion !== state.activeRulesVersion) return fault(409, 'STALE_VERSION');
        const operationId = `operation-${++operationCount}`;
        state.caseVersion++; state.pendingEvaluationOperationId = operationId;
        state.evaluation = { id: operationId, status: pendingStatus, executionMode: 'TEST', providerResponseId: null, model: null, error: null, result: null };
        event('evaluation.requested', 'PENDING');
        saved = { body, acknowledgement: review ? { evidenceId: review[1], reviewStatus: body.reviewStatus, evaluationOperationId: operationId } : { caseId: state.id, operationId }, operationId };
      }
      requests.set(scope, clone(saved)); // commit acknowledgement before dispatch
    }
    if (saved.operationId && state.evaluation?.id === saved.operationId && (state.evaluation.status === 'PENDING' || state.evaluation.status === 'RUNNING' && leaseUntil <= now)) {
      dispatchCount++;
      if (failures > 0) failures--; // dispatch unavailable / expired lease
      else {
        state.evaluation.status = 'COMPLETED'; state.evaluation.result = { status: 'COMPLETED', decision: 'RETURN_THEN_REFUND' };
        state.pendingEvaluationOperationId = null; state.status = 'COMPLETED'; state.caseVersion++; state.decision = 'RETURN_THEN_REFUND';
        state.receipt ??= { id: `receipt-${++receiptCount}`, mode: 'SIMULATED', completionMode: 'AUTO', agentRunId: saved.operationId, decision: 'RETURN_THEN_REFUND', packet: 'Hồ sơ TEST', reply: 'Bản nháp TEST', appliedRuleId: null, appliedRuleVersion: null, sourceCaseId: null };
        event('evaluation.completed', 'COMPLETED');
      }
    }
    return Response.json(clone(saved.acknowledgement));
  }
  return { state, posts, fetcher, get counts() { return { operationCount, receiptCount, dispatchCount, reads }; } };
}
module.exports = { recoveryFixture };
