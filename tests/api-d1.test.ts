import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { seedDemo } from '../scripts/demo-data';
import { handleApi } from '../src/server/api';
import { claimEvaluation, finalizeFailure, type AgentRunner } from '../src/server/workflow';
import { ApiFault } from '../src/server/http';

const config = { SITES_IDENTITY_VERIFIED: 'true', OWNER_USER_IDS: 'owner', MEMBER_USER_IDS: 'member', OPENAI_API_KEY: 'unused', OPENAI_MODEL: 'gpt-5.6-terra' };
const runner: AgentRunner = async () => ({ reply: 'SIMULATED: test reply', providerResponseId: 'test-response', model: 'gpt-5.6-terra', executionMode: 'TEST', toolFacts: [] });

async function demo() {
  const runtime = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: `api-test-${crypto.randomUUID()}` } });
  try {
    const db = await runtime.getD1Database('DB');
    const sql = await readFile(new URL('../drizzle/0001_returnops.sql', import.meta.url), 'utf8');
    for (const statement of sql.trim().match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? []) await db.prepare(statement.trim()).run();
    await seedDemo(db);
    return { runtime, db };
  } catch (error) { await runtime.dispose(); throw error; }
}

function request(path: string, body: unknown, key: string, user = 'member') {
  return new Request(`https://returnops.local${path}`, { method: 'POST', headers: {
    origin: 'https://returnops.local', 'content-type': 'application/json', 'Idempotency-Key': key,
    'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.test`,
  }, body: JSON.stringify(body) });
}
function get(path: string, user = 'member') { return new Request(`https://returnops.local${path}`, { headers: { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.test` } }); }

test('actual local D1 API completes A exactly once and immutable acknowledgement replays', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const first = await handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, 'a-intake'), db, config, runner);
  assert.equal(first.status, 201); const ack = await first.json() as { caseId: string; evaluationOperationId: string };
  const detail = await handleApi(get(`/api/cases/${ack.caseId}`), db, config, runner);
  const caseData = await detail.json() as { status: string; receipt: { mode: string; completionMode: string; agentRunId: string | null } | null; evaluation: { executionMode: string } | null };
  assert.equal(caseData.status, 'COMPLETED'); assert.equal(caseData.receipt?.mode, 'SIMULATED'); assert.equal(caseData.receipt?.completionMode, 'AUTO'); assert.equal(caseData.receipt?.agentRunId, ack.evaluationOperationId); assert.equal(caseData.evaluation?.executionMode, 'TEST');
  const replay = await handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, 'a-intake'), db, config, runner);
  assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), ack);
  const count = await db.prepare('SELECT count(*) AS count FROM receipts WHERE case_id=?').bind(ack.caseId).first<{ count: number }>();
  assert.equal(count?.count, 1);
  const mismatch = await handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Changed' }, 'a-intake'), db, config, runner);
  assert.equal(mismatch.status, 409);
});

test('API denies anonymous and member owner actions before D1 mutation', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const anonymous = await handleApi(new Request('https://returnops.local/api/cases'), db, config, runner);
  assert.equal(anonymous.status, 401);
  const initial = await handleApi(request('/api/cases', { orderId: 'demo-c', claim: 'Conflict' }, 'c-intake'), db, config, runner);
  const { caseId } = await initial.json() as { caseId: string };
  const detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { caseVersion: number; evidence: { id: string; evidenceVersion: number }[] };
  const denied = await handleApi(request(`/api/cases/${caseId}/evidence/${detail.evidence[0].id}/review`, { expectedCaseVersion: detail.caseVersion, expectedEvidenceVersion: detail.evidence[0].evidenceVersion, reviewStatus: 'VERIFIED', reason: 'review' }, 'c-review', 'member'), db, config, runner);
  assert.equal(denied.status, 403);
  const unchanged = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { evidence: { reviewStatus: string }[] };
  assert.equal(unchanged.evidence[0].reviewStatus, 'SUBMITTED');
});

test('wrong proof context and over-cap owner completion leave state and receipts unchanged', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const intake = await handleApi(request('/api/cases', { orderId: 'demo-c', claim: 'Conflict' }, 'guard-c'), db, config, runner);
  const { caseId } = await intake.json() as { caseId: string };
  const detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { caseVersion: number; activeRulesVersion: number; evidence: { id: string; evidenceVersion: number }[] };
  await db.prepare("UPDATE evidence SET tracking='wrong' WHERE id=?").bind(detail.evidence[0].id).run();
  const mismatch = await handleApi(request(`/api/cases/${caseId}/evidence/${detail.evidence[0].id}/review`, { expectedCaseVersion: detail.caseVersion, expectedEvidenceVersion: detail.evidence[0].evidenceVersion, reviewStatus: 'VERIFIED', reason: 'wrong' }, 'mismatch', 'owner'), db, config, runner);
  assert.equal(mismatch.status, 409);
  const unchanged = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { caseVersion: number; evidence: { reviewStatus: string }[] };
  assert.equal(unchanged.caseVersion, detail.caseVersion); assert.equal(unchanged.evidence[0].reviewStatus, 'SUBMITTED');
  const over = await handleApi(request(`/api/cases/${caseId}/owner-decision`, { expectedCaseVersion: detail.caseVersion, expectedActiveRulesVersion: detail.activeRulesVersion, decision: 'RETURN_THEN_REFUND', reason: 'over cap' }, 'overcap', 'owner'), db, config, runner);
  assert.equal(over.status, 409); const receipts = await db.prepare('SELECT count(*) AS count FROM receipts WHERE case_id=?').bind(caseId).first<{ count: number }>(); assert.equal(receipts?.count, 0);
});

test('API rejects missing Origin and unknown fields, while concurrent identical intake replays one acknowledgement', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const noOrigin = new Request('https://returnops.local/api/cases', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'missing-origin', 'oai-authenticated-user-id': 'member', 'oai-authenticated-user-email': 'member@example.test' }, body: JSON.stringify({ orderId: 'demo-a', claim: 'Wrong size' }) });
  assert.equal((await handleApi(noOrigin, db, config, runner)).status, 403);
  assert.equal((await handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size', role: 'OWNER' }, 'unknown-field'), db, config, runner)).status, 400);
  const [one, two] = await Promise.all([
    handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, 'concurrent-key'), db, config, runner),
    handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, 'concurrent-key'), db, config, runner),
  ]);
  assert.equal(one.status, 201); assert.equal(two.status, 201);
  assert.deepEqual(await one.json(), await two.json());
});

test('B resumes once after only current owner-verified seller packing proof', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const intake = await handleApi(request('/api/cases', { orderId: 'demo-b', claim: 'Damaged' }, 'b-intake'), db, config, runner);
  const { caseId } = await intake.json() as { caseId: string };
  let detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { status: string; caseVersion: number; evidenceVersion: number; evidence: { id: string; evidenceVersion: number }[]; receipt: unknown };
  assert.equal(detail.status, 'WAITING_EVIDENCE'); assert.equal(detail.receipt, null);
  const buyerSubmit = await handleApi(request(`/api/cases/${caseId}/evidence`, { expectedCaseVersion: detail.caseVersion, orderId: 'demo-b', orderVersion: 1, tracking: 'trk-b', type: 'ITEM_CONDITION', source: 'BUYER', reference: 'buyer-proof', observedAt: Math.floor(Date.now() / 1000) }, 'b-buyer-submit'), db, config, runner);
  assert.equal(buyerSubmit.status, 201); const buyer = await buyerSubmit.json() as { evidenceId: string; evidenceVersion: number };
  detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as typeof detail;
  const buyerReview = await handleApi(request(`/api/cases/${caseId}/evidence/${buyer.evidenceId}/review`, { expectedCaseVersion: detail.caseVersion, expectedEvidenceVersion: buyer.evidenceVersion, reviewStatus: 'VERIFIED', reason: 'valid but wrong source' }, 'b-buyer-review', 'owner'), db, config, runner);
  assert.equal(buyerReview.status, 200); assert.equal((await buyerReview.json() as { evaluationOperationId: string | null }).evaluationOperationId, null);
  detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as typeof detail;
  assert.equal(detail.status, 'WAITING_EVIDENCE');
  const sellerSubmit = await handleApi(request(`/api/cases/${caseId}/evidence`, { expectedCaseVersion: detail.caseVersion, orderId: 'demo-b', orderVersion: 1, tracking: 'trk-b', type: 'PACKING', source: 'SELLER', reference: 'seller-proof', observedAt: Math.floor(Date.now() / 1000) }, 'b-seller-submit'), db, config, runner);
  assert.equal(sellerSubmit.status, 201); const seller = await sellerSubmit.json() as { evidenceId: string; evidenceVersion: number };
  detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as typeof detail;
  const sellerReview = await handleApi(request(`/api/cases/${caseId}/evidence/${seller.evidenceId}/review`, { expectedCaseVersion: detail.caseVersion, expectedEvidenceVersion: seller.evidenceVersion, reviewStatus: 'VERIFIED', reason: 'valid seller proof' }, 'b-seller-review', 'owner'), db, config, runner);
  assert.equal(sellerReview.status, 200); assert.ok((await sellerReview.json() as { evaluationOperationId: string | null }).evaluationOperationId);
  detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as typeof detail;
  assert.equal(detail.status, 'COMPLETED'); assert.ok(detail.receipt);
});

test('D learning changes E only after explicit acceptance, while C dispute preserves flags and creates no learning', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const dIntake = await handleApi(request('/api/cases', { orderId: 'demo-d', claim: 'Does not fit' }, 'd-intake'), db, config, runner);
  const { caseId: dId } = await dIntake.json() as { caseId: string };
  const d = await (await handleApi(get(`/api/cases/${dId}`), db, config, runner)).json() as { caseVersion: number; activeRulesVersion: number; status: string };
  assert.equal(d.status, 'NEEDS_OWNER_REVIEW');
  const decision = await handleApi(request(`/api/cases/${dId}/owner-decision`, { expectedCaseVersion: d.caseVersion, expectedActiveRulesVersion: d.activeRulesVersion, decision: 'RETURN_THEN_REFUND', reason: 'Eligible fit return' }, 'd-decision', 'owner'), db, config, runner);
  assert.equal(decision.status, 200); const dResult = await decision.json() as { suggestionId: string | null; activeRulesVersion: number; receipt: { completionMode: string; agentRunId: null } };
  assert.ok(dResult.suggestionId); assert.equal(dResult.receipt.completionMode, 'MANUAL'); assert.equal(dResult.receipt.agentRunId, null);
  const eIntake = await handleApi(request('/api/cases', { orderId: 'demo-e', claim: 'Does not fit' }, 'e-intake'), db, config, runner);
  const { caseId: eId } = await eIntake.json() as { caseId: string };
  let e = await (await handleApi(get(`/api/cases/${eId}`), db, config, runner)).json() as { status: string; caseVersion: number; activeRulesVersion: number; receipt: unknown };
  assert.equal(e.status, 'NEEDS_OWNER_REVIEW'); assert.equal(e.receipt, null);
  const accept = await handleApi(request(`/api/rule-suggestions/${dResult.suggestionId}/accept`, { expectedSuggestionVersion: 1, expectedActiveRulesVersion: dResult.activeRulesVersion }, 'd-accept', 'owner'), db, config, runner);
  assert.equal(accept.status, 200); const accepted = await accept.json() as { suggestionId: string; suggestionVersion: number; ruleId: string; activeRulesVersion: number };
  assert.equal(accepted.suggestionId, dResult.suggestionId); assert.equal(accepted.suggestionVersion, 2); assert.ok(accepted.ruleId); assert.equal(accepted.activeRulesVersion, dResult.activeRulesVersion + 1);
  e = await (await handleApi(get(`/api/cases/${eId}`), db, config, runner)).json() as typeof e;
  const fresh = await handleApi(request(`/api/cases/${eId}/evaluate`, { expectedCaseVersion: e.caseVersion, expectedActiveRulesVersion: e.activeRulesVersion }, 'e-fresh'), db, config, runner);
  assert.equal(fresh.status, 202);
  e = await (await handleApi(get(`/api/cases/${eId}`), db, config, runner)).json() as typeof e;
  assert.equal(e.status, 'COMPLETED'); assert.ok(e.receipt);

  const cIntake = await handleApi(request('/api/cases', { orderId: 'demo-c', claim: 'Denied receipt' }, 'c-intake'), db, config, runner);
  const { caseId: cId } = await cIntake.json() as { caseId: string };
  let c = await (await handleApi(get(`/api/cases/${cId}`), db, config, runner)).json() as { caseVersion: number; activeRulesVersion: number; flags: string[]; evidence: { id: string; evidenceVersion: number }[] };
  const review = await handleApi(request(`/api/cases/${cId}/evidence/${c.evidence[0].id}/review`, { expectedCaseVersion: c.caseVersion, expectedEvidenceVersion: c.evidence[0].evidenceVersion, reviewStatus: 'VERIFIED', reason: 'carrier record checked' }, 'c-review', 'owner'), db, config, runner);
  assert.equal(review.status, 200);
  c = await (await handleApi(get(`/api/cases/${cId}`), db, config, runner)).json() as typeof c;
  const dispute = await handleApi(request(`/api/cases/${cId}/owner-decision`, { expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion, decision: 'DISPUTE', reason: 'Evidence conflicts' }, 'c-dispute', 'owner'), db, config, runner);
  assert.equal(dispute.status, 200); assert.equal((await dispute.json() as { suggestionId: string | null }).suggestionId, null);
  const completedC = await (await handleApi(get(`/api/cases/${cId}`), db, config, runner)).json() as { status: string; flags: string[] };
  assert.equal(completedC.status, 'COMPLETED'); assert.deepEqual(new Set(completedC.flags), new Set(['DELIVERY_CONFLICT', 'REPEATED_COMPLAINTS', 'OVER_HARD_CAP']));
});

test('failed evaluation preserves acknowledgement and only guarded owner recovery can create a manual receipt', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const failedRunner: AgentRunner = async () => { throw new Error('provider unavailable'); };
  const intake = await handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, 'failed-a'), db, config, failedRunner);
  assert.equal(intake.status, 201); const ack = await intake.json() as { caseId: string };
  const detail = await (await handleApi(get(`/api/cases/${ack.caseId}`), db, config, runner)).json() as { status: string; caseVersion: number; activeRulesVersion: number; receipt: unknown; evaluation: { status: string; error: { code: string } | null } };
  assert.equal(detail.status, 'TECHNICAL_ERROR'); assert.equal(detail.receipt, null); assert.equal(detail.evaluation.status, 'FAILED');
  const replay = await handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, 'failed-a'), db, config, runner);
  assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), ack);
  const recovery = await handleApi(request(`/api/cases/${ack.caseId}/owner-decision`, { expectedCaseVersion: detail.caseVersion, expectedActiveRulesVersion: detail.activeRulesVersion, decision: 'RETURN_THEN_REFUND', reason: 'Owner recovery' }, 'failed-a-recovery', 'owner'), db, config, runner);
  assert.equal(recovery.status, 200); const result = await recovery.json() as { suggestionId: string | null; receipt: { completionMode: string; agentRunId: null } };
  assert.equal(result.suggestionId, null); assert.equal(result.receipt.completionMode, 'MANUAL'); assert.equal(result.receipt.agentRunId, null);
});

test('D1 final commit rejects a delivery window that expires during model work without a receipt', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const expiringRunner: AgentRunner = async () => {
    await db.prepare("UPDATE orders SET delivered_at=unixepoch()-604801 WHERE id='demo-a'").run();
    return { reply: 'SIMULATED: stale', providerResponseId: 'stale-response', model: 'gpt-5.6-terra', executionMode: 'TEST', toolFacts: [] };
  };
  const intake = await handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, 'expired-during-run'), db, config, expiringRunner);
  assert.equal(intake.status, 201); const { caseId } = await intake.json() as { caseId: string };
  const detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { status: string; receipt: unknown; evaluation: { status: string; error: { code: string } | null } };
  assert.equal(detail.status, 'TECHNICAL_ERROR'); assert.equal(detail.receipt, null); assert.equal(detail.evaluation.status, 'FAILED'); assert.ok(['STALE_EVALUATION', 'STALE_VERSION'].includes(detail.evaluation.error?.code ?? ''));
  const receipts = await db.prepare('SELECT count(*) AS count FROM receipts WHERE case_id=?').bind(caseId).first<{ count: number }>();
  assert.equal(receipts?.count, 0);
});

test('D1 snapshot fence rejects catalog, order, evidence, and pending-pointer changes during a run', async () => {
  const changes = [
    "UPDATE shop_policy SET active_rules_version=active_rules_version+1 WHERE shop_id='demo-shop'",
    "UPDATE orders SET order_version=order_version+1 WHERE id='demo-a'",
    "UPDATE cases SET evidence_version=evidence_version+1 WHERE id=(SELECT id FROM cases ORDER BY created_at DESC LIMIT 1)",
    "UPDATE cases SET pending_evaluation_operation_id='superseded' WHERE id=(SELECT id FROM cases ORDER BY created_at DESC LIMIT 1)",
  ];
  for (const [index, sql] of changes.entries()) {
    const { runtime, db } = await demo();
    try {
      const staleRunner: AgentRunner = async () => { await db.prepare(sql).run(); return { reply: 'SIMULATED: stale', providerResponseId: `stale-${index}`, model: 'gpt-5.6-terra', executionMode: 'TEST', toolFacts: [] }; };
      const intake = await handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, `stale-${index}`), db, config, staleRunner);
      assert.equal(intake.status, 201); const { caseId } = await intake.json() as { caseId: string };
      const detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { status: string; receipt: unknown; evaluation: { status: string } };
      assert.equal(detail.status, index === 3 ? 'NEW' : 'TECHNICAL_ERROR'); assert.equal(detail.evaluation.status, 'FAILED'); assert.equal(detail.receipt, null);
      const count = await db.prepare('SELECT count(*) AS count FROM receipts WHERE case_id=?').bind(caseId).first<{ count: number }>();
      assert.equal(count?.count, 0);
    } finally { await runtime.dispose(); }
  }
});

test('expired lease takeover fences an old worker failure from overwriting the new attempt', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked: AgentRunner = async () => { await gate; throw new Error('old worker failed'); };
  const pending = handleApi(request('/api/cases', { orderId: 'demo-a', claim: 'Wrong size' }, 'lease-race'), db, config, blocked);
  let op: { id: string; snapshot: string; attempt_token: string } | undefined;
  for (let attempt = 0; attempt < 30 && !op; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    op = (await db.prepare("SELECT id,snapshot,attempt_token FROM operations WHERE kind='EVALUATION' ORDER BY created_at DESC LIMIT 1").first<{ id: string; snapshot: string; attempt_token: string }>()) ?? undefined;
  }
  assert.ok(op?.attempt_token);
  await db.prepare('UPDATE operations SET lease_until=unixepoch()-1 WHERE id=?').bind(op!.id).run();
  const successor = await claimEvaluation(db, op!.id, 'demo-shop');
  assert.ok(successor); assert.notEqual(successor!.token, op!.attempt_token);
  await finalizeFailure(db, (await db.prepare('SELECT * FROM operations WHERE id=?').bind(op!.id).first()) as never, op!.attempt_token!, JSON.parse(op!.snapshot) as never, new ApiFault(503, 'OLD_FAILURE', 'old worker'), 'TEST');
  const after = await db.prepare('SELECT status,attempt_token FROM operations WHERE id=?').bind(op!.id).first<{ status: string; attempt_token: string }>();
  assert.equal(after?.status, 'RUNNING'); assert.equal(after?.attempt_token, successor!.token);
  release(); await pending;
});

test('concurrent accept and reject leave one terminal suggestion transition and at most one rule', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const intake = await handleApi(request('/api/cases', { orderId: 'demo-d', claim: 'Does not fit' }, 'race-d'), db, config, runner);
  const { caseId } = await intake.json() as { caseId: string };
  const detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { caseVersion: number; activeRulesVersion: number };
  const decision = await handleApi(request(`/api/cases/${caseId}/owner-decision`, { expectedCaseVersion: detail.caseVersion, expectedActiveRulesVersion: detail.activeRulesVersion, decision: 'RETURN_THEN_REFUND', reason: 'Eligible fit' }, 'race-decision', 'owner'), db, config, runner);
  const { suggestionId } = await decision.json() as { suggestionId: string };
  const [accept, reject] = await Promise.all([
    handleApi(request(`/api/rule-suggestions/${suggestionId}/accept`, { expectedSuggestionVersion: 1, expectedActiveRulesVersion: 1 }, 'race-accept', 'owner'), db, config, runner),
    handleApi(request(`/api/rule-suggestions/${suggestionId}/reject`, { expectedSuggestionVersion: 1, reason: 'Concurrent rejection' }, 'race-reject', 'owner'), db, config, runner),
  ]);
  assert.ok([200, 409].includes(accept.status)); assert.ok([200, 409].includes(reject.status)); assert.equal([accept.status, reject.status].filter(status => status === 200).length, 1);
  const state = await db.prepare('SELECT status FROM rule_suggestions WHERE id=?').bind(suggestionId).first<{ status: string }>();
  assert.ok(['ACCEPTED', 'REJECTED'].includes(state?.status ?? ''));
  const rules = await db.prepare("SELECT count(*) AS count FROM rules WHERE source_case_id=?").bind(caseId).first<{ count: number }>();
  assert.ok((rules?.count ?? 0) <= 1);
});

test('rejecting D suggestion leaves E pending owner review and active catalog unchanged', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  const dAck = await handleApi(request('/api/cases', { orderId: 'demo-d', claim: 'fit' }, 'reject-d'), db, config, runner);
  const { caseId: dId } = await dAck.json() as { caseId: string };
  const d = await (await handleApi(get(`/api/cases/${dId}`), db, config, runner)).json() as { caseVersion: number; activeRulesVersion: number };
  const decision = await handleApi(request(`/api/cases/${dId}/owner-decision`, { expectedCaseVersion: d.caseVersion, expectedActiveRulesVersion: d.activeRulesVersion, decision: 'RETURN_THEN_REFUND', reason: 'candidate' }, 'reject-decision', 'owner'), db, config, runner);
  const { suggestionId } = await decision.json() as { suggestionId: string };
  const reject = await handleApi(request(`/api/rule-suggestions/${suggestionId}/reject`, { expectedSuggestionVersion: 1, reason: 'no' }, 'reject-rule', 'owner'), db, config, runner);
  assert.equal(reject.status, 200); const rejected = await reject.json() as { activeRulesVersion: number }; assert.equal(rejected.activeRulesVersion, 1);
  const eAck = await handleApi(request('/api/cases', { orderId: 'demo-e', claim: 'fit' }, 'reject-e'), db, config, runner);
  const { caseId: eId } = await eAck.json() as { caseId: string };
  const e = await (await handleApi(get(`/api/cases/${eId}`), db, config, runner)).json() as { status: string; receipt: unknown; activeRulesVersion: number };
  assert.equal(e.status, 'NEEDS_OWNER_REVIEW'); assert.equal(e.receipt, null); assert.equal(e.activeRulesVersion, 1);
});

test('claim infrastructure faults after durable acknowledgement replay the original 201 and later resume once', async (t) => {
  const { runtime, db } = await demo(); t.after(() => runtime.dispose());
  let faults = 2;
  const flaky = new Proxy(db, { get(target, property) {
    if (property === 'prepare') return (sql: string) => {
      if (sql.includes("UPDATE operations SET status='RUNNING'") && faults-- > 0) throw new Error('injected claim unavailable');
      return target.prepare(sql);
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const body = { orderId: 'demo-a', claim: 'Wrong size' };
  const first = await handleApi(request('/api/cases', body, 'flaky-ack'), flaky, config, runner);
  assert.equal(first.status, 201); const ack = await first.json();
  const replay = await handleApi(request('/api/cases', body, 'flaky-ack'), flaky, config, runner);
  assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), ack);
  const resumed = await handleApi(request('/api/cases', body, 'flaky-ack'), db, config, runner);
  assert.equal(resumed.status, 201); assert.deepEqual(await resumed.json(), ack);
  const { caseId } = ack as { caseId: string }; const detail = await (await handleApi(get(`/api/cases/${caseId}`), db, config, runner)).json() as { status: string; receipt: unknown };
  assert.equal(detail.status, 'COMPLETED'); assert.ok(detail.receipt);
});
