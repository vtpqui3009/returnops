import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";

export class ApiFault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type Actor = { id: string; role: "OWNER" | "MEMBER"; shopId: string };
export function owner(actor: Actor) {
  if (actor.role !== "OWNER")
    throw new ApiFault(403, "FORBIDDEN", "Owner role required");
}
export function apiError(error: unknown) {
  const fault =
    error instanceof ApiFault
      ? error
      : new ApiFault(500, "INTERNAL_ERROR", "Internal server error");
  return Response.json(
    {
      error: {
        code: fault.code,
        message: fault.message,
        requestId: randomUUID(),
      },
    },
    { status: fault.status, headers: { "Cache-Control": "no-store" } },
  );
}
export function idempotency(request: Request) {
  const key = request.headers.get("Idempotency-Key");
  if (!key || key.length > 128 || !/^[\x21-\x7e][\x20-\x7e]*$/.test(key))
    throw new ApiFault(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key is required",
    );
  return key;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function hashPayload(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function requireOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new ApiFault(
      403,
      "INVALID_ORIGIN",
      "Same-origin Origin header required",
    );
}
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiFault(400, "INVALID_CONTENT_TYPE", "JSON body required");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiFault(400, "INVALID_INPUT", "JSON body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16384) {
      await reader.cancel();
      throw new ApiFault(400, "BODY_TOO_LARGE", "Body exceeds 16 KiB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiFault(400, "INVALID_INPUT", "Invalid JSON");
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new ApiFault(400, "INVALID_INPUT", "Invalid request fields");
  return parsed.data;
}
