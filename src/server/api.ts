import { actor } from "./auth";
import { ApiFault, apiError } from "./http";
import type { Db } from "./db";
import type { AgentRunner } from "./workflow";
import type { BackendConfig } from "./mutations";
import { handleCases } from "./case-api";
import { handleSuggestions } from "./suggestion-api";
import { resetSharedDemo } from "./demo-reset";
export type { BackendConfig } from "./mutations";

export async function handleApi(
  request: Request,
  db: Db,
  config: BackendConfig,
  runner?: AgentRunner,
): Promise<Response> {
  try {
    const a = actor(request, config),
      url = new URL(request.url),
      segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "api")
      throw new ApiFault(404, "NOT_FOUND", "Route not found");
    if (segments.length === 3 && segments[1] === "demo" && segments[2] === "reset")
      return await resetSharedDemo(request, db, config, a);
    if (segments[1] === "cases")
      return await handleCases(request, db, config, a, segments, url, runner);
    if (segments[1] === "rule-suggestions")
      return await handleSuggestions(
        request,
        db,
        config,
        a,
        segments,
        url,
        runner,
      );
    throw new ApiFault(404, "NOT_FOUND", "Route not found");
  } catch (error) {
    return apiError(error);
  }
}
