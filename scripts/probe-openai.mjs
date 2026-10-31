import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

// An explicit LIVE probe: never print the key, provider body, or raw reasoning.
let local = {};
try {
  local = parseEnv(await readFile(".env", "utf8"));
} catch {}
const key = process.env.OPENAI_API_KEY || local.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || local.OPENAI_MODEL || "gpt-5.6-terra";
if (!key || key.includes("..."))
  throw new Error("Configure OPENAI_API_KEY server-side.");
const tool = {
  type: "function",
  name: "check_policy",
  description: "Read the fixed demo policy.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};
const signal = AbortSignal.timeout(30000);
async function request(body) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model,
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 1000,
      reasoning: { effort: "low" },
      ...body,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.log(
      JSON.stringify({
        status: "FAIL",
        executionMode: "LIVE",
        model,
        httpStatus: response.status,
        code: String(error?.error?.code || "PROVIDER_ERROR")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .slice(0, 80),
      }),
    );
    process.exit(1);
  }
  return response.json();
}
try {
  const input = [
    {
      role: "user",
      content:
        "Call check_policy once. Then acknowledge the demo policy cap and window in one short sentence.",
    },
  ];
  const first = await request({
    input,
    tools: [tool],
    parallel_tool_calls: false,
    tool_choice: { type: "function", name: "check_policy" },
  });
  const calls =
    first.output?.filter((item) => item.type === "function_call") || [];
  if (
    first.status !== "completed" ||
    calls.length !== 1 ||
    calls[0].name !== "check_policy" ||
    JSON.stringify(JSON.parse(calls[0].arguments)) !== "{}"
  )
    throw new Error("INVALID_TOOL_CALL");
  const final = await request({
    tools: [tool],
    parallel_tool_calls: false,
    tool_choice: "none",
    input: [
      ...input,
      ...first.output,
      {
        type: "function_call_output",
        call_id: calls[0].call_id,
        output: JSON.stringify({
          capVnd: 300000,
          windowSeconds: 604800,
          mode: "SIMULATED",
        }),
      },
    ],
  });
  const reply = final.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")?.text;
  if (
    final.status !== "completed" ||
    !reply ||
    final.output?.some((item) => item.type === "function_call")
  )
    throw new Error("INVALID_FINAL_RESPONSE");
  console.log(
    JSON.stringify({
      status: "PASS",
      executionMode: "LIVE",
      model,
      tool: "check_policy",
      toolCalls: 1,
      rounds: 2,
      providerResponseId: final.id,
      scope: "provider tool-calling probe only; no workflow or payment",
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      status: "FAIL",
      executionMode: "LIVE",
      model,
      code: error?.name === "TimeoutError" ? "TIMEOUT" : "PROBE_FAILED",
    }),
  );
  process.exitCode = 1;
}
