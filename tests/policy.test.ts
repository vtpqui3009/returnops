import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActiveRule, Evidence, OrderSnapshot, RiskFlag } from '../src/shared/contracts';
import { currentEvidence, evaluatePolicy } from '../src/server/policy';

const now = 1_800_000_000;
const baseOrder: OrderSnapshot & { riskFlags: RiskFlag[] } = {
  id: 'demo-a', orderVersion: 1, amountVnd: 189_000, deliveredAt: now - 60,
  tracking: 'trk-a', reasonGroup: 'SIZE_MISMATCH', itemCondition: 'WRONG_SIZE', riskFlags: [],
};
const proof = (overrides: Partial<Evidence> = {}): Evidence => ({
  id: 'evidence-1', caseId: 'case-1', orderId: baseOrder.id, orderVersion: baseOrder.orderVersion,
  tracking: baseOrder.tracking, type: 'PACKING', source: 'SELLER', reference: 'demo-proof',
  observedAt: now - 30, evidenceVersion: 1, reviewStatus: 'VERIFIED', verifiedBy: 'owner',
  verifiedAt: now - 20, reviewReason: 'checked', ...overrides,
});
const builtin: ActiveRule = { id: 'builtin-a', version: 1, sourceCaseId: null, decision: 'RETURN_THEN_REFUND', reasonGroup: 'SIZE_MISMATCH', itemCondition: 'WRONG_SIZE' };

test('A auto-completes only with current owner-verified seller packing proof and built-in rule', () => {
  const result = evaluatePolicy(baseOrder, [proof()], [builtin], now);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.decision, 'RETURN_THEN_REFUND');
  assert.equal(result.currentProof, true);
  assert.equal(result.appliedRule?.id, builtin.id);
});

test('B and stale, wrong-source, unverified, future evidence cannot satisfy the proof gate', () => {
  for (const invalid of [
    proof({ source: 'BUYER' }), proof({ tracking: 'wrong' }), proof({ orderVersion: 2 }),
    proof({ reviewStatus: 'SUBMITTED', verifiedBy: null, verifiedAt: null }), proof({ observedAt: now + 1 }),
  ]) {
    assert.equal(currentEvidence(baseOrder, [invalid], 'SELLER', 'PACKING', now), false);
    const result = evaluatePolicy(baseOrder, [invalid], [builtin], now);
    assert.equal(result.status, 'WAITING_EVIDENCE');
    assert.deepEqual(result.missingEvidence, ['SELLER_PACKING_PROOF']);
  }
});

test('hard cap and inclusive delivery window block automatic money decisions', () => {
  assert.equal(evaluatePolicy({ ...baseOrder, amountVnd: 300_001 }, [proof()], [builtin], now).status, 'NEEDS_OWNER_REVIEW');
  assert.equal(evaluatePolicy({ ...baseOrder, deliveredAt: now - 604_800 }, [proof()], [builtin], now).status, 'COMPLETED');
  for (const deliveredAt of [null, now + 1, now - 604_801]) {
    assert.equal(evaluatePolicy({ ...baseOrder, deliveredAt }, [proof()], [builtin], now).status, 'NEEDS_OWNER_REVIEW');
  }
});

test('learned rule generalizes only the approved fit predicate, and flags always win', () => {
  const fitOrder = { ...baseOrder, id: 'demo-e', amountVnd: 279_000, tracking: 'trk-e', reasonGroup: 'FIT_ISSUE', itemCondition: 'UNUSED_TAGS_INTACT' };
  const fitProof = proof({ orderId: fitOrder.id, tracking: fitOrder.tracking, source: 'BUYER', type: 'ITEM_CONDITION' });
  const learned: ActiveRule = { id: 'learned-d', version: 2, sourceCaseId: 'demo-d', decision: 'RETURN_THEN_REFUND', reasonGroup: 'FIT_ISSUE', itemCondition: 'UNUSED_TAGS_INTACT' };
  assert.equal(evaluatePolicy(fitOrder, [fitProof], [learned], now).status, 'COMPLETED');
  assert.equal(evaluatePolicy({ ...fitOrder, riskFlags: ['DELIVERY_CONFLICT'] }, [fitProof], [learned], now).status, 'NEEDS_OWNER_REVIEW');
  assert.equal(evaluatePolicy({ ...fitOrder, reasonGroup: 'SIZE_MISMATCH' }, [fitProof], [learned], now).status, 'WAITING_EVIDENCE');
});

test('delivery disputes require carrier delivery proof and retain monetary risk blocks', () => {
  const order = { ...baseOrder, reasonGroup: 'DENIED_RECEIPT', itemCondition: 'DELIVERY_DISPUTED', amountVnd: 400_000, riskFlags: ['DELIVERY_CONFLICT', 'REPEATED_COMPLAINTS'] as RiskFlag[] };
  assert.deepEqual(evaluatePolicy(order, [proof()], [], now).missingEvidence, ['CARRIER_DELIVERY_PROOF']);
  const result = evaluatePolicy(order, [proof({ source: 'CARRIER', type: 'DELIVERY' })], [], now);
  assert.equal(result.currentProof, true);
  assert.deepEqual(result.missingEvidence, []);
  assert.equal(result.monetaryEligible, false);
  assert.equal(result.status, 'NEEDS_OWNER_REVIEW');
  assert.ok(result.flags.includes('OVER_HARD_CAP'));
});
