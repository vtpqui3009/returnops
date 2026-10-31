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
  console.log(
    JSON.stringify({
      status: "PASS",
      scenario: "A",
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
