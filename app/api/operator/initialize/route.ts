import { env } from "cloudflare:workers";
import { initializeDemo } from "@/src/server/hosted-setup";
import { ApiFault, apiError } from "@/src/server/http";

export function POST(request: Request) {
  if (!env.DB) return apiError(new ApiFault(503, "DATABASE_UNAVAILABLE", "D1 binding unavailable"));
  return initializeDemo(request, env.DB, env);
}
