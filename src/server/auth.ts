import { ApiFault, type Actor } from "./http";
export { owner } from "./http";
export interface AuthConfig {
  SITES_IDENTITY_VERIFIED?: string;
  OWNER_USER_IDS?: string;
  MEMBER_USER_IDS?: string;
  RETURNOPS_SIGNED_IN_DEMO?: string;
}
function ids(value?: string) {
  return new Set(
    value
      ?.split(",")
      .map((id) => id.trim())
      .filter(Boolean) ?? [],
  );
}
/** Trust is explicitly enabled only after the protected Sites ingress has been verified. */
export function actor(request: Request, config: AuthConfig): Actor {
  if (config.SITES_IDENTITY_VERIFIED !== "true")
    throw new ApiFault(
      401,
      "UNAUTHENTICATED",
      "Verified identity ingress required",
    );
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id || !request.headers.get("oai-authenticated-user-email"))
    throw new ApiFault(401, "UNAUTHENTICATED", "Sign-in required");
  // Shared synthetic demo: preserve each signed-in actor's identity for audit/replay.
  if (config.RETURNOPS_SIGNED_IN_DEMO === "true")
    return { id, role: "OWNER", shopId: "demo-shop" };
  if (ids(config.OWNER_USER_IDS).has(id))
    return { id, role: "OWNER", shopId: "demo-shop" };
  if (ids(config.MEMBER_USER_IDS).has(id))
    return { id, role: "MEMBER", shopId: "demo-shop" };
  throw new ApiFault(403, "FORBIDDEN", "User is not allowlisted");
}
