import { env } from "cloudflare:workers";
import { handleApi, type BackendConfig } from "./api";
import { apiError, ApiFault } from "./http";
export function route(request: Request) {
  const config = env as Cloudflare.Env & BackendConfig;
  if (!config.DB)
    return Promise.resolve(
      apiError(
        new ApiFault(503, "DATABASE_UNAVAILABLE", "D1 binding unavailable"),
      ),
    );
  return handleApi(request, config.DB, config);
}
