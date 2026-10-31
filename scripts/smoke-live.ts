import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { parseEnv } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { seedDemo } from "./demo-data";
import { handleApi } from "../src/server/api";
import type { CaseDetail } from "../src/shared/contracts";

// Explicit opt-in LIVE provider workflow on isolated synthetic local D1.
// Synthetic identity exists only inside this private harness, never in app routes.
let local: Record<string, string | undefined> = {};
try {
  local = parseEnv(await readFile(".env", "utf8"));
} catch {}
const config = {
  SITES_IDENTITY_VERIFIED: "true",
  OWNER_USER_IDS: "live-smoke-owner",
  MEMBER_USER_IDS: "live-smoke-member",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || local.OPENAI_API_KEY,
  OPENAI_MODEL:
    process.env.OPENAI_MODEL || local.OPENAI_MODEL || "gpt-5.6-terra",
};
if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.includes("..."))
  throw new Error("Configure server-side OPENAI_API_KEY");
const directory = await mkdtemp(path.join(tmpdir(), "returnops-live-"));
const options = {
  modules: true,
  script:
    "export default {fetch(){return new Response('local synthetic smoke')}}",
  d1Databases: { DB: "live-smoke" },
  d1Persist: directory,
};
let runtime = new Miniflare(options);
const auth = {
  "oai-authenticated-user-id": "live-smoke-member",
  "oai-authenticated-user-email": "synthetic@example.test",
};
const origin = "https://returnops-smoke.local";
async function getCase(db: D1Database, id: string) {
  const response = await handleApi(
    new Request(`${origin}/api/cases/${id}`, { headers: auth }),
    db,
    config,
  );
  if (response.status !== 200) throw new Error("DETAIL_FAILED");
  return response.json() as Promise<CaseDetail>;
}
try {
  const db = await runtime.getD1Database("DB");
  const migration = await readFile(
    new URL("../drizzle/0001_returnops.sql", import.meta.url),
    "utf8",
  );
  for (const sql of migration.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ??
    [])
    await db.prepare(sql.trim()).run();
  await seedDemo(db);
  const response = await handleApi(
    new Request(`${origin}/api/cases`, {
      method: "POST",
      headers: {
        ...auth,
        origin,
        "content-type": "application/json",
        "Idempotency-Key": "live-a",
      },
      body: JSON.stringify({
        orderId: "demo-a",
        claim: "Received the wrong size",
      }),
    }),
    db,
    config,
  );
  if (response.status !== 201) throw new Error("INTAKE_FAILED");
  const ack = (await response.json()) as { caseId: string };
  const detail = await getCase(db, ack.caseId);
  if (
    detail.status !== "COMPLETED" ||
    detail.receipt?.mode !== "SIMULATED" ||
    detail.evaluation?.executionMode !== "LIVE" ||
    !detail.evaluation.providerResponseId
  )
    throw new Error(detail.evaluation?.error?.code || "WORKFLOW_NOT_COMPLETED");
  const replay = await handleApi(
    new Request(`${origin}/api/cases`, {
      method: "POST",
      headers: {
        ...auth,
        origin,
        "content-type": "application/json",
        "Idempotency-Key": "live-a",
      },
      body: JSON.stringify({
        claim: "Received the wrong size",
        orderId: "demo-a",
      }),
    }),
    db,
    config,
  );
  const replayAck = (await replay.json()) as { caseId: string };
  if (replay.status !== 201 || replayAck.caseId !== ack.caseId)
    throw new Error("REPLAY_FAILED");
  // Each evaluation uses the real default agent; owner actions stay MANUAL.
  const liveRuns: Array<{ scenario: string; model: string | null; providerResponseId: string | null }> = [];
  function verifyLive(label: string, value: CaseDetail) {
    assert.equal(value.evaluation?.executionMode, "LIVE");
    assert.equal(value.evaluation?.status, "COMPLETED");
    assert.ok(value.evaluation?.providerResponseId);
    liveRuns.push({ scenario: label, model: value.evaluation.model, providerResponseId: value.evaluation.providerResponseId });
  }
  async function post<T>(route: string, body: unknown, expected: number, owner = false): Promise<T> {
    const result = await handleApi(new Request(`${origin}${route}`, {
      method: "POST", headers: { ...auth, ...(owner ? { "oai-authenticated-user-id": "live-smoke-owner" } : {}),
        origin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }), db, config);
    assert.equal(result.status, expected, route);
    return result.json() as Promise<T>;
  }
  async function intake(orderId: string) {
    const result = await post<{ caseId: string }>("/api/cases", { orderId, claim: "Synthetic LIVE scenario" }, 201);
    return getCase(db, result.caseId);
  }
  async function review(value: CaseDetail, evidenceId: string, evidenceVersion: number) {
    await post(`/api/cases/${value.id}/evidence/${evidenceId}/review`, {
      expectedCaseVersion: value.caseVersion, expectedEvidenceVersion: evidenceVersion,
      reviewStatus: "VERIFIED", reason: "Owner checked synthetic metadata",
    }, 200, true);
    return getCase(db, value.id);
  }
  verifyLive("A", detail);
  let b = await intake("demo-b");
  verifyLive("B waiting", b);
  assert.equal(b.status, "WAITING_EVIDENCE"); assert.equal(b.receipt, null);
  const proof = await post<{ evidenceId: string; evidenceVersion: number }>(`/api/cases/${b.id}/evidence`, {
    expectedCaseVersion: b.caseVersion, orderId: "demo-b", orderVersion: 1, tracking: "trk-b",
    type: "PACKING", source: "SELLER", reference: "synthetic-seller-proof", observedAt: Math.floor(Date.now() / 1000),
  }, 201);
  b = await getCase(db, b.id);
  assert.equal(b.status, "WAITING_EVIDENCE"); assert.equal(b.receipt, null);
  b = await review(b, proof.evidenceId, proof.evidenceVersion);
  verifyLive("B resumed", b); assert.equal(b.status, "COMPLETED");
  assert.equal(b.receipt?.completionMode, "AUTO");

  const d = await intake("demo-d"); verifyLive("D", d);
  assert.equal(d.status, "NEEDS_OWNER_REVIEW");
  const decision = await post<{ suggestionId: string; activeRulesVersion: number }>(`/api/cases/${d.id}/owner-decision`, {
    expectedCaseVersion: d.caseVersion, expectedActiveRulesVersion: d.activeRulesVersion,
    decision: "RETURN_THEN_REFUND", reason: "Unused tags intact, eligible fit return",
  }, 200, true);
  assert.ok(decision.suggestionId); assert.equal(decision.activeRulesVersion, d.activeRulesVersion);
  const completedD = await getCase(db, d.id);
  assert.equal(completedD.receipt?.completionMode, "MANUAL"); assert.equal(completedD.receipt?.agentRunId, null);
  let e = await intake("demo-e"); verifyLive("E pending", e);
  assert.equal(e.status, "NEEDS_OWNER_REVIEW"); assert.equal(e.receipt, null);
  const previousRun = e.evaluation?.providerResponseId;
  const accepted = await post<{ activeRulesVersion: number; ruleId: string }>(`/api/rule-suggestions/${decision.suggestionId}/accept`, {
    expectedSuggestionVersion: 1, expectedActiveRulesVersion: decision.activeRulesVersion,
  }, 200, true);
  assert.equal(accepted.activeRulesVersion, decision.activeRulesVersion + 1);
  e = await getCase(db, e.id); assert.equal(e.receipt, null);
  await post(`/api/cases/${e.id}/evaluate`, { expectedCaseVersion: e.caseVersion, expectedActiveRulesVersion: e.activeRulesVersion }, 202);
  e = await getCase(db, e.id); verifyLive("E accepted fresh", e);
  assert.notEqual(e.evaluation?.providerResponseId, previousRun);
  assert.equal(e.status, "COMPLETED"); assert.equal(e.appliedRuleId, accepted.ruleId); assert.equal(e.sourceCaseId, d.id);

  let c = await intake("demo-c"); verifyLive("C", c);
  assert.equal(c.status, "NEEDS_OWNER_REVIEW");
  c = await review(c, c.evidence[0].id, c.evidence[0].evidenceVersion);
  const dispute = await post<{ suggestionId: string | null }>(`/api/cases/${c.id}/owner-decision`, {
    expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion,
    decision: "DISPUTE", reason: "Carrier metadata conflicts with claim",
  }, 200, true);
  assert.equal(dispute.suggestionId, null);
  c = await getCase(db, c.id); assert.equal(c.status, "COMPLETED");
  assert.deepEqual(new Set(c.flags), new Set(["DELIVERY_CONFLICT", "REPEATED_COMPLAINTS", "OVER_HARD_CAP"]));
  assert.equal(c.receipt?.completionMode, "MANUAL"); assert.equal(c.receipt?.agentRunId, null);
  for (const value of [detail, b, completedD, e, c]) {
    assert.equal(value.receipt?.mode, "SIMULATED");
    const count = await db.prepare("SELECT count(*) AS total FROM receipts WHERE case_id=?").bind(value.id).first<{ total: number }>();
    assert.equal(count?.total, 1);
  }
  await runtime.dispose();
  runtime = new Miniflare(options);
  const restarted = await getCase(
    await runtime.getD1Database("DB"),
    ack.caseId,
  );
  if (
    restarted.receipt?.id !== detail.receipt.id ||
    restarted.status !== "COMPLETED"
  )
    throw new Error("PERSISTENCE_FAILED");
  for (const value of [b, completedD, e, c]) {
    const persisted = await getCase(await runtime.getD1Database("DB"), value.id);
    assert.equal(persisted.receipt?.id, value.receipt?.id);
    assert.equal(persisted.status, "COMPLETED");
  }
  console.log(
    JSON.stringify({
      status: "PASS",
      scenario: "A–E",
      liveRuns,
      executionMode: "LIVE",
      model: detail.evaluation.model,
      providerResponseId: detail.evaluation.providerResponseId,
      receiptMode: detail.receipt.mode,
      replay: "PASS",
      restartPersistence: "PASS",
      scope:
        "isolated local D1 API handler with synthetic harness identity; hosted NOT RUN",
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      status: "FAIL",
      executionMode: "LIVE",
      model: config.OPENAI_MODEL,
      code:
        error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : "SMOKE_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
}
